# Overlay SDK + raccourcis logs DFSP (nœud sdk@cmcalavi-sdk-node)
#
# Dans le clone overlay :
#   just build
#   just logs moov
#   just ports
#   just ports 10300
#   just ports 10300 1
#
# Copié en ~/.justfile :
#   just build          # cherche ~/sdk-fececam/sdk-scheme-adapter-multi-tenant
#   OVERLAY_DIR=/autre/chemin just build
#
# Si docker exige sudo :
#   just --set docker "sudo docker" logs moov

set shell := ["bash", "-eu", "-c"]

docker := "docker"
default_tail := "100"

overlay_dir := env("OVERLAY_DIR", justfile_directory())

default:
    @just --list

# Commandes, arguments et exemples
help:
    @printf '%s\n' \
      'Usage : just <commande> [arguments]' \
      '' \
      'Overlay' \
      '  just build                         découvre les mcm-agent, build et démarre le SDK partagé' \
      '  just tenants                       id et réseau Docker de chaque mcm-agent démarré' \
      '  just logs-overlay [tail]           logs du SDK partagé (sdk-fececam), tail défaut 100' \
      '' \
      'DFSP sur ce nœud' \
      '  just ids                           liste les identifiants DFSP' \
      '  just ps                            conteneurs sdk-scheme-adapter-*' \
      '  just logs <dfsp> [tail]            logs sdk-scheme-adapter-<id> (nom partiel accepté)' \
      '  just logs-mcm <dfsp> [tail]        logs mcm-agent-<id>' \
      '  just ports [from] [count]          ports déjà pris et prochains blocs libres' \
      '                                     from défaut 4000, count défaut 3' \
      '                                     bloc : XX00 inbound, XX01 outbound, XX03 mcm,' \
      '                                     XX04 simulateur, XX40 metrics' \
      '' \
      'Exemples' \
      '  just logs moov' \
      '  just logs moov 50' \
      '  just ports' \
      '  just ports 10300' \
      '  just ports 10300 1' \
      '' \
      'Variables' \
      '  OVERLAY_DIR=/chemin just build     autre clone que ~/sdk-fececam/...' \
      '  just --set docker "sudo docker" logs moov' \
      '' \
      'just help                              cette aide' \
      'just --list                            liste courte'

# --- overlay ---

# Découvre mcm-agent-*, génère les réseaux, build + up l’overlay
build:
    #!/usr/bin/env bash
    set -euo pipefail
    DOCKER="{{docker}}"
    ROOT="{{overlay_dir}}"
    if [[ ! -f "$ROOT/lab/docker-compose.yml" ]]; then
      ROOT="${HOME}/sdk-fececam/sdk-scheme-adapter-multi-tenant"
    fi
    if [[ ! -f "$ROOT/lab/docker-compose.yml" ]]; then
      echo "overlay not found (set OVERLAY_DIR)" >&2
      exit 1
    fi
    cd "$ROOT"
    unset AUTH_CLIENT_ID AUTH_CLIENT_SECRET COMPOSE_PROJECT_NAME || true
    mkdir -p lab
    if [[ ! -f lab/.env ]]; then
      cp lab/.env.example lab/.env
      echo "created lab/.env from example — edit OUTBOUND_API_KEY_* if needed"
    fi
    export DOCKER
    bash lab/discover-tenants.sh
    cd lab
    docker compose \
      --env-file .env \
      --env-file .env.tenants \
      -f docker-compose.yml \
      -f compose.tenants.yml \
      up --build -d

# Liste id + réseau Docker de chaque mcm-agent running
tenants:
    #!/usr/bin/env bash
    set -euo pipefail
    ROOT="{{overlay_dir}}"
    if [[ ! -f "$ROOT/lab/discover-tenants.sh" ]]; then
      ROOT="${HOME}/sdk-fececam/sdk-scheme-adapter-multi-tenant"
    fi
    export DOCKER="{{docker}}"
    bash "$ROOT/lab/discover-tenants.sh" --print

logs-overlay tail=default_tail:
    {{docker}} logs sdk-fececam -f --tail="{{tail}}"

# --- DFSP 1:1 (sdk-scheme-adapter-<id>) ---

ids:
    @just dfsp_id __list__

