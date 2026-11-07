#!/usr/bin/env bash
# Smoke test of the compose stack with a built image, on the Mac against Colima (never in parallel to e2e):
#   docker buildx build --load -t werkbuch:local . && WERKBUCH_IMAGE=werkbuch:local scripts/compose-smoke.sh
# Starts docker-compose.yml with a fresh .env in a temporary folder, runs scripts/compose-smoke.mjs, checks inside the
# containers what only the image changes, the access log, and a second start of the same volumes. At the end it
# removes the stack with its volumes (SMOKE_KEEP=1 keeps it). SMOKE_PROJECT names the compose project, SMOKE_PORT the
# port on 127.0.0.1. Last line on success: `smoke: ok`.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
: "${WERKBUCH_IMAGE:?WERKBUCH_IMAGE missing (for example werkbuch:local)}"
PROJECT=${SMOKE_PROJECT:-werkbuch-smoke}
PORT=${SMOKE_PORT:-7740}
# the end of the smoke runs `down -v` on this project: never on one that has containers or volumes already
existing=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT"; docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT")
if [ -n "$existing" ]; then
    echo "smoke: the compose project $PROJECT exists already (containers or volumes); remove it or set SMOKE_PROJECT to another name" >&2
    exit 1
fi
if [ -z "${SMOKE_PROBE:-}" ]; then
    # a fixed amount of random bytes: `tr < /dev/urandom | head` ends tr with SIGPIPE, which pipefail turns into a failure
    SMOKE_PROBE=$(head -c 4096 /dev/urandom | LC_ALL=C tr -dc '[:lower:]' | cut -c 1-12)
fi
export SMOKE_PROBE

DIR=$(mktemp -d)
ENV="$DIR/.env"
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=$(openssl rand -hex 24)
cat > "$ENV" <<EOF
APP_URL=http://localhost:${PORT}
WERKBUCH_BIND=127.0.0.1
WERKBUCH_PORT=${PORT}
WERKBUCH_IMAGE=${WERKBUCH_IMAGE}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
DB_PASSWORD=$(openssl rand -hex 24)
DB_ROOT_PASSWORD=$(openssl rand -hex 24)
MEILISEARCH_KEY=$(openssl rand -hex 24)
EOF
echo "smoke: environment in $ENV (project $PROJECT, probe $SMOKE_PROBE)"

dc() { docker compose -p "$PROJECT" --env-file "$ENV" -f "$ROOT/docker-compose.yml" "$@"; }

finish() {
    local status=$?
    if [ "$status" -ne 0 ]; then
        echo "smoke: failed, the last lines of the logs:" >&2
        dc logs --no-color 2>&1 | tail -n 400 >&2 || true
    fi
    if [ "${SMOKE_KEEP:-}" = 1 ]; then
        echo "smoke: SMOKE_KEEP=1, the stack $PROJECT stays (remove: docker compose -p $PROJECT --env-file $ENV -f $ROOT/docker-compose.yml down -v)"
    else
        dc down -v --remove-orphans >/dev/null 2>&1 || true
        rm -rf "$DIR"
    fi
    exit "$status"
}
trap finish EXIT

smoke() { # <mode>
    SMOKE_URL="http://localhost:${PORT}" SMOKE_EMAIL="$ADMIN_EMAIL" SMOKE_PASSWORD="$ADMIN_PASSWORD" SMOKE_MODE="$1" \
        node "$ROOT/scripts/compose-smoke.mjs"
}

# 1. first start, then the checks over HTTP
dc up -d --wait --wait-timeout 300
smoke full

# 2. inside the containers: never root, the code read-only, only storage/app writable, the hardening of the ini and
#    the patched libbrotli (v5.0.4), glibc
# shellcheck disable=SC2016 # evaluated by sh in the container
dc exec -T werkbuch sh -c 'test "$(id -u)" != 0 && test ! -w /var/www && test ! -w /var/www/html && test ! -w app && test ! -w vendor && test -w storage/app && test ! -w "$PHP_INI_DIR/conf.d/zzz-serversideup-docker-php-debug.ini" && php -r "exit(ini_get(\"zend.exception_ignore_args\") === \"1\" ? 0 : 1);" && php -r "exit(in_array(ini_get(\"session.upload_progress.enabled\"), [\"\", \"0\"], true) ? 0 : 1);" && test "$(dpkg-query -W -f="\${Version}" libbrotli1)" = 1.1.0-2+deb13u1 && getconf GNU_LIBC_VERSION'
for service in queue reverb; do
    # shellcheck disable=SC2016
    dc exec -T "$service" sh -c 'test "$(id -u)" != 0'
done
echo "smoke: container ok"

# 3. the access log: the reset page is there, its token (the probe) is not
log=$(dc logs --no-color werkbuch)
if grep -q -- "$SMOKE_PROBE" <<<"$log"; then
    echo "smoke: the log of werkbuch contains the probe $SMOKE_PROBE" >&2
    grep -- "$SMOKE_PROBE" <<<"$log" >&2
    exit 1
fi
if ! grep -q -- "/reset-password/" <<<"$log"; then
    echo "smoke: the log of werkbuch has no line for /reset-password/" >&2
    exit 1
fi
echo "smoke: log ok"

# 4. new containers on the same volumes: the same key, the same single account
# shellcheck disable=SC2016
key_hash() { dc exec -T werkbuch sh -c 'sha256sum storage/app/.app-key' | cut -d ' ' -f 1; }
before=$(key_hash)
dc up -d --force-recreate --wait --wait-timeout 300
after=$(key_hash)
if [ -z "$before" ] || [ "$before" != "$after" ]; then
    echo "smoke: storage/app/.app-key changed with the new containers ($before → $after)" >&2
    exit 1
fi
echo "smoke: key kept"
smoke again
