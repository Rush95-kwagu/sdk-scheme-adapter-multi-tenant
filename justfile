# Overlay SDK + raccourcis logs DFSP (nœud sdk@cmcalavi-sdk-node)
#
# Dans le clone overlay :
#   just build
#   just logs moov
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
    {{docker}} logs sdk-mt-sdk-1 -f --tail="{{tail}}"

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
