#!/usr/bin/env bash
# Build Aegis Community (ce) and Enterprise (ee) Docker images from this one repo.
#   ce = Enterprise overlay stripped out (public, free)
#   ee = full build (private, license-gated)
# Usage: scripts/build-images.sh [ce|ee|both]   (default: both)
set -euo pipefail
cd "$(dirname "$0")/.."
git_sha="$(git rev-parse --short HEAD)"
which="${1:-both}"
[ "$which" = "both" ] && editions="ce ee" || editions="$which"

echo "Building Aegis images (git $git_sha): $editions"
for ed in $editions; do
  echo "== aegis-backend:$ed =="
  docker build --build-arg EDITION="$ed" --build-arg GIT_COMMIT="$git_sha" -t "aegis-backend:$ed" ./backend
  echo "== aegis-frontend:$ed =="
  docker build --build-arg EDITION="$ed" -t "aegis-frontend:$ed" ./frontend
done
echo "Done:"
docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep -E 'aegis-(backend|frontend):(ce|ee)'
