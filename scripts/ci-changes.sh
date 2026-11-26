#!/usr/bin/env bash
# Which of the slow optional jobs of .github/workflows/tests.yml a run needs (WEBU-46, A783). Reads the paths a pull
# request changes, one per line, on stdin and writes `image=true|false` and `load=true|false` (for $GITHUB_OUTPUT).
# With the argument `all` (a push to main) every job runs and stdin is not read.
#
#   git diff --name-only HEAD^1 HEAD | scripts/ci-changes.sh
#
# image: the Docker image and its smoke, for the Docker, runner and compose paths (Dockerfile, docker/, the compose files,
#   the smoke, the runner it ships, the manifests of the dependencies) and for what the image runs at its start: the
#   version and the routes (config/werkbuch.php, routes/, the route cache), the boot (bootstrap/) and the rules of the
#   agents it copies (resources/agents/). Any other change of the app reaches the image only on main.
# load: the load suite, which measures the app and the database against 50 000 items.
# Both: this script and the workflow itself.
set -euo pipefail

if [ "${1:-}" = all ]; then
  echo image=true
  echo load=true
  exit 0
fi

image=false
load=false

while IFS= read -r path; do
  case "$path" in
    .github/workflows/tests.yml | scripts/ci-changes.sh)
      image=true
      load=true
      ;;
  esac

  case "$path" in
    Dockerfile | .dockerignore | docker/* | docker-compose.yml | docker-compose.standalone.yml | .env.docker.example \
      | scripts/compose-smoke.* | runner/* | resources/runner/* | resources/agents/* | docs/en/concepts/* \
      | config/werkbuch.php | routes/* | bootstrap/* \
      | composer.json | composer.lock | package.json | pnpm-lock.yaml | pnpm-workspace.yaml | .node-version)
      image=true
      ;;
  esac

  case "$path" in
    app/* | database/* | config/* | routes/* | bootstrap/* | tests/Load/* | tests/Pest.php | tests/TestCase.php \
      | phpunit.load.xml | composer.json | composer.lock)
      load=true
      ;;
  esac
done

echo "image=$image"
echo "load=$load"