dfsp_id name:
    #!/usr/bin/env bash
    set -eu
    DOCKER="{{docker}}"
    raw="{{name}}"

    list_ids() {
        {
            "$DOCKER" ps -a --format '{{{{.Names}}}}' 2>/dev/null \
              | grep '^sdk-scheme-adapter-' \
              | sed 's/^sdk-scheme-adapter-//'
            "$DOCKER" ps --format '{{{{.Names}}}}' 2>/dev/null \
              | grep '^mcm-agent-' \
              | sed 's/^mcm-agent-//'
        } \
          | grep -vxE 'api-svc|mojaloop-testing-toolkit-ui|ml-testing-toolkit' \
          | grep -v '^init-kafka' \
          | grep -v '^$' \
          | sort -u
    }

    if [[ "$raw" == "__list__" ]]; then
        list_ids
        exit 0
    fi

    case "$raw" in
        calavi|cmcalavie) raw=cmcalavi ;;
    esac

    container_exists() {
        "$DOCKER" inspect "sdk-scheme-adapter-$1" >/dev/null 2>&1 \
          || "$DOCKER" inspect "mcm-agent-$1" >/dev/null 2>&1
    }

    if container_exists "$raw"; then
        echo "$raw"
        exit 0
    fi

    matches=()
    while IFS= read -r id; do
        [[ -z "$id" ]] && continue
        if [[ "$id" == "$raw" ]] || [[ "$id" == *"$raw"* ]] || [[ "$raw" == *"$id"* ]]; then
            matches+=("$id")
        fi
    done < <(list_ids)

    if [[ ${#matches[@]} -eq 1 ]]; then
        echo "${matches[0]}"
        exit 0
    fi

    if [[ ${#matches[@]} -gt 1 ]]; then
        echo "ambiguous DFSP '{{name}}' → ${matches[*]}" >&2
        echo "use full id, e.g.: just logs ${matches[0]}" >&2
        exit 1
    fi

    echo "unknown DFSP: {{name}}" >&2
    echo "available on this host:" >&2
    list_ids | sed 's/^/  /' >&2
    exit 1

container name:
    #!/usr/bin/env bash
    set -eu
    id=$(just dfsp_id "{{name}}")
    echo "sdk-scheme-adapter-${id}"

logs name tail=default_tail:
    #!/usr/bin/env bash
    set -eu
    c=$(just container "{{name}}")
    if ! {{docker}} inspect "$c" >/dev/null 2>&1; then
        echo "container not found: $c" >&2
        {{docker}} ps -a --filter "name=sdk-scheme-adapter-"
        exit 1
    fi
    exec {{docker}} logs "$c" -f --tail="{{tail}}"

logs-mcm name tail=default_tail:
    #!/usr/bin/env bash
    set -eu
    id=$(just dfsp_id "{{name}}")
    c="mcm-agent-${id}"
    if ! {{docker}} inspect "$c" >/dev/null 2>&1; then
        echo "container not found: $c" >&2
        exit 1
    fi
    exec {{docker}} logs "$c" -f --tail="{{tail}}"

ps:
    {{docker}} ps -a --filter "name=sdk-scheme-adapter-"

# Ports hôte déjà pris et prochain bloc SDK libre.
# Bloc : XX00 inbound, XX01 outbound, XX03 mcm, XX04 simulateur, XX40 metrics.
# Les conteneurs arrêtés comptent (un docker start reprend le port).
#   just ports
#   just ports 10300
#   just ports 10300 1
ports from="4000" count="3":
    #!/usr/bin/env bash
    set -euo pipefail
    DOCKER="{{docker}}"
    FROM="{{from}}"
    COUNT="{{count}}"
    STEP=100
    MAX=20000

    [[ "$FROM" =~ ^[0-9]+$ && "$COUNT" =~ ^[0-9]+$ ]] || {
      echo "usage: just ports [from] [count]" >&2
      exit 1
    }

    declare -A OWNER
    declare -A LISTEN
    declare -A SEEN
    port_keys=()
    listen_keys=()

    role_for() {
      local name="$1" cport="$2"
      case "$cport" in
        5000/tcp|5000/udp)
          if [[ "$name" == *mcm-agent* ]]; then printf '%s' mcm
          else printf '%s' inbound
          fi
          ;;
        5001/tcp|5001/udp) printf '%s' outbound ;;
        5040/tcp|5040/udp) printf '%s' metrics ;;
        3003/tcp|3003/udp) printf '%s' simulator ;;
        *) printf '%s' "-" ;;
      esac
    }

    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      name=${line%%|*}
      rest=${line#*|}
      ports=${rest%%|*}
      state=${rest#*|}
      [[ -n "$ports" ]] || continue
      while read -r hport cport; do
        [[ "$hport" =~ ^[0-9]+$ ]] || continue
        key="${hport}|${name}|${cport}"
        [[ -n "${SEEN[$key]+x}" ]] && continue
        SEEN[$key]=1
        role=$(role_for "$name" "$cport")
        row="${name}"$'\t'"${role}"$'\t'"${cport}"$'\t'"${state}"
        if [[ -z "${OWNER[$hport]+x}" ]]; then
          port_keys+=("$hport")
          OWNER[$hport]="$row"
        else
          OWNER[$hport]+=$'\n'"${row}"
        fi
      done < <(printf '%s\n' "$ports" | grep -oE '[0-9]+->[0-9]+/(tcp|udp)' | sed -E 's/([0-9]+)->([0-9]+)\/(tcp|udp)/\1 \2\/\3/' || true)
    done < <("$DOCKER" ps -a --format '{{{{.Names}}}}|{{{{.Ports}}}}|{{{{.Status}}}}')

    if command -v ss >/dev/null 2>&1; then
      while read -r port; do
        [[ "$port" =~ ^[0-9]+$ ]] || continue
        [[ -n "${LISTEN[$port]+x}" ]] && continue
        listen_keys+=("$port")
        LISTEN[$port]=1
      done < <(ss -lntH 2>/dev/null | awk '{print $4}' | awk -F: '{print $NF}' || true)
    fi

    taken() {
      local p="$1"
      [[ -n "${OWNER[$p]:-}" || -n "${LISTEN[$p]:-}" ]]
    }

    owner_hint() {
      local p="$1" line name
      line="${OWNER[$p]:-}"
      if [[ -n "$line" ]]; then
        name=$(printf '%s\n' "$line" | head -n 1 | cut -f1)
        printf '%s' "$name"
        return
      fi
      if [[ -n "${LISTEN[$p]:-}" ]]; then
        printf '%s' "écoute hôte"
      fi
    }

    echo "Ports publiés par Docker"
    if [[ ${#port_keys[@]} -eq 0 ]]; then
      echo "  (aucun)"
    else
      {
        printf 'PORT\tROLE\tCONTENEUR\tCIBLE\tETAT\n'
        while read -r p; do
          while IFS=$'\t' read -r name role cport state; do
            [[ -n "$name" ]] || continue
            printf '%s\t%s\t%s\t%s\t%s\n' "$p" "$role" "$name" "$cport" "$state"
          done <<<"${OWNER[$p]}"
        done < <(printf '%s\n' "${port_keys[@]}" | sort -n)
      } | column -t -s $'\t'
    fi

    echo
    echo "Écoute hôte sans publication Docker"
    bare=0
    if [[ ${#listen_keys[@]} -gt 0 ]]; then
      while read -r p; do
        [[ -n "${OWNER[$p]+x}" ]] && continue
        printf '  %s\n' "$p"
        bare=1
      done < <(printf '%s\n' "${listen_keys[@]}" | sort -n)
    fi
    [[ "$bare" == 1 ]] || echo "  (aucune)"

    block_conflicts() {
      local base="$1" off p
      CONFLICTS=()
      for off in 0 1 3 4 40; do
        p=$((base + off))
        if taken "$p"; then
          CONFLICTS+=("${p}($(owner_hint "$p"))")
        fi
      done
    }

    hi=$FROM
    if [[ ${#port_keys[@]} -gt 0 ]]; then
      top=$(printf '%s\n' "${port_keys[@]}" | sort -n | tail -n 1)
      hi=$(( (top / STEP) * STEP ))
      [[ "$hi" -lt "$FROM" ]] && hi=$FROM
    fi

    echo
    echo "Blocs occupés de ${FROM} à ${hi} (base, +1 outbound, +3 mcm, +4 simulateur, +40 metrics)"
    base=$FROM
    occupied=0
    while [[ "$base" -le "$hi" ]]; do
      block_conflicts "$base"
      if [[ ${#CONFLICTS[@]} -gt 0 ]]; then
        echo "  ${base} occupé : ${CONFLICTS[*]}"
        occupied=1
      fi
      base=$((base + STEP))
    done
    [[ "$occupied" == 1 ]] || echo "  (aucun)"

    echo
    echo "Prochains blocs libres"
    base=$FROM
    found=0
    while [[ "$base" -le "$MAX" && "$found" -lt "$COUNT" ]]; do
      block_conflicts "$base"
      if [[ ${#CONFLICTS[@]} -eq 0 ]]; then
        found=$((found + 1))
        echo
        echo "Bloc libre ${found} — base ${base}"
        printf '  %-12s %s → conteneur %s\n' inbound "$((base + 0))" 5000
        printf '  %-12s %s → conteneur %s\n' outbound "$((base + 1))" 5001
        printf '  %-12s %s → conteneur %s\n' mcm "$((base + 3))" 5000
        printf '  %-12s %s → conteneur %s\n' simulateur "$((base + 4))" 3003
        printf '  %-12s %s → conteneur %s\n' metrics "$((base + 40))" 5040
        printf '\n  # sdk-scheme-adapter\n  ports:\n    - "%s:5000"\n    - "%s:5001"\n    - "%s:5040"\n  # mcm-agent\n    - "%s:5000"\n  # simulateur\n    - "%s:3003"\n  # WAF proxy_pass http://<SDK_HOST>:%s;\n  #     mcm → <SDK_HOST>:%s\n' \
          "$base" "$((base + 1))" "$((base + 40))" "$((base + 3))" "$((base + 4))" "$base" "$((base + 3))"
      fi
      base=$((base + STEP))
    done

    if [[ "$found" -eq 0 ]]; then
      echo "aucun bloc libre entre ${FROM} et ${MAX}" >&2
      exit 1
    fi
