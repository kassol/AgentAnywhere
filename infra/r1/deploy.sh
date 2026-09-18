#!/bin/sh
set -eu

cd "${1:-/opt/agentanywhere-r1}"
test "$(docker inspect -f '{{.State.Health.Status}}' agentanywhere-r1-postgres)" = healthy
POSTGRES_IP="$(docker inspect -f '{{(index .NetworkSettings.Networks "agentanywhere-r1_default").IPAddress}}' agentanywhere-r1-postgres)"
test -n "$POSTGRES_IP"
export POSTGRES_IP
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
