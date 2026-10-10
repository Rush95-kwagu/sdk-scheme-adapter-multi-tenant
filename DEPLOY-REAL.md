# Guide — brancher de vrais DFSP sur le SDK multi-tenant

[docs](../../docs/index.md) / [Participant](../../docs/participant/index.md) / SDK multi-tenant réel

**Audiences:** hub operator (lab), participant (DFSP operator)

Le POC (`poc/`) est validé (2 mock-agents, inbound 202, outbound 200). Ce document décrit le **cas réel** : un processus SDK overlay, **N** `mcm-agent`, **N backends**.

Le lab openmfi **en production aujourd’hui** reste [N stacks Compose](../../docs/participant/dfsp-onboarding-runbook.md) (un SDK par DFSP). Ne bascule un DFSP réel sur cet overlay qu’après un créneau de test dédié.

---

## 1. Ce qui est partagé vs ce qui ne l’est pas

| Ressource | Partagé (1 pour N DFSP) | Un par DFSP |
|-----------|-------------------------|-------------|
| Processus `sdk-scheme-adapter` (image overlay) | oui | — |
| Redis du SDK | oui | — |
| Port inbound Hub (`:5000` conteneur) | oui | — |
| Port outbound CBS (`:5001`) | oui — discrimination par `/{dfspId}/` | — |
| `mcm-agent` + Vault + client Hydra | — | **oui** |
| `DFSP_ID`, FQDN, certs JWS / mTLS | — | **oui** |
| **Backend CBS** (`BACKEND_ENDPOINT`) | — | **oui** (c’est le cas normal) |
| Vhost WAF `https://<dfsp>.ext.openmfi.org` | — | **oui** (même `proxy_pass` cible) |
| Endpoints MCM FSPIOP | — | **oui** (`https://<FQDN>` sans path) |

Plusieurs backends : **oui**. Le SDK ne suppose pas un CBS unique. Chaque `NOTIFY` PM4ML upsert `backendEndpoint` dans `DfspConfigStore` sous le `dfspId`. La requête inbound/outbound applique **ce** backend.

Exemples :

```text
cmcalavi / gto      →  172.16.2.16:8100/mojaloop
clcam-calavi-test   →  172.16.2.16:8101/mojaloop
clcam-jardins-test  →  172.16.2.16:8102/mojaloop
moov                →  192.168.0.140:8000/mojaloop
```

`172.16.2.16:8100` sans `/mojaloop` est le SPA Granian (GET HTML, POST `/quoterequests` → 405). L’API connecteur est `…:8100/mojaloop`. Le NOTIFY agent écrase le fallback Compose : changer le `.env` des **deux** agents puis les recréer.

Sans espace dans l’URL. Sans `http://` : le SDK préfixe `http://` tout seul (`http://http://…` casse).

Un même connecteur OpenCBS avec **deux tenants** = deux `BACKEND_ENDPOINT` (deux ports proxy), pas un backend partagé.

---

## 2. Topologie réelle

```text
Hub ALS / quoting
    │  GET/POST https://<dfsp>.ext.openmfi.org/parties|quotes|transfers
    ▼
WAF 41.214.65.90:443     (un server_name par DFSP, TLS openmfi.org)
    │  proxy_pass http://<SDK_HOST>:<PORT_INBOUND_PARTAGE>
    ▼
SDK overlay :5000 inbound     tenant = Host / FSPIOP-Destination
    │                         backend = store[dfspId].backendEndpoint
    ├─ WS :4004 ── mcm-agent-calavi   (Vault A, Hydra calavi)
    ├─ WS :4004 ── mcm-agent-jardins  (Vault B, Hydra jardins)
    └─ CBS
         ├─ GET/POST http://172.16.2.16:8101/...
         └─ GET/POST http://172.16.2.16:8102/...

CBS / testers
    │  POST http://<SDK_HOST>:<PORT_OUTBOUND_PARTAGE>/<dfspId>/transfers
    ▼
SDK overlay :5001 outbound
```

Le Hub **n’atteint pas** `172.25.2.117`. Callbacks = FQDN WAF en **https://**.

---

## 3. Inventaire à figer

| Variable | Exemple | Notes |
|----------|---------|--------|
| `SDK_INBOUND_HOST_PORT` | `11000` | **Un** port pour tous les DFSP de ce SDK |
| `SDK_OUTBOUND_HOST_PORT` | `11001` | Idem ; API `/{dfspId}/…` |
| `SDK_METRICS_HOST_PORT` | `11040` | |
| Par DFSP : `MCM_HOST_PORT` | `11003`, `11103`, … | UI agent, unique |
| `<DFSP_ID>` | `clcam-calavi-test` | = Hydra `client_id` = ledger |
| `<DFSP_FQDN>` | `clcam-calavi-test.ext.openmfi.org` | |
| `<BACKEND_ENDPOINT>` | `172.16.2.16:8101/mojaloop` | Sans schéma |

Ne pas réutiliser 4000–10103 déjà pris par les stacks 1-SDK-par-DFSP tant qu’ils tournent.

---

## 4. Par DFSP (inchangé par rapport au runbook)

Pour **chaque** caisse, comme aujourd’hui :

1. Client Hydra `client_credentials`, `client_id` = `<DFSP_ID>`.
2. MCM : créer le DFSP, zone `XOF`.
3. Participant central-ledger.
4. Stack **agent seul** : Vault + `mcm-agent` + `default.json` (`tokenPath` `/oauth2/token`).
   - **Pas** de `sdk-scheme-adapter` dans ce compose.
   - `DFSP_ID`, `DFSP_FQDN`, `AUTH_CLIENT_*`, `BACKEND_ENDPOINT` dans le `.env` de **cet** agent.
   - Port hôte `4004` **non publié** (réseau Docker uniquement), ou un `expose: ["4004"]`.
   - `extra_hosts` : `hydra`/`mcm` → `41.214.65.90`, `extapi` → `172.16.2.28`.
