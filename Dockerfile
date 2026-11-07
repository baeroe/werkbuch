# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------------------------------------------------
# assets: Vite build of the app (public/build). Runs on the platform of the build machine: the output is plain JS and
# CSS, the same for amd64 and arm64. Debian (glibc) like the app stage, never alpine (A381).
# ---------------------------------------------------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:24.22.0-trixie-slim@sha256:a6155384446670e9719bdc4fd0ebe4d4b29fb32a8d6aa523da3547a6cfbcf22c AS assets
WORKDIR /app
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# pnpm in exactly the version of "packageManager" in package.json
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack install

# every manifest of the workspace, so the frozen lockfile matches
COPY docs/package.json docs/
COPY prototypes/clickdummy/package.json prototypes/clickdummy/
# the whole workspace, like openbill: the store cache makes docs and clickdummy cheap, none of it reaches the image
RUN --mount=type=cache,id=werkbuch-pnpm-store,target=/pnpm-store pnpm install --frozen-lockfile --store-dir /pnpm-store

COPY vite.config.ts tsconfig.json ./
COPY resources ./resources
RUN pnpm build

# ---------------------------------------------------------------------------------------------------------------------
# app: PHP-FPM + nginx (serversideup), runs as www-data (UID 33) on port 8080. v5.0.4 closes two known holes of v5.0.2
# (session upload progress, libbrotli1) and changes nothing else (A414).
# ---------------------------------------------------------------------------------------------------------------------
FROM serversideup/php:8.4.27-fpm-nginx-trixie-v5.0.4@sha256:c91d4ff3cb30582078050735b42e873a196d60a406a68cff14bda79e3b5fff56 AS app

LABEL org.opencontainers.image.title="werkbuch" \
      org.opencontainers.image.description="Open, self-hosted project management: work items with your own types and workflows, a wiki per project, views, templates, automations, REST, MCP and webhooks." \
      org.opencontainers.image.source="https://github.com/baeroe/werkbuch" \
      org.opencontainers.image.licenses="MIT"

# Uploads carry up to ATTACHMENTS_MAX_MB (25): PHP and nginx let 30 and 32 MiB through, so UploadAttachment answers 413
# itself. TRUSTED_PROXY=off: nginx keeps the TCP peer as REMOTE_ADDR, Laravel's TRUSTED_PROXIES alone decides about
# forwarded headers. Never set a variable with the prefixes PHP_, NGINX_, SSL_, LOG_ or TRUSTED_PROXY empty: the
# base's start script stops the web server then. The server sends to Reverb inside the stack (reverb:6001, A415);
# the browser's address comes from APP_URL. SCOUT_PREFIX stays empty: the indexes are named like the tables.
ENV AUTORUN_ENABLED=false SSL_MODE=off TRUSTED_PROXY=off SHOW_WELCOME_MESSAGE=false \
    PHP_OPCACHE_ENABLE=1 PHP_MEMORY_LIMIT=512M PHP_UPLOAD_MAX_FILE_SIZE=30M PHP_POST_MAX_SIZE=32M NGINX_CLIENT_MAX_BODY_SIZE=32M \
    APP_NAME=werkbuch APP_ENV=production APP_DEBUG=false LOG_CHANNEL=stderr LOG_LEVEL=info \
    DB_CONNECTION=mariadb DB_HOST=mariadb DB_PORT=3306 DB_DATABASE=werkbuch DB_USERNAME=werkbuch \
    SESSION_DRIVER=database SESSION_LIFETIME=10080 CACHE_STORE=database QUEUE_CONNECTION=database MEDIA_QUEUE=media \
    BROADCAST_CONNECTION=reverb REVERB_APP_ID=werkbuch REVERB_HOST=reverb REVERB_PORT=6001 REVERB_SCHEME=http \
    REVERB_SERVER_HOST=0.0.0.0 REVERB_SERVER_PORT=6001 \
    SCOUT_DRIVER=meilisearch MEILISEARCH_HOST=http://meilisearch:7700 SCOUT_PREFIX= MAIL_MAILER=log FILESYSTEM_DISK=local

