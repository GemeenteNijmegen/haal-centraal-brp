#!/usr/bin/env bash
#
# query-audit-log.sh
#
# Zoekt in het verwerkingenlog (DynamoDB) alle bevragingen over één BSN, nieuwste eerst.
# Het log bevat geen BSN's, alleen een HMAC-SHA256 van het BSN met een geheime salt per
# omgeving. Dit script haalt die salt op uit Secrets Manager, berekent de hash op dezelfde
# manier als de lambda (AuditLog.hashBsn in src/personen/auditLog.ts) en bevraagt de tabel.
#
# Alleen-lezen: het script schrijft niets.
#
# Draai het met AWS-credentials voor de juiste omgeving (dev / accp / prod):
#
#   ./scripts/audit-log/query-audit-log.sh <bsn>
#   ./scripts/audit-log/query-audit-log.sh <bsn> --hash-only   # alleen de hash tonen
#
# Optioneel:
#   AUDIT_LOG_TABLE    tabelnaam, standaard de tabel met 'auditlog' in de naam
#   BSN_HASH_SALT      salt, standaard opgehaald uit Secrets Manager
#
# Vereist: aws cli, openssl
set -euo pipefail

SALT_SECRET_NAME='/cdk/haal-centraal-brp/bsn-hash-salt'

BSN="${1:-}"
HASH_ONLY="${2:-}"

if [[ ! "$BSN" =~ ^[0-9]{9}$ ]]; then
  echo "Gebruik: $0 <bsn (9 cijfers)> [--hash-only]" >&2
  exit 1
fi

SALT="${BSN_HASH_SALT:-}"
if [[ -z "$SALT" ]]; then
  SALT="$(aws secretsmanager get-secret-value \
    --secret-id "$SALT_SECRET_NAME" \
    --query SecretString \
    --output text)"
fi

BSN_HASH="$(printf '%s' "$BSN" | openssl dgst -sha256 -hmac "$SALT" | sed 's/.*= //')"

if [[ "$HASH_ONLY" == "--hash-only" ]]; then
  echo "$BSN_HASH"
  exit 0
fi

TABLE="${AUDIT_LOG_TABLE:-}"
if [[ -z "$TABLE" ]]; then
  TABLE="$(aws dynamodb list-tables \
    --query "TableNames[?contains(@, 'auditlog')] | [0]" \
    --output text)"
fi
if [[ -z "$TABLE" || "$TABLE" == "None" ]]; then
  echo "Geen audit log tabel gevonden, zet AUDIT_LOG_TABLE" >&2
  exit 1
fi

aws dynamodb query \
  --table-name "$TABLE" \
  --key-condition-expression 'bsnHash = :hash' \
  --expression-attribute-values "{\":hash\":{\"S\":\"$BSN_HASH\"}}" \
  --no-scan-index-forward
