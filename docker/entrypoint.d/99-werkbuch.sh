#!/bin/sh
# werkbuch start-up, for every container of the image: the web service (nginx + PHP-FPM, serversideup's /init) and
# the workers (queues, scheduler, Reverb: `php artisan …`). serversideup's entrypoint sources every
# /etc/entrypoint.d/*.sh in a subshell before the command: exported variables never reach the command, which is why
# the config cache at the end (with APP_KEY and Reverb's keys) is what PHP reads. Never run config:clear or
# optimize:clear in a running container: `docker compose restart <service>` builds the cache again. A failing step
# stops the container with a message, so a half-migrated instance never serves requests.
set -e
cd /var/www/html

log() { echo "werkbuch: $*"; }

# 0. the placeholders of docker-compose.standalone.yml are no passwords (MariaDB and Meilisearch would take them)
for name in DB_PASSWORD MEILISEARCH_KEY; do
    eval "value=\${$name:-}"
    if [ "$value" = "change-me" ]; then
        log "$name is still the placeholder change-me: set your own value before the first start" >&2
        exit 1
    fi
done

# 1. role: serversideup's entrypoint exports SERVERSIDEUP_DEFAULT_COMMAND=true for /init (nginx + PHP-FPM)
if [ "${SERVERSIDEUP_DEFAULT_COMMAND:-}" = "true" ]; then
    role=web
else
    role=worker
fi

# 2. data volume (storage/app): the disks local (private) and public; Reverb mounts the volume read-only
if [ "$role" = web ]; then
    mkdir -p storage/app/private storage/app/public
fi

# 3. the keys: from the environment, else from the data volume (they survive new containers), else made once by the
#    web service. APP_KEY encrypts the secrets of webhooks and second factors: never lose .app-key, never change it.
#    A new key goes to <file>.tmp first and is moved: a start that breaks off never leaves half a key in the volume.
key() { # <variable> <file> <how to make a value>
    eval "value=\${$1:-}"
    if [ -z "$value" ] && [ -s "$2" ]; then
        value=$(cat "$2")
    fi
    if [ -z "$value" ]; then
        if [ "$role" != web ]; then
            log "$1 missing in $2: start the werkbuch service first, it makes the keys" >&2
            exit 1
        fi
        value=$($3)
        rm -f "$2.tmp"
        (umask 077 && printf '%s' "$value" > "$2.tmp")
        mv -f "$2.tmp" "$2"
        log "generated $1 in $2 (data volume)"
    fi
    export "$1=$value"
}
app_key() { echo "base64:$(head -c 32 /dev/urandom | base64)"; }
hex20() { od -An -tx1 -N10 /dev/urandom | tr -d ' \n'; }
hex64() { od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; }

key APP_KEY storage/app/.app-key app_key
key REVERB_APP_KEY storage/app/.reverb-app-key hex20
key REVERB_APP_SECRET storage/app/.reverb-app-secret hex64

# 4. a config cache from an earlier start of this container would hide changed environment variables
php artisan config:clear --no-interaction

if [ "$role" = web ]; then
    # 5. wait for the database (first start: MariaDB initialises; external databases may be slow)
    timeout=${DB_WAIT_TIMEOUT:-60}
    waited=0
    # shellcheck disable=SC2016 # PHP code, the $ belong to PHP
    until error=$(php -r '
        $dsn = sprintf("mysql:host=%s;port=%s", getenv("DB_HOST") ?: "mariadb", getenv("DB_PORT") ?: "3306");
        try {
            new PDO($dsn, (string) getenv("DB_USERNAME"), (string) getenv("DB_PASSWORD"), [PDO::ATTR_TIMEOUT => 3]);
        } catch (Throwable $e) {
            echo $e->getMessage();
            exit(1);
        }
    '); do
        if [ "$waited" -ge "$timeout" ]; then
            log "database ${DB_HOST:-mariadb}:${DB_PORT:-3306} not reachable after ${timeout}s: $error" >&2
            exit 1
        fi
        sleep 2
        waited=$((waited + 2))
    done

    # schema, the first account (only while there is none), the search settings and, on an empty or outdated
    # index, the import
    php artisan migrate --force --no-interaction
    status=0
    out=$(php artisan app:ensure-admin --no-interaction) || status=$?
    if [ -n "$out" ]; then
        printf '%s\n' "$out"
    fi
    if [ "$status" -ne 0 ]; then
        exit "$status"
    fi
    case "$out" in
        *"ADMIN_EMAIL/ADMIN_PASSWORD are not set"*) log "no account yet, set ADMIN_EMAIL and ADMIN_PASSWORD and restart" ;;
    esac
    php artisan app:search-sync --no-interaction
    php artisan app:search-import --if-empty --no-interaction
fi

# 6. caches for production: config (with the keys), routes, views, events; each container builds its own
php artisan optimize --no-interaction

if [ "$role" = web ]; then
    # 7. the OpenAPI document, and a warning when PHP takes smaller bodies than an attachment may be
    php artisan scramble:cache --no-interaction
    # shellcheck disable=SC2016 # PHP code
    if ! php -r 'exit((int) (getenv("ATTACHMENTS_MAX_MB") ?: 25) * 1048576 > ini_parse_quantity(ini_get("post_max_size")) ? 1 : 0);'; then
        log "ATTACHMENTS_MAX_MB is larger than post_max_size of PHP: larger uploads end in 413 before werkbuch sees them" >&2
    fi
    log "ready"
else
    log "ready: ${DOCKER_CMD:-}"
fi