USER root
# intl (App\Domain\Emoji), bcmath (ramsey/uuid), gd (previews, media-library.image_driver), exif (spatie/image);
# opcache, pcntl, pdo_mysql, redis, zip come with the base image
RUN install-php-extensions intl bcmath gd exif
# start of every app container (web, workers, scheduler, reverb)
COPY --chmod=755 docker/entrypoint.d/ /etc/entrypoint.d/
# log format without query strings and the masks of the logged path (http context, sorts before default.conf)
COPY --chmod=644 docker/nginx/conf.d/ /etc/nginx/conf.d/
# werkbuch.conf (log, Reverb) and security.conf (the base's headers without HSTS, A419)
COPY --chmod=644 docker/nginx/server-opts.d/ /etc/nginx/server-opts.d/
COPY --chmod=644 docker/php/zz-werkbuch.ini /usr/local/etc/php/conf.d/zz-werkbuch.ini
WORKDIR /var/www/html

# Dependencies first, so a change of the code keeps this layer. install --no-scripts checks the platform only against
# the packages it installs: check-platform-reqs fails the build when an extension a package needs is missing.
COPY --chmod=644 composer.json composer.lock ./
RUN --mount=type=cache,target=/composer/cache composer check-platform-reqs --no-dev \
    && composer install --no-dev --no-interaction --no-progress --prefer-dist --no-scripts --no-autoloader

COPY artisan LICENSE ./
COPY app ./app
COPY bootstrap ./bootstrap
COPY config ./config
COPY database ./database
COPY lang ./lang
COPY public ./public
COPY resources/views ./resources/views
COPY routes ./routes
# read at runtime by the MCP references (werkbuch.docs_path, A409)
COPY docs/en/concepts/views.md docs/en/concepts/rich-text.md docs/en/concepts/types-and-properties.md ./docs/en/concepts/
COPY --from=assets /app/public/build ./public/build

# Code, vendor, configuration and scripts belong to root and are read-only for PHP (www-data); only storage/ (the data
# volume is storage/app; compiled views) and bootstrap/cache (config, routes, events) stay writable, and Laravel's
# compiled PHP lives there. The base gives /var/www to www-data: whoever writes there could swap the code folder (A429).
# What COPY puts into a folder the base created keeps its owner www-data, so every code folder is chowned. The debug
# files of the base (read by PHP and FPM at start) and server-opts.d (our server config) belong to root as well;
# the rest of /etc/nginx stays writable, the base writes its templates there.
# package:discover boots the app; the channels resolve the broadcaster, and Reverb's keys exist only at start (3b).
RUN mkdir -p storage/app/private storage/app/public storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && BROADCAST_CONNECTION=null composer dump-autoload --no-dev --optimize --no-interaction \
    && chown root:root /var/www . && chmod 755 /var/www . \
    && chown -R root:root artisan LICENSE app bootstrap config database docs lang public resources routes vendor \
    && chmod -R a+rX,go-w artisan LICENSE app bootstrap config database docs lang public resources routes vendor \
    && chown root:root "$PHP_INI_DIR/conf.d/zzz-serversideup-docker-php-debug.ini" /usr/local/etc/php-fpm.d/zzz-docker-php-serversideup-fpm-debug.conf /usr/local/etc/php-fpm.conf \
    && chmod 644 "$PHP_INI_DIR/conf.d/zzz-serversideup-docker-php-debug.ini" /usr/local/etc/php-fpm.d/zzz-docker-php-serversideup-fpm-debug.conf /usr/local/etc/php-fpm.conf \
    && chown root:root /etc/nginx/server-opts.d && chmod 755 /etc/nginx/server-opts.d \
    && chown -R www-data:www-data storage bootstrap/cache

USER www-data
