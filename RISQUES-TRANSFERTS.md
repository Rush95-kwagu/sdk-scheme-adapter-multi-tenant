# Registre des risques — transferts d’argent (openmfi / overlay SDK)

**Date :** 15 octobre 2026  
**Périmètre :** Hub `ml-test`, WAF-AGG, nœud SDK `<SDK_HOST>` (`sdk-fececam` + 8 `mcm-agent-*`), DFSPs overlay **et** DFSPs déjà en production sur le même nœud (les `<fspid>` du nœud).  
**Contexte :** transfert <fspid> → <fspid> **réussi** après correction mTLS WAF. Ce document sert de préparation opérationnelle (incident, audit, « toute éventualité »).  
**Méthode :** faits observés (14–15 oct. 2026) + configuration réelle (`lab/docker-compose.yml`, WAF `<HUB_DOMAIN>`, Vault Raft, Cilium/Envoy).

Les niveaux :

| Niveau | Sens |
|--------|------|
| **Élevé** | Perte d’argent, impersonation FSPIOP, indispo Hub/SDK, secret déjà exposé |
| **Moyen** | Incident probable, fenêtre d’attaque ou d’erreur opérateur large |
| **Faible** | Observabilité, dette, durcissement |

---

## Synthèse

Le chemin argent repose sur **cinq couches** (mTLS, JWS, ILP, whitelist IP, OAuth MCM). En l’état lab/overlay, **ILP est désactivé**, **l’API outbound n’a pas de clé**, **PUT /parties n’est pas signé/validé**, **mTLS inbound WAF est `optional`**, et **Vault Raft + DFSPs prod partagent le même nœud SDK** que le POC. Un transfert « vert » ne prouve pas que ces couches tiennent sous attaque ou sous panne.

---

## Élevé

### E1 — API outbound SDK sans authentification (`:11001`)

**Où :** `lab/.env` / compose — `OUTBOUND_API_KEY_ENABLED=false`. Ports hôte `11000`/`11001` bind **0.0.0.0**.  
**Risque :** quiconque joint `<SDK_HOST>:11001` peut `POST /{dfspId}/transfers` (payer <fspid>, <fspid>, <fspid>…). C’est l’API qui **initie** le mouvement d’argent.  
**Preuve :** les POST lab (curl, python-httpx) sans `X-API-Key`.  
**Remède :**

1. `OUTBOUND_API_KEY_ENABLED=true` + secret fort, header obligatoire.
2. Bind outbound `127.0.0.1:11001` ou firewall **allowlist** (backends DFSP uniquement).
3. Ne jamais exposer `:11001` sur le WAN.

### E2 — `CHECK_ILP=false`

**Où :** `lab/docker-compose.yml` (`CHECK_ILP: "false"`).  
**Risque :** le SDK n’exige pas la preuve ILP du fulfil. Un fulfil malformé ou rejoué peut être accepté côté adapter. Couche 5 du modèle Hub **éteinte** sur l’overlay.  
**Remède :** `CHECK_ILP=true` dès que les backends (quoting.<HUB_DOMAIN> / mojaloop) émettent un ILP condition valide. Tester un transfert, puis un fulfil altéré (doit échouer).

### E3 — `AUTO_ACCEPT_PARTY` / `AUTO_ACCEPT_QUOTES` à `true`

**Où :** overlay compose.  
**Risque :** pas de round-trip backend pour accepter payee/quote. Un quote Hub/payee erroné ou frauduleux est **auto-accepté**.  
**Remède :** `false` + API backend qui décide (limites, KYC, solde). Garder `true` uniquement sur simulateur isolé.

### E4 — DFSPs production et lab sur **un seul** `sdk-fececam`

**Où :** tenants : les `<fspid>` du nœud **et** `<fspid>`, `<fspid>`, `<fspid>`.  
**Risque :** restart overlay, bug JWS global, `CHECK_ILP=false`, ou POST mal ciblé = **argent réel**. Un `docker restart sdk-fececam` a déjà coupé **tous** les callbacks.  
**Remède :** overlay lab sur compose/nœud **séparé** ; `<fspid>`/`<fspid>`/``<fspid>`` prod restent en SDK **mono-tenant** jusqu’à qualification. Au minimum : ACL réseau + API key **par** tenant.

### E5 — Vault Raft : 3 réplicas sur **un** worker, 200+ restarts

**Où :** `vault-0/1/2` tous sur `ml-test-w-2`. Leader `vault-1`.  
**Preuve 15 oct. :** `dial tcp 10.99.68.136:8201: connection refused` → MCM `GET /dfsps/jwscerts` **500** `local node not active` → peer JWS figé → `invalid signature` sur quotes. Job `vault-raft-snapshot` en `Init:Error`.  
**Risque :** plus de PKI, plus d’enrollment, plus de JWS, extapi cert, secrets MCM. Transferts cassés **scheme-wide**.  
**Remède :**

