#!/usr/bin/env bash
# Throwaway Postgres + PostgREST with the real results schema, for the opt-in store test
# (supabase/functions/_shared/leaguesphere/store.integration.test.ts).
#
#   bash scripts/results-parity/results-test-db.sh up
#   cd supabase/functions && RESULTS_TEST_POSTGREST_URL=... RESULTS_TEST_JWT_SECRET=... \
#     deno task test:db
#   bash scripts/results-parity/results-test-db.sh down
#
# Never touches the shared Supabase project. Ports differ from the manual recipe in readme.md
# (55432-55434) so both can run side by side.
set -euo pipefail

# Test-only value: PostgREST needs a secret of 32+ characters to verify the service-role JWT the
# test signs. The container is local and throwaway.
JWT_SECRET='results-test-only-jwt-secret-not-for-real-use-0123456789'

NETWORK=results-test
DB_CONTAINER=results-test-db
REST_CONTAINER=results-test-postgrest
DB_PORT=55442
REST_PORT=55443
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_DIR="$HERE/results-test-db"

up() {
  docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null

  docker run -d --name "$DB_CONTAINER" --network "$NETWORK" -p "$DB_PORT:5432" \
    -e POSTGRES_PASSWORD=postgres postgres:17-alpine >/dev/null

  # The image restarts once while initialising, so pg_isready can answer too early; require the
  # check to pass on consecutive polls.
  local ok=0
  for _ in $(seq 1 60); do
    if docker exec "$DB_CONTAINER" pg_isready -U postgres >/dev/null 2>&1 &&
      docker exec "$DB_CONTAINER" psql -U postgres -tAc 'select 1' >/dev/null 2>&1; then
      ok=$((ok + 1))
      [ "$ok" -ge 3 ] && break
    else
      ok=0
    fi
    sleep 1
  done
  [ "$ok" -ge 3 ] || { echo "database did not become ready" >&2; exit 1; }

  local file
  for file in "$SCHEMA_DIR/prelude.sql" "$SCHEMA_DIR"/2026*.sql; do
    docker exec -i -e PGOPTIONS="-c client_min_messages=error" "$DB_CONTAINER" \
      psql -U postgres -v ON_ERROR_STOP=1 -q < "$file"
  done

  docker run -d --name "$REST_CONTAINER" --network "$NETWORK" -p "$REST_PORT:3000" \
    -e PGRST_DB_URI="postgres://postgres:postgres@$DB_CONTAINER:5432/postgres" \
    -e PGRST_DB_SCHEMAS=public \
    -e PGRST_DB_ANON_ROLE=anon \
    -e PGRST_DB_MAX_ROWS=1000 \
    -e PGRST_JWT_SECRET="$JWT_SECRET" \
    postgrest/postgrest:v16.1 >/dev/null

  for _ in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$REST_PORT/" || true)" = 200 ] && break
    sleep 1
  done
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$REST_PORT/" || true)" = 200 ] ||
    { echo "PostgREST did not become ready" >&2; exit 1; }

  echo "export RESULTS_TEST_POSTGREST_URL=http://localhost:$REST_PORT"
  echo "export RESULTS_TEST_JWT_SECRET=$JWT_SECRET"
}

down() {
  docker rm -f "$REST_CONTAINER" "$DB_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}

case "${1:-}" in
  up) down; up ;;
  down) down ;;
  *) echo "usage: bash results-test-db.sh up|down" >&2; exit 2 ;;
esac
