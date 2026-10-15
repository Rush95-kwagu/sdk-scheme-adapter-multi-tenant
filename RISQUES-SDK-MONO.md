# Registre des risques — SDK mono-tenant (1:1) en service

**Date :** 15 octobre 2026  
**Source :** `docker ps` sur `sdk@cmcalavi-sdk-node` (`172.25.2.117`).  
**Périmètre :** stacks Compose `sdk-scheme-adapter-*` + `mcm-agent-*` + Vault/Redis associés. L’overlay `sdk-fececam` est hors scope (voir `RISQUES-TRANSFERTS.md`) sauf là où les deux **coexistent**.

Les flags Compose cités (`JWS_SIGN=false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, etc.) viennent des exemples toolkit (`docs/participant/examples/*-docker-compose.yml`). **Confirmer sur le live** : `docker inspect sdk-scheme-adapter-moov --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'JWS|CHECK_ILP|NODE_TLS|MUTUAL'`.

---

## Inventaire (15 oct. 2026)

### SDK 1:1 encore **up** (image `mojaloop/sdk-scheme-adapter:v24.9.0`)

| Conteneur | Inbound | Outbound | Metrics | WAF FSPIOP | Âge |
|-----------|---------|----------|---------|------------|-----|
| `sdk-scheme-adapter-moov` | `:6000` | `:6001` | `:6040` **0.0.0.0** | `moov.ext` → 6000 | ~3 sem. |
| `sdk-scheme-adapter-clcam-jardin` | `:8000` | `:8001` | `:8040` 0.0.0.0 | `clcam-jardin.ext` → 8000 | ~2 sem. |
| `sdk-scheme-adapter-clcam-calavi` | `:9000` | `:9001` | `:9040` 0.0.0.0 | `clcam-calavi.ext` → 9000 | ~2 sem. |
| `sdk-scheme-adapter-clcam-calavi-test` | `:10000` | `:10001` | `:10040` 0.0.0.0 | `clcam-calavi-test.ext` → 10000 | ~7 j |
| `sdk-scheme-adapter-clcam-jardins-test` | `:10100` | `:10101` | `:10140` 0.0.0.0 | `clcam-jardins-test.ext` → 10100 | ~2 sem. |

Chaque stack a `mcm-agent-*` (healthy, **restartés il y a ~2 h** — même vague que l’overlay), Vault 1.20, Redis **bitnami**.

### Agent + Vault + Redis **sans** SDK 1:1 (cutover overlay incomplet)

| Agent | MCM UI hôte | Vault | Redis | SDK 1:1 | WAF inbound |
|-------|-------------|-------|-------|---------|-------------|
| `mcm-agent-gto` | `:5003` | `sdk-vault-gto` | `sdk-redis-gto` | **absent** | `gto.ext` → **11000** overlay |
| `mcm-agent-cmcalavi` | `:3000` | `sdk-vault-cmcalavi` | `sdk-redis-cmcalavi` | **absent** | `cmcalavi.ext` → **11000** |
| `mcm-agent-moov-test` | `:10203` | `sdk-vault-moov-test` | `sdk-redis-moov-test` | **absent** | `moov-test.ext` → **11000** |

### Autres

| Objet | État |
|-------|------|
| `sdk-scheme-adapter-mtn` | **absent** alors que WAF `mtn.ext` → `:7000` |
| `sdk-scheme-adapter-gto` / `cmcalavi` / `moov-test` | absents (callbacks overlay) |
| `sdk-fececam` | overlay ; **tous** les `mcm-agent-*` ci-dessus lui sont aussi branchés (`just build`) |
| `sdk-mt-docs` | nginx `:80` |

---

## Élevé

### S1 — Double rattachement agent : 1:1 **et** overlay

**Fait :** `just build` attache **tous** les `mcm-agent-*` running à `sdk-fececam`. Les agents `moov` et `clcam-*` poussent donc la config PM4ML vers **deux** SDK en parallèle, alors que le WAF inbound reste sur les ports **1:1** (6000, 8000, 9000, 10000, 10100).

**Risque :**

- Callbacks Hub → 1:1 ; initiations CBS encore sur `:6001` **ou** `:11001/moov` selon qui a été mis à jour.
- Deux processus signent / valident avec des keystores qui peuvent **diverger**.
- Restart overlay ou 1:1 = demi-chaîne morte, transferts moov/clcam **prod**.

**Remède :** un agent = **un** consommateur WS `:4004`. Pour rester 1:1 : **arrêter l’agent pendant `just build`**, ou overlay **sans** ces agents dans `MGMT_API_WS_URLS`. Pour cutover overlay : arrêter le SDK 1:1 **et** basculer le WAF (déjà fait gto/cmcalavi/moov-test). Ne pas laisser moov/clcam dans les deux.

### S2 — Outbound 1:1 exposé `0.0.0.0` sans clé API

**Ports :** `:6001`, `:8001`, `:9001`, `:10001`, `:10101`. Le SDK officiel n’a pas le middleware `OUTBOUND_API_KEY` de l’overlay.

**Risque :** `POST /transfers` (sans préfixe) depuis le LAN/WAN du nœud = **débit réel** moov / clcam.

**Remède :** firewall allowlist CBS uniquement ; bind `127.0.0.1:xx01` si le CBS est local ; reverse-proxy authentifié. Ne pas publier l’outbound sur `::`.

### S3 — Metrics SDK bind `0.0.0.0:6040` … `:10140`

**Preuve :** `docker ps` — overlay metrics est `127.0.0.1:11040` ; les 1:1 **non**.

**Risque :** scrape `/metrics` (latences, compteurs transfers, labels) depuis le réseau. Aide à cartographier les flux d’argent.

**Remède :** `"127.0.0.1:6040:5040"` (idem 8040, 9040, 10040, 10140). Recréer le publish (`docker compose up -d` du service).

### S4 — WAF `mtn.ext` → `:7000` **sans** conteneur

**Risque :** lookups/quotes/transfers vers MTN = timeout / 502. Si mtn est payee ALS, les transferts **sortants** des autres DFSPs cassent au PUT callback.

**Remède :** ramener `sdk-scheme-adapter-mtn` ou rerouter le vhost. Probe `curl -skI --resolve mtn.ext.openmfi.org:443:41.214.65.90 https://mtn.ext.openmfi.org/`.

### S5 — JWS souvent **off** au boot 1:1

**Exemples toolkit :** `JWS_SIGN=false`, `VALIDATE_INBOUND_JWS=false` (moov, gto, cmcalavi, moov-test). PM4ML peut les réactiver ensuite — **sauf** si l’agent n’a pas fini `PEER_JWS_CONFIGURED` (500 Vault vu le 15 oct.).

**Risque :** callbacks Hub/payee **acceptés sans signature** sur moov/clcam. Fraude de quote/fulfil.

**Remède :** inspect live ; forcer sign+validate **true** (env **et** agent `sdk.jws`). Aligner avec overlay (`VALIDATE_INBOUND_JWS=true`). PUT parties : même débat que E7 overlay.

### S6 — `NODE_TLS_REJECT_UNAUTHORIZED=0` (agent + SDK 1:1)

**Risque :** MITM vers `extapi` / Hydra / MCM. L’overlay est à `1`.

**Remède :** `1` + CA Hub dans le trust. Tester un GET parties après.

### S7 — Stacks orphelines gto / cmcalavi / moov-test

Vault + Redis + agent **tournent** sans SDK 1:1. L’agent est le contrôleur overlay.

**Risque :** Vault DFSP encore unseal (clés JWS, mTLS) sur disque Docker ; surface SSH/nœud ; confusion ops (« quel SDK écoute ? »). CBS qui tape encore `:5001` gto historique = connexion refusée ou mauvais hop.

**Remède :** documenter « source of truth = overlay ». Arrêter Vault/Redis 1:1 **après** backup des unseal/creds, ou les garder **uniquement** pour l’agent (l’agent en a besoin). Vérifier qu’aucun CBS n’utilise plus les anciens `PORT_OUT` gto/cmcalavi/moov-test (`10201`, etc.).

### S8 — Vague restart agents (~2 h, tous `mcm-agent-*`)

**Preuve :** agents 1:1 « Up 2 hours » vs SDK « Up 3 weeks / 7 days ». Même stampede que l’overlay.

**Risque :** trou WS `:4004` ; 1:1 healthy sur `/metrics` **sans** config PM4ML fraîche ; JWS stale (S5).

**Remède :** même runbook que l’overlay : pas de restart 8 agents ; attendre healthy **et** `PEER_JWS` sans 500 MCM **avant** de retester l’argent.

---

## Moyen

### T1 — Redis **bitnami/redis:latest** (1:1) vs `redis:7-alpine` (overlay)

Pin cassé, healthcheck parfois faux, pas d’AUTH. État machine transferts.

**Remède :** `redis:7-alpine` + mot de passe ; pas de port publié (OK aujourd’hui, 6379 interne seulement).

### T2 — Vault DFSP 1.20 **file storage**, un replica, UID lab

Pas de Raft. Perte du volume = re-enrollment. 8 Vaults sur **une** VM.

**Remède :** backup `vault-data-*` ; snapshots ; ne pas `docker volume rm`. Quota RAM (mlock / SKIP_SETCAP déjà en lab).

### T3 — `INBOUND_MUTUAL_TLS_ENABLED=true` dans certains exemples (moov, gto, cmcalavi) derrière WAF `proxy_pass http://`

Si le live a encore `true`, le SDK attend du TLS sur `:5000` alors que nginx parle HTTP → 400/502 Hub.

**Preuve indirecte :** moov up 3 semaines avec WAF HTTP → le live est **probablement** `false`. **Inspecter.**

**Remède :** `false` tant que le WAF termine le TLS. mTLS = nginx `ssl_verify_client` (CA DFSP, pas Hub CA). vhosts clcam : mTLS **commenté** (pas de `*-clientcert-tls` Hub) — callbacks Hub **sans** client cert (`NONE`).

### T4 — WAF clcam : pas de `ssl_verify_client` (volontaire, pas de secret Cilium)

Hub n’envoie pas de cert vers clcam. inbound 1:1 = TLS Let’s Encrypt seulement.

**Risque :** n’importe quel client TLS public peut frapper le SDK si le WAF est ouvert (couche mTLS absente). JWS (S5) doit alors **tenir**.

**Remède :** enrollment outbound Hub + CA sur le vhost + `optional` puis `on`. En attendant : allowlist IP Hub + JWS on.

### T5 — MCM UI publiée `0.0.0.0:3000`, `:5003`, `:6003`, `:8003`…

**Risque :** surface enrollment (même derrière auth Hydra). Port `3000` = `mcm-agent-cmcalavi` **et** collision mentale avec d’autres services.

**Remède :** bind localhost ou seulement WAF (`mcm-*.ext`). nft allow WAF `41.214.65.90` / `172.16.2.10`.

### T6 — Image SDK `v24.9.0` figée 2–4 semaines, overlay image locale plus récente

Comportement JWS/ILP **différent** overlay vs 1:1 sur le même nœud.

**Remède :** matrice versions ; ne pas mélanger un payer overlay et un payee 1:1 sans tests (déjà le cas cmcalavi overlay → moov 1:1 **réussi** le 15 oct. — à retester après tout bump).

### T7 — Healthcheck 1:1 = wget **metrics** `:5040`

Le SDK « healthy » n’implique pas WS PM4ML ni JWS. Après restart agent, Docker dit healthy trop tôt.

**Remède :** health = ping inbound **et** fichier/log `PEER_JWS_CONFIGURED` récent.

### T8 — `ENABLE_*_EVENT_HANDLER=false`

Moins d’audit Kafka des transferts 1:1.

---

## Faible

### U1 — `sdk-mt-docs` `:80` sur le nœud (doc interne)

Pas d’auth. OK LAN ; pas le WAN.

### U2 — Collision de nom `clcam-jardin` (WAF/SDK) vs `clcam-jardins-test`

Erreur CBS / ALS fréquente.

### U3 — bitnami Redis + Vault 1.20 `SKIP_SETCAP` : dette d’images

### U4 — Pas de `mtn` dans `docker ps` alors que MCM/WAF existent encore

Orphelin Hub (secret `mtn-clientcert-tls` Cilium 43 j) sans data plane local.

---

## Matrice symptôme → action (1:1)

| Symptôme | Piste | Action |
|----------|--------|--------|
| 502 `mtn.ext` | Rien sur `:7000` | S4 — remonter SDK mtn ou changer WAF |
| Transfer moov timeout inbound | WAF 6000 vs overlay 11000 | Vérifier `proxy_pass` **moov.ext** = 6000 (prod 1:1) |
| Transfer gto/cmcalavi 502 1:1 | SDK 1:1 arrêté | Trafic doit aller `:11000` ; CBS outbound `:11001/{dfsp}` |
| `invalid signature` sur **moov** 1:1 | Agent restart 2 h, JWS off | Inspect env ; logs `mcm-agent-moov` jwscerts |
| POST `:6001` depuis un laptop | S2 | Firewall immédiat |
| Metrics ouverts | S3 | Recréer bind 127.0.0.1 |
| Agent healthy, SDK 1:1 stale | S1 / S8 | Un seul WS consumer |

---

## Ordre de durcissement 1:1

1. **S2 / S3** — fermer outbound et metrics (nft + bind). Moov prod d’abord.  
2. **S4** — mtn data plane ou WAF.  
3. **S1** — sortir `mcm-agent-moov` et `mcm-agent-clcam-*` de `MGMT_API_WS_URLS` overlay **ou** arrêter les SDK 1:1 après cutover WAF. Ne pas rester les deux.  
4. **S5 / S6** — inspect + JWS on + `NODE_TLS=1`.  
5. **S7** — inventaire CBS ports morts ; backup puis prune Vault/Redis orphelins si l’agent overlay n’en a plus besoin (l’agent **a** encore besoin de son Vault).  
6. **T3 / T4** — mTLS WAF clcam quand Cilium aura les secrets.  
7. **T1 / T2** — pin Redis, backup Vault DFSP.

---

## Commandes d’audit live (nœud SDK)

```bash
# Flags d’un SDK 1:1
for s in moov clcam-jardin clcam-calavi clcam-calavi-test clcam-jardins-test; do
  echo "===== $s ====="
  docker inspect "sdk-scheme-adapter-$s" --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | grep -E '^(JWS_|VALIDATE_|CHECK_ILP|NODE_TLS|INBOUND_MUTUAL|OUTBOUND_MUTUAL|DFSP_ID)='
done

# Qui écoute vraiment
ss -lntp | grep -E ':(6000|6001|7000|8000|8001|9000|9001|10000|10001|10100|10101|11000|11001)\b'

# Agents branchés overlay vs 1:1
docker inspect sdk-fececam --format '{{range .Config.Env}}{{println .}}{{end}}' | grep MGMT_API_WS
```
