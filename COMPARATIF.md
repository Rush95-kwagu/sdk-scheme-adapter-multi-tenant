# Tableau comparatif — overlay multi-tenant vs SDK `v24.9.0`

Référence amont : image / sources `mojaloop/sdk-scheme-adapter:v24.9.0` (`modules/api-svc/src/…`).  
L’overlay **remplace** ces fichiers dans l’image (`COPY overlay/modules/api-svc/src/ → /opt/app/modules/api-svc/src/`). Tout le reste du SDK (modèles, OpenAPI, Redis, ILP) est **inchangé**.

Légende :

- **Type** — **Nouveau** (absent de `v24.9.0`) · **Modifié** (fichier amont copié puis patché) · **Packaging** (hors sources SDK)
- **Rôle** — responsabilité du fichier dans le process SDK / le packaging lab

---

## 1. Sources SDK copiées dans l’image

| Fichier (chemin overlay = chemin amont `modules/api-svc/src/…`) | Type | Rôle | Ce qui était (`v24.9.0`) | Ce que l’overlay apporte |
|-----------------------------------------------------------------|------|------|---------------------------|---------------------------|
| `lib/DfspConfigStore.js` | **Nouveau** | Mémoire des tenants : stocker et appliquer, par `dfspId`, backend / JWS / PEM mTLS | Fichier absent. Une seule conf globale (`this.conf`) après `CONFIGURATION.READ` / `NOTIFY`. | Store mémoire `dfspId` → slice. `upsert` sans restart. `applyTo` par requête. Ignore `placeholder` / `mojaloop`. Garde les PEM si un NOTIFY arrive sans certs. Normalise Buffer / `http://` / backend `127.0.0.1:9`. |
| `config.js` | Modifié | Lire les variables d’environnement et exposer la conf du process | Un seul WS : `MGMT_API_WS_URL` + `MGMT_API_WS_PORT` (défaut `:4005`). `DFSP_ID` unique. Flag `MULTI_DFSP` (préfixe **backend**). Pas de `PM4ML_MULTI_TENANT`. | `parseMgmtApiWsEndpoints()` : `MGMT_API_WS_URLS` (`id@host:port,…`). Flags `PM4ML_MULTI_TENANT` (défaut `false`) et `DFSP_HOST_SUFFIX` (défaut `.ext.openmfi.org`). `MULTI_DFSP` conservé, usage distinct. |
| `index.js` | Modifié | Point d’entrée : démarrer / arrêter inbound, outbound, Redis, clients PM4ML | Un `controlClient`. `start()` : `RECONFIGURE` → `restart()` (inbound/outbound/WSO2). Bootstrap `start(config)` : merge **global** du premier `CONFIGURATION.READ` dans `config` **avant** d’écouter. `stop()` : un client. | Si `pm4mlMultiTenant` : N clients (`controlClients` Map), `_attachControlClientWithRetry`, `onReconfigure` → **upsert store**, **pas** de `restart()`. Bootstrap READ **sauté** en multi-tenant (évite d’écraser `dfspId` global). `stop()` arrête tous les WS. Mode 1-agent inchangé si flag off. |
| `ControlAgent/index.js` | Modifié | Client websocket PM4ML vers un `mcm-agent` (`CONFIGURATION.READ` / `NOTIFY`) | `constructor({ address, port, logger, appConfig })`. `_appConfig` partagé. `client.on('message', client._handle)` (binding `this` fragile). Logger sans `address/port`. | `onReconfigure` optionnel (upsert). Clone `_appConfig` par agent. Logger `{ address, port }`. `client.on('message', (data) => client._handle(data))` pour N sockets. |
| `InboundServer/index.js` | Modifié | Serveur HTTP Hub (`:5000`) : pipeline Koa des callbacks FSPIOP | Pipeline Koa standard. `router(handlers, conf)` avec `multiDfsp` tel quel. Pas d’endpoint debug. | `GET /pm4ml-tenants` (liste tenants, backend, taille certs). `applyPm4mlTenant` avant ping/validator. `multiDfsp: false` si multi-tenant (Hub reste sur `/parties`, pas `/dfspId/parties`). `/pm4ml-tenants` hors logs verbeux. |
| `InboundServer/middlewares.js` | Modifié | Middlewares inbound (état, headers, JWS) et résolution du tenant HTTP | `applyState` copie `sharedState.conf` tel quel. Pas de notion de tenant HTTP. | `resolveDfspId` : `FSPIOP-Destination`, Host − suffixe, premier label, tenant unique. `applyPm4mlTenant` : `dfspConfigStore.applyTo` → certs + backend de **cette** requête. `stripPm4mlOutboundPrefix` : `/gto/transfers` → `/transfers` + `pm4mlDfspId`. Export des deux middlewares. |
| `InboundServer/handlers.js` | Modifié | Handlers FSPIOP inbound (lookup, quotes, transfers) vers le CBS puis PUT Hub | `createInboundTransfersModel` : si `path.params.dfspId`, **concatène** `backendEndpoint/${dfspId}` (`MULTI_DFSP`). Lookup : corps CBS envoyé tel quel au PUT Hub. | Si `pm4mlMultiTenant` : **ne pas** concaténer le path au backend (backend déjà `host:port/mojaloop`). `ensureInternalPartyIds` : wrap GET CBS + PUT Hub pour forcer `partyIdType` / `partyIdentifier` / `fspId` (évite 3102). |
| `OutboundServer/index.js` | Modifié | Serveur HTTP CBS (`:5001`) : pipeline Koa de l’API outbound | `createRequestValidator` puis `router(handlers, conf)`. Pas de préfixe DFSP. | Import middlewares inbound. `stripPm4mlOutboundPrefix` **avant** le validator OpenAPI. `applyPm4mlTenant` après. Router avec `multiDfsp: false` en mode overlay. |
| `OutboundServer/handlers.js` | Modifié | Handlers outbound (`POST /transfers`, lookup) vers le Hub en mTLS | `createOutboundTransfersModel` : `ctx.state.conf` + `path.params.dfspId` éventuel. Un cert client pour tout le process. | Lit `pm4mlDfspId` / path / `conf.dfspId`, `applyTo` le store, logs TLS (taille cert/key, pas le PEM). Le modèle Hub utilise **les creds du tenant** (ALS, quotes, transfers). |

