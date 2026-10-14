#!/usr/bin/env bash
# Découvre les mcm-agent-* du nœud et écrit :
#   lab/.env.tenants          MGMT_API_WS_URLS=...
#   lab/compose.tenants.yml   réseaux Docker externes à joindre
set -euo pipefail

DOCKER="${DOCKER:-docker}"
LAB_DIR="$(cd "$(dirname "$0")" && pwd)"
PRINT_ONLY=0
[[ "${1:-}" == "--print" ]] && PRINT_ONLY=1

is_skip_net() {
  case "$1" in
    bridge|host|none|ingress) return 0 ;;
    sdk-mt|sdk-mt_sdk-mt|sdk-fececam) return 0 ;;
  esac
  return 1
}

yaml_key() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/--*/-/g; s/^-//; s/-$//'
}

ids=()
while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  ids+=("${name#mcm-agent-}")
done < <("$DOCKER" ps --format '{{.Names}}' | grep '^mcm-agent-' | sed '/^$/d' | sort -u)

if [[ ${#ids[@]} -eq 0 ]]; then
  echo "error: no running mcm-agent-* containers" >&2
  echo "start Vault+agent stacks first" >&2
  exit 1
fi

declare -A net_by_key=()
urls=()

for id in "${ids[@]}"; do
  c="mcm-agent-${id}"
  nets="$("$DOCKER" inspect "$c" \
    -f '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' 2>/dev/null || true)"
  chosen=""
  while IFS= read -r n; do
    [[ -z "$n" ]] && continue
    is_skip_net "$n" && continue
    chosen="$n"
    break
  done <<< "$nets"
  if [[ -z "$chosen" ]]; then
    echo "error: $c has no usable docker network" >&2
    exit 1
  fi
  key="$(yaml_key "$id")"
  [[ -z "$key" ]] && key="dfsp${id}"
  # même réseau physique : une seule entrée compose
  dup=""
  for k in "${!net_by_key[@]}"; do
    if [[ "${net_by_key[$k]}" == "$chosen" ]]; then
      dup="$k"
      break
    fi
  done
  if [[ -z "$dup" ]]; then
    net_by_key["$key"]="$chosen"
  fi
  urls+=("${id}@${c}:4004")
  if [[ "$PRINT_ONLY" -eq 1 ]]; then
    printf '%s\t%s\t%s\n' "$id" "$c" "$chosen"
  fi
done

IFS=','; ws="${urls[*]}"; unset IFS

if [[ "$PRINT_ONLY" -eq 1 ]]; then
  echo "MGMT_API_WS_URLS=${ws}"
  exit 0
fi

{
  echo "# généré par discover-tenants.sh — ne pas éditer"
  echo "MGMT_API_WS_URLS=${ws}"
} > "${LAB_DIR}/.env.tenants"

{
  echo "# généré par discover-tenants.sh — ne pas éditer"
  echo "services:"
  echo "  sdk:"
  echo "    networks:"
  for k in $(printf '%s\n' "${!net_by_key[@]}" | sort); do
    echo "      ${k}:"
  done
  echo "networks:"
  for k in $(printf '%s\n' "${!net_by_key[@]}" | sort); do
    echo "  ${k}:"
    echo "    external: true"
    echo "    name: ${net_by_key[$k]}"
  done
} > "${LAB_DIR}/compose.tenants.yml"

echo "tenants: ${ids[*]}"
echo "MGMT_API_WS_URLS=${ws}"
echo "wrote ${LAB_DIR}/.env.tenants"
echo "wrote ${LAB_DIR}/compose.tenants.yml"
