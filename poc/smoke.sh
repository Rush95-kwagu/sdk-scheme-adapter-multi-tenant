#!/usr/bin/env bash
set -euo pipefail

IN="${IN:-4000}"
OUT="${OUT:-4001}"

echo "== waiting for SDK /pm4ml-tenants =="
for i in $(seq 1 30); do
  body="$(curl -sS --max-time 2 "http://127.0.0.1:${IN}/pm4ml-tenants" 2>/dev/null || true)"
  if echo "$body" | grep -q 'dfsp-a' && echo "$body" | grep -q 'dfsp-b'; then
    echo "$body"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "timeout waiting for tenants: ${body:-empty reply}" >&2
    exit 1
  fi
  sleep 1
done
echo

echo "== inbound host routing dfsp-a =="
curl -sS -o /tmp/in-a.json -w "HTTP %{http_code}\n" \
  -H "Host: dfsp-a.ext.openmfi.org" \
  -H "Accept: application/vnd.interoperability.parties+json;version=1.1" \
  -H "Content-Type: application/vnd.interoperability.parties+json;version=1.1" \
  -H "Date: $(date -u +%a,\ %d\ %b\ %Y\ %H:%M:%S\ GMT)" \
  -H "FSPIOP-Source: Hub" \
  -H "FSPIOP-Destination: dfsp-a" \
  "http://127.0.0.1:${IN}/parties/MSISDN/22961000001" || true
head -c 400 /tmp/in-a.json; echo

echo "== inbound host routing dfsp-b =="
curl -sS -o /tmp/in-b.json -w "HTTP %{http_code}\n" \
  -H "Host: dfsp-b.ext.openmfi.org" \
  -H "Accept: application/vnd.interoperability.parties+json;version=1.1" \
  -H "Content-Type: application/vnd.interoperability.parties+json;version=1.1" \
  -H "Date: $(date -u +%a,\ %d\ %b\ %Y\ %H:%M:%S\ GMT)" \
  -H "FSPIOP-Source: Hub" \
  -H "FSPIOP-Destination: dfsp-b" \
  "http://127.0.0.1:${IN}/parties/MSISDN/22961000002" || true
head -c 400 /tmp/in-b.json; echo

echo "== outbound path prefix dfsp-a (health, pas d'ALS) =="
curl -sS -o /tmp/out-a.json -w "HTTP %{http_code}\n" \
  "http://127.0.0.1:${OUT}/dfsp-a/" || true
head -c 400 /tmp/out-a.json; echo

echo "== outbound path prefix dfsp-b (health) =="
curl -sS -o /tmp/out-b.json -w "HTTP %{http_code}\n" \
  "http://127.0.0.1:${OUT}/dfsp-b/" || true
head -c 400 /tmp/out-b.json; echo

echo
echo "Gate: GET /pm4ml-tenants -> {\"tenants\":[\"dfsp-a\",\"dfsp-b\"]}."
echo "Inbound Host routing: 202. Outbound /{dfspId}/ : 200 (le GET /parties appelle l'ALS ; hors scope mock)."