Fichiers amont **non** recopiés dans l’overlay (donc **identiques** à `v24.9.0` dans l’image) : `lib/model/*`, `lib/mojaloop-requests`, `BackendRequests`, OpenAPI, `OutboundServer/middlewares.js`, event handlers, etc.

---

## 2. Fichiers **nouveaux** (hors sources Mojaloop)

Aucun de ces chemins n’existe dans le dépôt `sdk-scheme-adapter`. Ils constituent le packaging lab / POC / documentation.

| Fichier | Type | Rôle |
|---------|------|------|
| `Dockerfile` | **Nouveau** | Construire l’image overlay : `FROM v24.9.0` + `COPY overlay/…` |
| `lab/docker-compose.yml` | **Nouveau** | Déployer le SDK overlay en lab (Redis, ports, WS agents, réseaux Docker, `extapi`) |
| `lab/cutover-cmcalavi.md` | **Nouveau** | Runbook de bascule du SDK dédié **cmcalavi** vers l’overlay |
| `lab/cutover-gto.md` | **Nouveau** | Runbook de bascule du SDK dédié **gto** vers l’overlay |
| `poc/docker-compose.yml` | **Nouveau** | Stack de test isolé (2 mock-agents, mock ALS, mock backend, sans Hub) |
| `poc/smoke.sh` | **Nouveau** | Vérifier que les deux tenants mock sont chargés (`/pm4ml-tenants`) |
| `poc/mock-mcm-agent.js` + `Dockerfile.mock-agent` | **Nouveau** | Simuler un `mcm-agent` (WS `CONFIGURATION.READ` / `NOTIFY`) |
| `poc/mock-als.js` + `Dockerfile.als` | **Nouveau** | Simuler le Hub ALS pour le smoke POC |
| `poc/mock-backend.js` + `Dockerfile.backend` | **Nouveau** | Simuler le CBS (parties / quotes / transfers) |
| `README.md` | **Nouveau** (dans ce repo contrib) | Présenter l’overlay, les flags et le smoke POC |
| `DEPLOY-REAL.md` | **Nouveau** | Guider le branchement de vrais DFSP (WAF, backends, tests) |
| `TECHNICAL.md` | **Nouveau** | Documenter architecture, Mermaid, déploiement et onboarding DFSP |
| `COMPARATIF.md` | **Nouveau** | Comparer fichiers amont vs overlay |

---

## 3. Ce qui n’est **pas** dans l’overlay (à ne pas confondre)

| Élément | Statut |
|---------|--------|
| Image Docker Mojaloop officielle | Inchangée ; on **surcouche** `v24.9.0` |
| `mcm-agent`, Vault, Hydra | Toujours **1:1 par DFSP** — pas fusionnés |
| WAF nginx, DNS, MCM callbacks | Config ops, pas de fichier overlay |
| Core banking (`cbs.counterparties`, `/mojaloop`) | Hors SDK ; prérequis CBS |
| `MULTI_DFSP=true` (préfixe path **backend**) | Flag officiel distinct ; **désactivé** dans le routeur quand `PM4ML_MULTI_TENANT=true` |
| Liens dans `docs/index.md` / `docs/participant/index.md` | Index documentation toolkit uniquement, pas du runtime SDK |

---

## 4. Synthèse comportementale

| Sujet | Avant | Après (`PM4ML_MULTI_TENANT=true`) |
|-------|--------|-----------------------------------|
| Nombre d’agents PM4ML | 1 | N (`MGMT_API_WS_URLS`) |
| Sur `CONFIGURATION.NOTIFY` | `restart()` des serveurs HTTP | `upsert` mémoire, HTTP reste up |
| Certs Hub mTLS / JWS | Un jeu pour le process | Jeu du `dfspId` de la requête |
| `BACKEND_ENDPOINT` | Un pour le process | Un par tenant (NOTIFY agent) |
| Inbound Hub | `/parties`, `/quotes`, `/transfers` | **Mêmes chemins** ; tenant = Host / `FSPIOP-Destination` |
| Outbound CBS | `/transfers` (un DFSP) | `/{dfspId}/transfers` puis strip |
| Debug tenants | — | `GET /pm4ml-tenants` |
| Flag off | — | Comportement `v24.9.0` conservé |
