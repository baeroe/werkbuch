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
# runner: the four binaries of the runner (spec 8.2, 8.3, A521), static without cgo, cross-compiled on the platform of
# the build machine like the assets. Go as runner/go.mod's toolchain; the version of the binaries is the version of
# the app (config/werkbuch.php, the sed of scripts/release-version.sh): the instance answers it to every runner, which
# updates itself to it from /runner/download/<os>/<arch> and checks the .sha256 written here.
# ---------------------------------------------------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM golang:1.26.11-trixie@sha256:cff05dd6b81c901f2e8249eb6f91c69a60451d0f12c26bfef08e476a85b32d4d AS runner
WORKDIR /src
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOFLAGS=-trimpath
COPY runner/go.mod runner/go.sum ./
RUN --mount=type=cache,id=werkbuch-go-mod,target=/go/pkg/mod go mod download
COPY runner ./
COPY config/werkbuch.php /werkbuch.php
RUN --mount=type=cache,id=werkbuch-go-mod,target=/go/pkg/mod --mount=type=cache,id=werkbuch-go-build,target=/root/.cache/go-build \
    version=$(sed -n "s/^[[:space:]]*'version' => '\([^']*\)'.*/\1/p" /werkbuch.php | head -n 1) \
    && test -n "$version" \
    && mkdir -p /dist \
    && for target in darwin/arm64 darwin/amd64 linux/arm64 linux/amd64; do \
        GOOS=${target%/*} GOARCH=${target#*/} go build -ldflags "-s -w -X main.version=$version" -o "/dist/werkbuch-runner-${target%/*}-${target#*/}" . || exit 1; \
    done \
    && cd /dist && for file in werkbuch-runner-*; do sha256sum "$file" > "$file.sha256"; done

# ---------------------------------------------------------------------------------------------------------------------
# app: PHP-FPM + nginx (serversideup), runs as www-data (UID 33) on port 8080. v5.1.5 instead of the two-week-old
# v5.1.1 (A414): PHP 8.4.28 closes 14 holes of php-src (FPM request smuggling, session RCE), v5.1.3 adds
# "try_files $uri =404" before PHP-FPM and "security.limit_extensions = .php" (GHSA-8wf6-vq49-m6w2), v5.1.4 brings
# nginx 1.30.7. Since v5.1.0 the base compiles PHP itself (same docker-library Dockerfiles and configure options) and
# ships install-php-extensions 2.12.6; extensions, entrypoint scripts, healthchecks and security.conf are those of
# v5.0.4 (WEBU-2).
# ---------------------------------------------------------------------------------------------------------------------
FROM serversideup/php:8.4.28-fpm-nginx-trixie-v5.1.5@sha256:c98282869232f27b765324f6b7d58daee3552f63df13dfaa7074c66e58930e6e AS app

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
# the installer of the runner (/runner/install.sh) and its binaries with their sums (/runner/download/…, A520)
COPY resources/runner ./resources/runner
COPY --from=runner /dist ./runner/dist
COPY routes ./routes
# read at runtime by the MCP references (werkbuch.docs_path, A409)
COPY docs/en/concepts/views.md docs/en/concepts/rich-text.md docs/en/concepts/types-and-properties.md ./docs/en/concepts/
COPY --from=assets /app/public/build ./public/build

# Code, vendor, configuration and scripts belong to root and are read-only for PHP (www-data); only storage/ (the data
# volume is storage/app; compiled views) and bootstrap/cache (config, routes, events) stay writable, and Laravel's
# compiled PHP lives there. The base gives /var/www to www-data: whoever writes there could swap the code folder (A429).
# What COPY puts into a folder the base created keeps its owner www-data, so every code folder is chowned. The debug
# files of the base (read by PHP and FPM at start) and the folder server-opts.d (our server config) belong to root as
# well, performance.conf of the base in it too (the base never writes it at start): www-data can neither add nor change
# a server include. The rest of /etc/nginx stays writable, the base writes its templates there at start.
# package:discover boots the app; the channels resolve the broadcaster, and Reverb's keys exist only at start (3b).
RUN mkdir -p storage/app/private storage/app/public storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && BROADCAST_CONNECTION=null composer dump-autoload --no-dev --optimize --no-interaction \
    && chown root:root /var/www . && chmod 755 /var/www . \
    && chown -R root:root artisan LICENSE app bootstrap config database docs lang public resources routes runner vendor \
    && chmod -R a+rX,go-w artisan LICENSE app bootstrap config database docs lang public resources routes runner vendor \
    && chown root:root "$PHP_INI_DIR/conf.d/zzz-serversideup-docker-php-debug.ini" /usr/local/etc/php-fpm.d/zzz-docker-php-serversideup-fpm-debug.conf /usr/local/etc/php-fpm.conf \
    && chmod 644 "$PHP_INI_DIR/conf.d/zzz-serversideup-docker-php-debug.ini" /usr/local/etc/php-fpm.d/zzz-docker-php-serversideup-fpm-debug.conf /usr/local/etc/php-fpm.conf \
    && chown -R root:root /etc/nginx/server-opts.d && chmod 755 /etc/nginx/server-opts.d && chmod 644 /etc/nginx/server-opts.d/performance.conf \
    && chown -R www-data:www-data storage bootstrap/cache

USER www-data
