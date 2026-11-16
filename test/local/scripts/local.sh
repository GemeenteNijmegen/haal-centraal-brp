#!/usr/bin/env bash
# Single entrypoint for running the Haal Centraal BRP API locally on
# MiniStack. See test/local/README.md.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

REGION=eu-central-1
ACCOUNT=000000000000
API_URL=http://localhost:4566/_aws/execute-api/haal-centraal/prod

export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=$REGION
export AWS_REGION=$REGION

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Individual steps:
  up              Start MiniStack and the BRP mock
  down            Tear down the docker compose stack (including volumes)
  deploy          Create the client certificate (once), cdk bootstrap +
                  cdk deploy LocalHaalCentraalStack into MiniStack, then
                  seed the application profiles
  test            Run the tests in tests/ against the running stack
  logs [function] Poll and print a Lambda's CloudWatch logs (default:
                  personen, Ctrl-C to stop)

Combinations:
  start           down, up, deploy - full stack from scratch
EOF
}

cmd_up() {
  docker compose up -d

  echo "Waiting for MiniStack..."
  until curl -sf http://localhost:4566/_ministack/health > /dev/null; do sleep 1; done
}

cmd_down() {
  docker compose down -v
}

cmd_certificate() {
  # The lambdas call the BRP API with a client certificate. The mock doesn't
  # check it, but it must be valid PEM.
  if [ ! -f .certs/client.crt ]; then
    mkdir -p .certs
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
      -subj "/CN=haal-centraal-local" \
      -keyout .certs/client.key -out .certs/client.crt 2> /dev/null
  fi
}

cmd_deploy() {
  cmd_certificate
  npx cdk bootstrap "aws://${ACCOUNT}/${REGION}"
  npx cdk deploy --require-approval never
  npx ts-node --prefer-ts-exts scripts/seed.ts
}

cmd_test() {
  (
    cd ../..
    npx jest --coverage=false --testMatch '<rootDir>/test/local/tests/**/*.local.ts' "$@"
  )
}

cmd_logs() {
  # `aws logs tail --follow` crashes against MiniStack with `[ERROR]: 'eventId'`:
  # its --follow implementation reads event['eventId'] for client-side dedup,
  # which MiniStack's FilterLogEvents doesn't return. This polls
  # FilterLogEvents directly instead.
  local log_group="/aws/lambda/local-${1:-personen}"
  local start_time
  start_time=$(($(date +%s) * 1000))

  echo "Polling ${log_group} every 2s (Ctrl-C to stop)..."
  while true; do
    events=$(aws logs filter-log-events \
      --log-group-name "$log_group" \
      --start-time "$start_time" \
      --output json 2>/dev/null) || events='{"events":[]}'

    count=$(echo "$events" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['events']))")
    if [ "$count" -gt 0 ]; then
      echo "$events" | python3 -c "
import json, sys
for e in json.load(sys.stdin)['events']:
    print(e['message'].rstrip())
"
      start_time=$(echo "$events" | python3 -c "import json,sys; print(max(e['timestamp'] for e in json.load(sys.stdin)['events']) + 1)")
    fi
    sleep 2
  done
}

cmd_start() {
  cmd_down
  cmd_up
  cmd_deploy
  echo
  cat <<EOF
The Haal Centraal BRP API is running on ${API_URL}

Try it (test person 999999333, Nasier Boeddhoe):
  curl -X POST ${API_URL}/personen \\
    -H 'Content-Type: application/json' \\
    -H 'X-API-KEY: local-full-api-key-0123456789' \\
    -H 'x-gebruiker: local-user' -H 'x-doelbinding: local-test' \\
    -d '{"type":"RaadpleegMetBurgerservicenummer","burgerservicenummer":["999999333"],"fields":["naam"]}'
EOF
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  deploy) cmd_deploy ;;
  test) shift; cmd_test "$@" ;;
  logs) cmd_logs "${2:-}" ;;
  start) cmd_start ;;
  -h|--help|help|"") usage ;;
  *)
    echo "Unknown command: $1" >&2
    usage >&2
    exit 1
    ;;
esac
