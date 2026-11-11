#!/usr/bin/env bash
# Lossless PNG compression of the docs screenshots (oxipng in Docker, pinned by digest, as in openbill): every new set
# weighs less in the git history. Part of `pnpm --dir e2e docs:screenshots`. The image of v10.2.1 exists for amd64 only;
# on an arm64 Mac Colima runs it emulated (a few seconds more).
set -euo pipefail

OXIPNG_IMAGE=ghcr.io/oxipng/oxipng:v10.2.1@sha256:5dec3e14566814807780eda0c7732fd77f2ce4fc12878ba71af9b408e97b3eb2
SHOTS=$(cd "$(dirname "$0")/../docs/public/screenshots" && pwd)

docker run --rm --platform linux/amd64 -v "$SHOTS:/shots" "$OXIPNG_IMAGE" --opt 4 --strip safe --alpha --recursive --quiet /shots
