# Cutover cmcalavi → overlay (sdk-node)

Ne pas arrêter `mcm-agent-cmcalavi`, `sdk-vault-cmcalavi`, `sdk-redis-cmcalavi`.
Ne pas toucher moov / gto / mtn / clcam-*.

WAF actuel : `cmcalavi.ext.openmfi.org` → `172.25.2.117:4000`.
MCM UI : `mcm-cmcalavi.ext.openmfi.org` → `:3000` (inchangé).

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
export CMCALAVI_DOCKER_NET=$(docker inspect mcm-agent-cmcalavi \
  -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
echo "$CMCALAVI_DOCKER_NET"
```

Doit afficher un nom (souvent `dfsp-cmcalavi_mojaloop` ou `…_default`).

---

## 2. Libérer 11000 et l’agent

```bash
export IN=11000 OUT=11001 MET=11040
cd ~/sdk-fececam/sdk-scheme-adapter-multi-tenant
docker compose -f poc/docker-compose.yml down

docker update --restart=no sdk-scheme-adapter-cmcalavi
docker stop sdk-scheme-adapter-cmcalavi
```

Outage Hub cmcalavi jusqu’à l’étape 4 (WAF encore sur `:4000`).

---

## 3. Démarrer l’overlay

```bash
docker compose -f lab/docker-compose.yml up --build -d
sleep 8
curl -sS http://127.0.0.1:11000/pm4ml-tenants
docker logs --tail 80 sdk-mt-sdk-1 2>&1 | grep -E 'cmcalavi|NOTIFY|tenant|error' || true
```

Attendu : `{"tenants":["cmcalavi"]}`. Si `[]` : l’agent n’a pas fourni `dfspId` (corrigé par `cmcalavi@mcm-agent-…` après rebuild) ; ou le SDK n’est pas sur le réseau de l’agent :

```bash
docker inspect sdk-mt-sdk-1 -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
docker exec sdk-mt-sdk-1 getent hosts mcm-agent-cmcalavi
docker logs sdk-mt-sdk-1 2>&1 | grep -E 'upsert|placeholder|waiting for mcm|CONFIGURATION|tenant'
docker restart mcm-agent-cmcalavi
```

Inbound (bypass WAF) :

```bash
curl -sS -o /tmp/in.json -w "HTTP %{http_code}\n" \
  -H "Host: cmcalavi.ext.openmfi.org" \
  -H "Accept: application/vnd.interoperability.parties+json;version=1.1" \
  -H "Content-Type: application/vnd.interoperability.parties+json;version=1.1" \
  -H "Date: $(date -u +%a,\ %d\ %b\ %Y\ %H:%M:%S\ GMT)" \
  -H "FSPIOP-Source: moov" \
  -H "FSPIOP-Destination: cmcalavi" \
  "http://127.0.0.1:11000/parties/MSISDN/22900000000"
```

202 = le SDK a accepté (l’ALS Hub fera le PUT). 3100/3101 = tenant/certs/backend, coller le body.

Outbound :

```text
http://172.25.2.117:11001/cmcalavi/
http://172.25.2.117:11001/cmcalavi/parties/MSISDN/<alias>
```

Un seul tenant : `http://172.25.2.117:11001/` (sans préfixe) reprend **cmcalavi**. Dès un 2ᵉ DFSP, le préfixe `/cmcalavi/` est obligatoire.

---

## 4. Couper le WAF (Hub)

Sur le WAF, vhost `cmcalavi.ext.openmfi.org` :

```nginx
proxy_pass http://172.25.2.117:11000;
```

`nginx -t && systemctl reload nginx`.

MCM callbacks restent `https://cmcalavi.ext.openmfi.org` (pas d’IP, pas `http://`).

CBS : pointer vers `http://172.25.2.117:11001` (ou `…/cmcalavi` si plusieurs tenants).

---

## 5. Tests Hub

Lookup Moov (`:6001`) d’un alias ALS → `cmcalavi`, puis `POST /transfers` Moov → cmcalavi → `COMPLETED`.

---

## Retour arrière

```bash
cd ~/sdk-fececam/sdk-scheme-adapter-multi-tenant
docker compose -f lab/docker-compose.yml down
# WAF : proxy_pass http://172.25.2.117:4000
docker update --restart=unless-stopped sdk-scheme-adapter-cmcalavi
docker start sdk-scheme-adapter-cmcalavi
```
