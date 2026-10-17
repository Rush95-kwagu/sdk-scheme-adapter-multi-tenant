# Cutover <fspid> → overlay (sdk-node)

Ne pas arrêter `mcm-agent-<fspid>`, `sdk-vault-<fspid>`, `sdk-redis-<fspid>`.
Ne pas toucher les autres DFSPs 1:1 du même nœud.

WAF actuel : `<fspid>.ext.<HUB_DOMAIN>` → `<SDK_HOST>:4000`.
MCM UI : `mcm-<fspid>.ext.<HUB_DOMAIN>` → `:3000` (inchangé).

Deux SDK ne doivent **pas** ouvrir le websocket PM4ML du même agent.

---

## 0. Push / pull

Sur la machine de dev : commit + push `lab/` + overlay.
Sur la VM :

```bash
cd ~/sdk-fececam/sdk-scheme-adapter-multi-tenant
git pull
```

---

## 1. Réseau Docker de l’agent

```bash
export CMCALAVI_DOCKER_NET=$(docker inspect mcm-agent-<fspid> \
  -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
echo "$CMCALAVI_DOCKER_NET"
```

Doit afficher un nom (souvent `dfsp-<fspid>_mojaloop` ou `…_default`).

---

## 2. Libérer 11000 et l’agent

```bash
export IN=11000 OUT=11001 MET=11040
cd ~/sdk-fececam/sdk-scheme-adapter-multi-tenant
docker compose -f poc/docker-compose.yml down

docker update --restart=no sdk-scheme-adapter-<fspid>
docker stop sdk-scheme-adapter-<fspid>
```

Outage Hub <fspid> jusqu’à l’étape 4 (WAF encore sur `:4000`).

---

## 3. Démarrer l’overlay

```bash
docker compose -f lab/docker-compose.yml up --build -d
sleep 8
curl -sS http://127.0.0.1:11000/pm4ml-tenants
docker logs --tail 80 sdk-fececam 2>&1 | grep -E '<fspid>|NOTIFY|tenant|error' || true
```

Attendu : `{"tenants":["<fspid>"]}`. Si `[]` : l’agent n’a pas fourni `dfspId` (corrigé par `<fspid>@mcm-agent-…` après rebuild) ; ou le SDK n’est pas sur le réseau de l’agent :

```bash
docker inspect sdk-fececam -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
docker exec sdk-fececam getent hosts mcm-agent-<fspid>
docker logs sdk-fececam 2>&1 | grep -E 'upsert|placeholder|waiting for mcm|CONFIGURATION|tenant'
docker restart mcm-agent-<fspid>
```

Inbound (bypass WAF) :

```bash
curl -sS -o /tmp/in.json -w "HTTP %{http_code}\n" \
  -H "Host: <fspid>.ext.<HUB_DOMAIN>" \
  -H "Accept: application/vnd.interoperability.parties+json;version=1.1" \
  -H "Content-Type: application/vnd.interoperability.parties+json;version=1.1" \
  -H "Date: $(date -u +%a,\ %d\ %b\ %Y\ %H:%M:%S\ GMT)" \
  -H "FSPIOP-Source: <fspid>" \
  -H "FSPIOP-Destination: <fspid>" \
  "http://127.0.0.1:11000/parties/MSISDN/22900000000"
```

202 = le SDK a accepté (l’ALS Hub fera le PUT). 3100/3101 = tenant/certs/backend, coller le body.

Outbound :

```text
http://<SDK_HOST>:11001/<fspid>/
http://<SDK_HOST>:11001/<fspid>/parties/MSISDN/<alias>
```

Un seul tenant : `http://<SDK_HOST>:11001/` (sans préfixe) reprend **<fspid>**. Dès un 2ᵉ DFSP, le préfixe `/<fspid>/` est obligatoire.

---

## 4. Couper le WAF (Hub)

Sur le WAF, vhost `<fspid>.ext.<HUB_DOMAIN>` :

```nginx
proxy_pass http://<SDK_HOST>:11000;
```

`nginx -t && systemctl reload nginx`.

MCM callbacks restent `https://<fspid>.ext.<HUB_DOMAIN>` (pas d’IP, pas `http://`).

CBS : pointer vers `http://<SDK_HOST>:11001` (ou `…/<fspid>` si plusieurs tenants).

---

## 5. Tests Hub

Lookup <fspid> (`:6001`) d’un alias ALS → `<fspid>`, puis `POST /transfers` <fspid> → <fspid> → `COMPLETED`.

---

## Retour arrière

```bash
cd ~/sdk-fececam/sdk-scheme-adapter-multi-tenant
docker compose -f lab/docker-compose.yml down
# WAF : proxy_pass http://<SDK_HOST>:4000
docker update --restart=unless-stopped sdk-scheme-adapter-<fspid>
docker start sdk-scheme-adapter-<fspid>
```
