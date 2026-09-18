#!/bin/sh
set -eu

cd "${1:-/opt/agentanywhere-r1}"
AGENTANYWHERE_RELEASE="${2:?pass the full release commit SHA as the second argument}"
case "$AGENTANYWHERE_RELEASE" in
  *[!0123456789abcdef]*|'') printf 'Release must be a full lowercase commit SHA\n' >&2; exit 1 ;;
esac
if test "${#AGENTANYWHERE_RELEASE}" -ne 40; then
  printf 'Release must be a full 40-character commit SHA\n' >&2
  exit 1
fi
export AGENTANYWHERE_RELEASE

for component in web queue agent; do
  docker image inspect "agentanywhere-r1-$component:$AGENTANYWHERE_RELEASE" >/dev/null
done
test "$(docker inspect -f '{{.State.Health.Status}}' agentanywhere-r1-postgres)" = healthy
POSTGRES_IP="$(docker inspect -f '{{(index .NetworkSettings.Networks "agentanywhere-r1_default").IPAddress}}' agentanywhere-r1-postgres)"
test -n "$POSTGRES_IP"
export POSTGRES_IP
docker compose -f compose.yaml config --quiet
mkdir -p artifacts
chown 1000:1000 artifacts

docker compose -f compose.yaml up -d --no-deps --force-recreate web
attempt=0
until test "$(docker inspect -f '{{.State.Health.Status}}' agentanywhere-r1-web)" = healthy; do
  attempt=$((attempt + 1))
  if test "$attempt" -ge 60; then printf 'Web did not become healthy\n' >&2; exit 1; fi
  sleep 1
done
docker compose -f compose.yaml up -d --no-deps --force-recreate queue