1. Anti-affinity : 1 Vault pod / nœud.
2. Alerte `vault status` (Sealed, HA Mode, Applied Index).
3. Réparer le CronJob snapshot ; runbook unseal (5 shares / threshold 3) hors bande.
4. Ne jamais `rollout restart` les 3 Vault d’un coup.

### E6 — Secret Hydra / `AUTH_CLIENT_SECRET` collé dans le chat

**Où :** session opérateur (config `mcm-agent` <fspid>).  
**Risque :** client OAuth DFSP réutilisable contre Hydra/MCM (enrollment, certs).  
**Remède :** rotation **immédiate** du client Hydra `<fspid>` (et tout secret collé). Révoquer l’ancien. Ne plus coller de secrets dans Cursor/chat ; vault/env uniquement.

### E7 — JWS inbound : `PUT /parties` non validé

**Où :** `VALIDATE_INBOUND_PUT_PARTIES_JWS=false` ; log `skipping jws validation on put parties`.  
**Risque :** un `PUT /parties` avec Host/Destination d’un tenant peut **empoisonner** le payee (nom, fspId) avant le quote. Le quote, lui, est signé — mais il part d’un party **non authentifié**.  
**Remède :** `VALIDATE_INBOUND_PUT_PARTIES_JWS=true` + `JWS_SIGN_PUT_PARTIES=true` chez **tous** les payers/payees. Déployer après alignement des peer keys.

### E8 — Map JWS peer **globale** (dernier agent gagne)

**Où :** `DfspConfigStore` — `Object.assign(this.peerJWSKeys, slice.peerJWSKeys)`.  
**Risque :** 8 agents poussent `peerJWSKeys['<fspid>']` ; le **dernier** overwrite. Une PEM stale (<fspid>, `<fspid>`) invalide la vérif **pour tout le nœud**. Transferts quotes → 400 JWS → timeout 504.  
**Remède :** clés peer **par tenant** (pas de merge global) ; ou n’accepter un overwrite que si empreinte SHA-256 identique à MCM. Exposer `/pm4ml-tenants` : liste `dfspId` + fingerprint. Alerte si 500 MCM `jwscerts`.

### E9 — mTLS WAF `ssl_verify_client optional`

**Où :** vhosts FSPIOP <fspid>/<fspid>/<fspid>/<fspid>.  
**Risque :**

- **Pas de cert** → `NONE` → requête **acceptée** (callback Hub sans mTLS, ou client quelconque).
- **Mauvais cert** → **400 SSL** (vu : Hub→<fspid> avec Hub CA au lieu de `<fspid> Root CA`).

`optional` n’est pas « permissif gentil » : il refuse les certs invalides **et** laisse passer l’absence de cert.  
**Remède :** après inventory des `{host}-clientcert-tls`, passer à `ssl_verify_client on` **par vhost qui a une CA**. Laisser commenté **uniquement** les FQDN sans secret Hub (`<fspid>`, `<fspid>` (1:1) tant que pas de CEC). Ne **jamais** mettre `hub-ca.pem` sur ces vhosts (issuer = CA **DFSP**, pas Hub CA).

### E10 — Cert `extapi` 30 jours + Envoy qui sert un secret périmé

**Preuve :** TLS `certificate has expired` (notAfter 12 sep 2026) alors que le Certificate K8s était déjà **Nov 2026**. Secret renouvelé, Envoy pas rechargé.  
**Risque :** **tous** les GET/POST FSPIOP DFSP→Hub meurent.  
**Remède :** alerte `openssl s_client` notAfter vs Certificate CR ; `rollout restart deploy/extapi-envoy` dans le runbook renouvellement ; vérifier `watched_directory` Envoy. `renewBefore` déjà 15 j — ajouter probe synthétique quotidienne.

### E11 — Initiation de transfert depuis n’importe quel process du nœud

**Preuve :** `POST /<fspid>/transfers` avec `fspiop-source: <fspid>` (client python) alors que le tenant path est <fspid>.  
**Risque :** confusion payer / tenant overlay ; scripts lab qui débittent le **mauvais** DFSP.  
**Remède :** API key + le backend n’accepte que son `dfspId` ; overlay : refuser si `FSPIOP-Source` ≠ tenant du path.

---

## Moyen

### M1 — Callbacks Hub en `http://` (ALS) → 301 nginx

