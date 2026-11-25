#!/usr/bin/env bash
#
# truststore-fingerprints.sh
#
# Berekent de canonieke SHA-256 fingerprint (lowercase hex, zonder dubbele punten)
# van de certificaten in een truststore .pem-bestand. Dit is exact het formaat dat de
# binding-check in de lambda verwacht in het DynamoDB-attribuut `certFingerprintsSha256`.
#
# Standaard worden alleen LEAF-certificaten (end-entity, Basic Constraints CA:FALSE of
# afwezig) getoond, omdat alleen die aan een leverancier worden gebonden. CA-certificaten
# (roots/intermediates) worden overgeslagen en apart gerapporteerd, zodat je ziet dat er
# niets gemist is.
#
# Plaats het truststore .pem-bestand in DEZELFDE map als dit script
# (scripts/truststore-fingerprint/). Maak het script eenmalig uitvoerbaar en draai het
# vanuit die map:
#
#   cd scripts/truststore-fingerprint
#   chmod +x truststore-fingerprints.sh
#   ./truststore-fingerprints.sh <truststore.pem>
#   ./truststore-fingerprints.sh <truststore.pem> --all   # ook CA's tonen
#
# Voorbeeld:
#   ./truststore-fingerprints.sh 'truststore(3).pem'
#
# Vereist: openssl
set -euo pipefail

PEM_FILE="${1:-}"
SHOW_ALL="${2:-}"

if [[ -z "$PEM_FILE" ]]; then
  echo "Gebruik: $0 <truststore.pem> [--all]" >&2
  exit 1
fi
if [[ ! -f "$PEM_FILE" ]]; then
  echo "Bestand niet gevonden: $PEM_FILE" >&2
  exit 1
fi

# Canonieke fingerprint: lowercase hex zonder dubbele punten (zelfde als normalizeFingerprint in de lambda)
canonical_fingerprint() {
  openssl x509 -in "$1" -noout -fingerprint -sha256 \
    | sed 's/.*=//; s/://g' \
    | tr 'A-Z' 'a-z'
}

# Bepaal of een cert een CA is (Basic Constraints CA:TRUE)
is_ca() {
  openssl x509 -in "$1" -noout -text 2>/dev/null \
    | grep -q "CA:TRUE"
}

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# Splits de bundle in losse cert-bestanden
awk -v dir="$WORKDIR" '
  /-----BEGIN CERTIFICATE-----/ { c++ }
  c > 0 { print > (dir "/cert-" c ".pem") }
' "$PEM_FILE"

leaf_count=0
ca_count=0
ca_subjects=()

echo "=================================================================="
echo " LEAF-certificaten (voor DynamoDB certFingerprintsSha256)"
echo "=================================================================="

for cf in "$WORKDIR"/cert-*.pem; do
  [[ -s "$cf" ]] || continue
  subject="$(openssl x509 -in "$cf" -noout -subject 2>/dev/null | sed 's/^subject=//')" || continue

  if is_ca "$cf"; then
    ca_count=$((ca_count + 1))
    ca_subjects+=("$subject")
    if [[ "$SHOW_ALL" == "--all" ]]; then
      fp="$(canonical_fingerprint "$cf")"
      echo ""
      echo "[CA - overslaan voor binding]"
      echo "  subject:     $subject"
      echo "  fingerprint: $fp"
    fi
    continue
  fi

  leaf_count=$((leaf_count + 1))
  fp="$(canonical_fingerprint "$cf")"
  issuer="$(openssl x509 -in "$cf" -noout -issuer 2>/dev/null | sed 's/^issuer=//')"
  not_after="$(openssl x509 -in "$cf" -noout -enddate 2>/dev/null | sed 's/^notAfter=//')"
  echo ""
  echo "  subject:     $subject"
  echo "  issuer:      $issuer"
  echo "  verloopt:    $not_after"
  echo "  fingerprint: $fp"
done

echo ""
echo "=================================================================="
echo " Samenvatting"
echo "=================================================================="
echo "  Leaf-certificaten (binding): $leaf_count"
echo "  CA-certificaten (overgeslagen): $ca_count"
if [[ "$SHOW_ALL" != "--all" && $ca_count -gt 0 ]]; then
  echo ""
  echo "  Overgeslagen CA's:"
  for s in "${ca_subjects[@]}"; do
    echo "    - $s"
  done
  echo ""
  echo "  (Draai met --all om ook de CA-fingerprints te zien.)"
fi
