# SDK scheme-adapter multi-tenant (POC opérationnel)

Overlay **opt-in** sur `mojaloop/sdk-scheme-adapter:v24.9.0` : **un processus SDK**, **N `mcm-agent`**.

En lab openmfi, le mode **supporté aujourd’hui** reste **N stacks Compose** (un SDK + un agent + un Vault par DFSP) — voir [runbook onboarding](../../docs/participant/dfsp-onboarding-runbook.md) et [sdk-multi-dfsp](../../docs/participant/examples/sdk-multi-dfsp/README.md). Cet overlay est le chemin **communautaire** à valider avant de fusionner les caisses sur un seul processus.

Le SDK officiel n’a qu’un `ControlAgent` et applique `RECONFIGURE` par un `restart()` global. Ici, avec `PM4ML_MULTI_TENANT=true`, chaque websocket upsert un tenant dans `DfspConfigStore` **sans** redémarrer inbound/outbound.

Ce n’est **pas** encore une PR Mojaloop. C’est une version testable. Si le POC tient, la contribution communautaire reprend ces flags et ce store.

## Comportement

| Mode | Env | ControlAgent | Inbound | Outbound |
|------|-----|--------------|---------|----------|
| Officiel (défaut) | `PM4ML_MULTI_TENANT=false` | 1 URL, `restart()` | inchangé | inchangé |
| Multi-tenant | `PM4ML_MULTI_TENANT=true` | `MGMT_API_WS_URLS=host:port,...` | `/parties` (pas de préfixe) ; tenant = `Host` / `FSPIOP-Destination` | `/{dfspId}/...` |

`DFSP_HOST_SUFFIX` (défaut `.ext.openmfi.org`) : `clcam-calavi-test.ext.openmfi.org` → tenant `clcam-calavi-test`.

Debug : `GET /pm4ml-tenants`.

## Tester le POC (2 DFSPs factices)

Prérequis : Docker + Compose. Le build tire `mojaloop/sdk-scheme-adapter:v24.9.0`.

```bash
# Mac + Colima : le CLI Docker ne suffit pas, le daemon VM doit tourner
colima start
docker context use colima   # ou : export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock

cd contrib/sdk-scheme-adapter-multi-tenant
docker compose -f poc/docker-compose.yml up --build
```

Dans un autre terminal :

```bash
chmod +x poc/smoke.sh
./poc/smoke.sh
```

Gate de succès : `{"tenants":["dfsp-a","dfsp-b"]}` (ordre indifférent). Les deux mock-agents doivent rester connectés ; le SDK ne doit **pas** redémarrer inbound à chaque `NOTIFY`.

Arrêt : `docker compose -f poc/docker-compose.yml down -v`.

Guide déploiement réel (N backends, WAF, MCM) : [DEPLOY-REAL.md](DEPLOY-REAL.md).

## Brancher des vrais mcm-agents (après le POC)

Même image overlay, plus les mocks. **Un `BACKEND_ENDPOINT` par agent** (CBS distinct) ; le SDK n’impose pas un backend unique.

```text
PM4ML_ENABLED=true
PM4ML_MULTI_TENANT=true
DFSP_HOST_SUFFIX=.ext.openmfi.org
MGMT_API_WS_URLS=mcm-cmcalavi:4004,mcm-clcam-calavi-test:4004
```

Chaque agent reste 1 DFSP (Hydra, Vault, FQDN, cert). Le SDK agrège JWS/TLS/backend **par requête**.

Le SAN WAF (`*.bftlabs.org` vs `*.ext.openmfi.org`) n’est **pas** corrigé par cet overlay : le cert callback doit matcher le Host du DFSP.

## Fichiers overlay

- `overlay/modules/api-svc/src/lib/DfspConfigStore.js`
- `overlay/modules/api-svc/src/config.js` — `PM4ML_MULTI_TENANT`, `MGMT_API_WS_URLS`, `DFSP_HOST_SUFFIX`
- `overlay/modules/api-svc/src/index.js` — N clients, upsert, pas de `restart()` global
- inbound/outbound middlewares + handlers — overlay tenant par requête

Dockerfile : `FROM mojaloop/sdk-scheme-adapter:v24.9.0` + copie de l’overlay.

## Soumission communauté (si le POC passe)

Cible : `mojaloop/sdk-scheme-adapter`, feature flag off par défaut, tests d’intégration PM4ML à deux agents mock. Ne pas casser `MULTI_DFSP` (préfixe de chemin backend, autre cas d’usage).
# sdk-scheme-adapter-multi-tenant
