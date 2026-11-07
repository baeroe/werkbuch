#!/usr/bin/env bash
# The tag of a release must be the version the app reports (config/werkbuch.php, shown in the API and in MCP): the
# workflow .github/workflows/docker.yml runs this before anything is built or pushed.
#
#   scripts/release-version.sh 0.1.0
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
VERSION=${1:?usage: scripts/release-version.sh <version without v, e.g. 0.1.0>}

CONFIGURED=$(sed -n "s/^[[:space:]]*'version' => '\([^']*\)'.*/\1/p" "$ROOT/config/werkbuch.php" | head -n 1)

if [ "$CONFIGURED" != "$VERSION" ]; then
    echo "config/werkbuch.php has version ${CONFIGURED}, the tag says ${VERSION}" >&2
    exit 1
fi
