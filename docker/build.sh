#!/usr/bin/env bash
# splatsite/docker/build.sh [tag] — native-arch build from the repo root; the other arch is built in CI.
set -euo pipefail
cd "$(dirname "$0")/../.."
TAG="${1:-splatsite-recon:dev}"
DOCKER_BUILDKIT=1 docker build -f splatsite/docker/Dockerfile -t "$TAG" . 2>&1 | tee "splatsite/docker/build-$(uname -m).log"
docker image inspect "$TAG" --format 'built {{.Id}} size {{.Size}} bytes'
