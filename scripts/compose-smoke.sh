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
    docker rm -f "${PROJECT}-runner" >/dev/null 2>&1 || true
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

# 1b. the runner from the instance (A520): install.sh in a container of the image on the host network (http only to
#     localhost, like the runner), as www-data (the installer refuses root), --no-service; the daemon polls a few
#     seconds, then werkbuch has the runner online (smoke runner revokes it). The unit it wrote is copied out and checked
#     with systemd-analyze here (the CI's Ubuntu has systemd; a Mac has none and skips it). Nothing is installed from
#     package mirrors.
RUNNER_BOX="${PROJECT}-runner"
code=$(smoke pair | sed -n 's/^smoke: code //p')
if [ -z "$code" ]; then
    echo "smoke: no one-time code for the runner" >&2
    exit 1
fi
# shellcheck disable=SC2016 # evaluated by sh in the container
docker run --name "$RUNNER_BOX" --network host --entrypoint sh -e HOME=/tmp/runner -e PATH=/tmp/runner/.local/bin:/usr/local/bin:/usr/bin:/bin \
    -e SMOKE_URL="http://localhost:${PORT}" -e CODE="$code" -e NAME="smoke-${SMOKE_PROBE}" "$WERKBUCH_IMAGE" -c '
        set -e
        mkdir -p "$HOME" && cd "$HOME"
        curl -fsSL "$SMOKE_URL/runner/install.sh" | sh -s -- --code "$CODE" --name "$NAME" --no-service
        test "$(werkbuch-runner version)" != dev
        status=0
        timeout 15 werkbuch-runner daemon 2>"$HOME/daemon.log" || status=$?
        if [ "$status" != 124 ]; then
            echo "smoke: the daemon of the runner ended with $status:" >&2
            cat "$HOME/daemon.log" >&2
            exit 1
        fi'
mkdir -p "$DIR/unit"
docker cp "$RUNNER_BOX:/tmp/runner/.config/systemd/user/werkbuch-runner.service" "$DIR/unit/werkbuch-runner.service" >/dev/null
docker cp "$RUNNER_BOX:/tmp/runner/daemon.log" "$DIR/daemon.log" >/dev/null
docker rm "$RUNNER_BOX" >/dev/null
echo "smoke: runner installed"
if command -v systemd-analyze >/dev/null 2>&1; then
    # the binary lives in the container: ExecStart points at a program of this machine, the rest stays as written
    sed -i "s#^ExecStart=[^ ]*#ExecStart=$(type -P true)#" "$DIR/unit/werkbuch-runner.service"
    mkdir -p "$DIR/xdg" && chmod 700 "$DIR/xdg"
    # verify ends with 0 on a line it ignores: every remark about the unit counts as a failure
    verified=$(XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-$DIR/xdg}" systemd-analyze --user verify "$DIR/unit/werkbuch-runner.service" 2>&1) || {
        echo "smoke: systemd-analyze refuses the unit: $verified" >&2
        exit 1
    }
    if grep -q 'werkbuch-runner.service' <<<"$verified"; then
        echo "smoke: systemd-analyze remarks on the unit: $verified" >&2
        exit 1
    fi
    echo "smoke: systemd unit ok"
else
    echo "smoke: no systemd-analyze on this machine, the unit stays unchecked (the CI checks it)"
fi
if ! smoke runner; then
    echo "smoke: the log of the runner's daemon:" >&2
    cat "$DIR/daemon.log" >&2
    exit 1
fi

# 2. inside the containers: never root, the code read-only, only storage/app writable, the hardening of the ini and
#    the patched libbrotli (Debian trixie's 1.1.0-2+deb13u1; v5.0.4 installed it itself), glibc. Since v5.1.0 the
#    base builds on the trixie packages of its build day, so the version can move with a new base: read it from the
#    image (dpkg-query -W libbrotli1) and set it here
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