5. Signer CSR jusqu’à Status **8/8**.
6. DNS A : `<DFSP_FQDN>` et `mcm-<DFSP_ID>.ext.openmfi.org` → `41.214.65.90` (pas l’IP SDK, pas `/etc/hosts` vers `172.25.2.117`).
7. MCM : **tous** les callbacks FSPIOP = `https://<DFSP_FQDN>` (pas `http://`, pas d’IP, pas de `/quotes`).

Détail agent / Hydra / Vault : [Compose lab](../../docs/participant/dfsp-onboarding-compose-lab.md).  
WAF / ALS / transferts : [runbook](../../docs/participant/dfsp-onboarding-runbook.md).

---

## 5. SDK partagé (une fois)

Image : `contrib/sdk-scheme-adapter-multi-tenant/Dockerfile` (`FROM mojaloop/sdk-scheme-adapter:v24.9.0` + overlay).

Réseau Docker **commun** avec les agents (ex. `sdk-openmfi`). Les noms WS doivent matcher `container_name` :

```text
MGMT_API_WS_URLS=mcm-agent-clcam-calavi-test:4004,mcm-agent-clcam-jardins-test:4004
```

Variables SDK :

```text
PM4ML_ENABLED=true
PM4ML_MULTI_TENANT=true
DFSP_HOST_SUFFIX=.ext.openmfi.org
DFSP_ID=placeholder
CACHE_URL=redis://redis:6379
PEER_ENDPOINT=extapi.openmfi.org
ALS_ENDPOINT=extapi.openmfi.org
QUOTES_ENDPOINT=extapi.openmfi.org
TRANSFERS_ENDPOINT=extapi.openmfi.org
BACKEND_ENDPOINT=127.0.0.1:9
INBOUND_LISTEN_PORT=5000
OUTBOUND_LISTEN_PORT=5001
INBOUND_MUTUAL_TLS_ENABLED=false
OUTBOUND_MUTUAL_TLS_ENABLED=true
JWS_SIGN=true
VALIDATE_INBOUND_JWS=false
ENABLE_BACKEND_EVENT_HANDLER=false
ENABLE_FSPIOP_EVENT_HANDLER=false
NODE_TLS_REJECT_UNAUTHORIZED=0
```

`BACKEND_ENDPOINT` du SDK est un **fallback**. La valeur réelle arrive par chaque agent.

`extra_hosts` du SDK : `extapi.openmfi.org:172.16.2.28`.

Vérif :

```bash
curl -sS http://127.0.0.1:<PORT_INBOUND>/pm4ml-tenants
# {"tenants":["clcam-calavi-test","clcam-jardins-test"]}
```

---

## 6. WAF

Pour chaque DFSP, `listen 443` :

```nginx
server_name <DFSP_ID>.ext.openmfi.org;
# Tous vers LE MÊME inbound partagé
proxy_pass http://172.25.2.117:<PORT_INBOUND_PARTAGE>;
```

`mcm-<id>.ext.openmfi.org` → `:<MCM_HOST_PORT>` de **cet** agent (ports différents).

HTTP `:80` : ajouter les FQDN au `server_name` du `return 301 https://…`.

`nginx -t && systemctl reload nginx`.

`GET /ping` sur le FQDN → **405**. SAN du certificat = zone openmfi, pas `cbs.bftlabs.org`.

---

## 7. Appels CBS / tests (outbound partagé)

| Action | URL |
|--------|-----|
| Lookup / transfert **en tant que** calavi-test | `http://172.25.2.117:<OUT>/clcam-calavi-test/parties/…` et `…/transfers` |
| Idem jardins-test | `http://172.25.2.117:<OUT>/clcam-jardins-test/transfers` |

Sans préfixe, le SDK ne sait pas quel `dfspId` / JWS / backend utiliser.

Inbound Hub : **pas** de préfixe (`/quotes`, `/parties`).

---

## 8. Tests après branchement

1. `GET /pm4ml-tenants` contient tous les `DFSP_ID`.
2. Lookup Moov (`:6001`) d’un alias mappé vers le DFSP → `fspId` correct, `COMPLETED`.
3. `POST /transfers` Moov → DFSP → `COMPLETED` (comme calavi-test / jardins-test en stacks séparés).
4. Logs SDK : pas de `http://http://`, pas de `//host`, pas de `restart()` inbound à chaque NOTIFY.
5. Quote 1001 + Axios 400 : callback MCM encore en `http://` (301 WAF).

---

## 9. Ajouter un N-ième DFSP

1. Nouveau Hydra + MCM + ledger + agent Compose (Vault dédié).
2. Ajouter `mcm-agent-<id>:4004` à `MGMT_API_WS_URLS` → recréer le SDK.
3. DNS + vhost WAF → **le même** `PORT_INBOUND_PARTAGE`.
4. `https://<FQDN>` dans MCM.
5. Relire `/pm4ml-tenants`.

Pas de nouveau port inbound Hub.

---

## 10. Retour arrière

Remettre un SDK **dédié** (runbook actuel) : vhost WAF vers `:<ancien inbound>`, MCM inchangé si le FQDN est le même, retirer l’agent de `MGMT_API_WS_URLS`.