**Preuve :** `PUT …/error` 301 puis 200 ; URLs ALS `http://<fspid>.ext.<HUB_DOMAIN>`.  
**Risque :** première jambe **sans** client cert ; retry HTTPS. Course, perte de mTLS, timeouts.  
**Remède :** enregistrer les endpoints DFSP en `https://` dans le ledger / MCM onboarding. Désactiver le redirect 80 sur les vhosts FSPIOP (ou ne répondre qu’en 444).

### M2 — Cert client Hub signé par la **CA DFSP**, pas Hub CA

**Preuve :** `<fspid>-clientcert-tls` issuer `CN=<fspid> Root CA`, validité ~5 mois.  
**Risque :** opérateur qui configure le WAF avec Hub CA → 400 (incident 14 oct.). Rotation CA DFSP casse Hub→DFSP.  
**Remède :** runbook WAF = extraire `ca.crt` du secret Cilium **par DFSP**. Documenter le modèle (enrollment outbound). Alerte notAfter &lt; 30 j sur ces secrets.

### M3 — Pas de `{host}-clientcert-tls` pour certains `<fspid>` 1:1

**Preuve :** `kubectl -n cilium-secrets` : seulement <fspid>, <fspid>, <fspid>, <fspid>.  
**Risque :** Hub n’envoie pas de cert → `NONE`. Quand l’enrollment arrivera, oubli WAF = 400 lookups.  
**Remède :** onboard MCM + vault-agent ; extraire CA ; activer mTLS vhost **après**. Checklist par nouveau DFSP.

### M4 — Envoy / Cilium SDS vs nginx : deux vérités

Hub origination mTLS (CEC) ≠ terminaison WAF. Un secret K8s à jour n’implique pas nginx à jour (PEM copiés à la main).  
**Remède :** script Hub→WAF (même si scp clé dédiée) ; pas de copier-coller PEM en prod. Compte `ops` WAF avec clé depuis le jump Hub.

### M5 — `ssl_verify_client on` mal configuré = déni de lookup (argent bloqué)

Pas une faille d’auth trop faible : **trop stricte / mauvaise CA**. ALS lookup payee = 400 HTML.  
**Remède :** canary `optional` → `on` DFSP par DFSP ; rollback 3 lignes commentées ; probe `GET /parties` synthétique.

### M6 — JWS : MCM 500 pendant l’outage Vault

Agents restent `PEER_JWS_CONFIGURED` sur **cache Vault local** (clés possiblement stale).  
**Remède :** alerte agent `ERR_BAD_RESPONSE` `jwscerts` ; ne pas mixer restart de 8 agents (stampede `:4004` / `ECONNREFUSED`). Ordre : Vault leader → MCM 200 → **puis** overlay.

### M7 — Whitelist IP Hub / DFSP trop large

Le modèle prévoit un filtre IP Envoy ; en lab souvent `0.0.0.0/0` (whitelist Vault `whitelist_*`).  
**Risque :** mTLS `optional` + IP any = FSPIOP inbound depuis Internet si le WAF est public.  
**Remède :** CIDR Hub egress (`<HUB_EGRESS>` / WAN Hub) **uniquement** sur vhosts FSPIOP `allow`. Mesurer avant de passer `ssl_verify_client on`.

### M8 — OAuth FSPIOP absent (un facteur : cert)

Documenté : FSPIOP n’exige pas de bearer. Cert (+ JWS). CRL Vault **non consultée** par Envoy.  
**Risque :** cert DFSP volé reste valide jusqu’à expiry ; revoke MCM inefficace au TLS.  
**Remède :** rotation courte ; retrait CA du bundle + delete secret CEC ; à terme mTLS `on` + IP allowlist. Ne pas compter sur la CRL aujourd’hui.

### M9 — `NODE_TLS_REJECT_UNAUTHORIZED` côté agents Compose DFSP

Exemples toolkit : `"0"` sur mcm-agent. Overlay SDK : `"1"`.  
**Risque :** agent qui parle à un MCM/Hydra mitm.  
**Remède :** `1` partout une fois la CA Hub dans le trust store agent.

### M10 — Certs outbound overlay : mêmes tailles PEM sur 8 tenants

**Preuve :** `/pm4ml-tenants` — `outboundCertBytes: 2060` identique. Peut être coïncidence RSA, ou **même** client cert Hub réutilisé.  
**Risque :** Hub ne distingue plus les DFSPs à l’inbound extapi.  
**Remède :** fingerprint par tenant dans `/pm4ml-tenants` ; alerte si collision.

### M11 — API Kubernetes / réseau intermittent

**Preuve :** `kubectl` `no route to host` <KUBE_API_VIP>:6443 alors que ping OK ; quelques minutes plus tard 6443 OK.  
**Risque :** pas de rollback cert, pas d’ops Hub pendant l’incident argent.  
**Remède :** kubeconfig depuis **deux** jumps ; VIP API ; alerte `nc -z :6443`.

### M12 — Redis overlay sans auth (`redis://redis:6379`)

État machine transferts / cache. Compromission du réseau Docker → lecture/écriture d’état.  
**Remède :** mot de passe Redis, pas de publish port Redis.

### M13 — Logs nginx `combined` sans `Host`

Diagnostic mTLS (<fspid> vs <fspid>) aveugle. `error_log` niveau error : pas de `client SSL certificate verify` (info).  
**Remède :** `log_format` avec `$host $ssl_client_verify $ssl_client_s_dn` ; `error_log … info` sur vhosts FSPIOP.

---

## Faible

### F1 — Warnings nginx (`listen … http2` deprecated, MIME dupliqué)

Autres sites (`erp.bftlabs.org`, `labs.inlogics.pro`) sur le **même** nginx. Reload FSPIOP = risque de casser un vhost tiers.  
**Remède :** séparer le WAF Mojaloop ; corriger http2.

### F2 — Placeholder `<dfsp>` décommenté → `nginx -t` fail (prod freeze reload)

**Remède :** commentaires sans chemin fictif ; CI `nginx -t` sur le fichier.

### F3 — Handshake Hydra/MCM `Connection reset` dans error.log WAF

Bruit ; masque les vrais 400 SSL.  
**Remède :** error_log par `server_name`.

### F4 — CronJob `vault-raft-snapshot` Init:Error

Pas bloquant court terme ; pas de backup Raft.  
**Remède :** fixer le Job (SA, PVC, token).

### F5 — Overlay `ENABLE_*_EVENT_HANDLER=false`

Moins d’audit métier dans le SDK.  
**Remède :** activer si la chaîne Kafka lab est là.

### F6 — Documentation Hub CA vs CA DFSP encore facile à inverser

**Remède :** ce registre + commentaire WAF (déjà amorcé dans `docs/participant/examples/waf/openmfi.org`).

---

## Matrice « argent en jeu » (réponses rapides)

| Symptôme | Couche | Action immédiate |
|----------|--------|------------------|
| 400 HTML `SSL certificate error` sur `*.ext` | WAF mTLS (mauvaise CA ou cert Hub mort) | Commenter `ssl_verify_*` **ce** vhost ; extraire `ca.crt` Cilium ; ne pas toucher Hub CA |
| `certificate has expired` vers extapi | Cert serveur Hub | `openssl s_client` ; `rollout restart extapi-envoy` |
| `invalid signature` PUT /quotes | JWS peer | MCM `jwscerts` 200 ? Vault leader ? Fingerprint `<fspid>` ; **ne pas** restart 8 agents d’un coup |
| 504 quote puis 3208 GET transfer | Conséquence (quote jamais accepté) | Traiter la cause (JWS/mTLS), ignorer 3208 |
| `local node not active` MCM | Vault Raft | `vault status` HTTP ; ne pas restart SDK |
| POST transfer depuis un laptop | E1 | Couper `:11001` WAN ; activer API key |
| Restart `sdk-fececam` | Tous les DFSPs du nœud | Prévenir ; ventana ; health `:4004` **avant** restart SDK |

---

## Ordre de durcissement recommandé (sans casser le lab)

1. **E6** rotation secret Hydra collé.  
2. **E1** API key outbound + bind localhost/firewall.  
3. **E4** sortir `<fspid>`/`<fspid>`/`<fspid>` encore en 1:1 de l’overlay (ou nœud dédié).  
4. **E5** anti-affinity Vault + alerte leader.  
5. **E10** probe extapi notAfter + restart Envoy au renew.  
6. **M2/M3/E9** CA par vhost ; `optional` → `on` uniquement <fspid>/<fspid>/<fspid>/<fspid> ; `<fspid>` sans CEC commentés.  
7. **E8** peer JWS par tenant (code overlay).  
8. **E2/E3** `CHECK_ILP=true`, auto-accept `false` avec backend réel.  
9. **E7** JWS PUT parties.  
10. **M1** endpoints ALS en https.  
11. **M7/M8** allowlist IP Hub + procédure révocation cert.

---

## Ce qui a été **validé** le 15 oct. 2026

- WAF mTLS avec **CA DFSP** : `ssl-client-verify: SUCCESS`, `CN=<fspid>.ext.<HUB_DOMAIN>`.  
- Lookup payee + quote + transfert <fspid> → <fspid> **OK** après ça.  
- Overlay 8 tenants reconnectés aux `mcm-agent-*` healthy.  
- Vault unsealed, HA standby `vault-0`, leader `vault-1`.  
- MCM `GET /api/dfsps/jwscerts` 200.

Un succès de transfert **n’annule pas** E1–E11.
)
