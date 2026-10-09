# Cutover gto → overlay (déjà cmcalavi)

Ne pas arrêter `mcm-agent-gto`, Vault, Redis gto.
Ne pas relancer `sdk-scheme-adapter-cmcalavi`.
MCM UI gto (`:5003`) inchangée.

**Deux tenants** : l’outbound **sans** préfixe n’est plus fiable. CBS cmcalavi doit passer à `http://172.25.2.117:11001/cmcalavi/…`.

WAF actuel : `gto.ext.openmfi.org` → `:5000`.

---

## 1. Pull

```bash
cd ~/sdk-fececam/sdk-scheme-adapter-multi-tenant
git pull
```

## 2. Réseaux

```bash
export CMCALAVI_DOCKER_NET=$(docker inspect mcm-agent-cmcalavi \
  -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | head -1)
export GTO_DOCKER_NET=$(docker inspect mcm-agent-gto \
  -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | head -1)
echo "cmcalavi=$CMCALAVI_DOCKER_NET"
echo "gto=$GTO_DOCKER_NET"
export IN=11000 OUT=11001 MET=11040
```

## 3. Stopper le SDK dédié gto

```bash
docker update --restart=no sdk-scheme-adapter-gto
docker stop sdk-scheme-adapter-gto
```

Outage Hub gto jusqu’au WAF.

## 4. Recréer l’overlay (cmcalavi reconnecte)

```bash
docker compose -f lab/docker-compose.yml up --build -d
sleep 10
curl -sS http://127.0.0.1:11000/pm4ml-tenants
```

Attendu : `{"tenants":["cmcalavi","gto"]}` (ordre indifférent).

```bash
docker exec sdk-mt-sdk-1 getent hosts mcm-agent-gto
curl -sS -w " HTTP %{http_code}\n" -o /dev/null http://127.0.0.1:11001/gto/
curl -sS -o /tmp/in-gto.json -w "HTTP %{http_code}\n" \
  -H "Host: gto.ext.openmfi.org" \
  -H "Accept: application/vnd.interoperability.parties+json;version=1.1" \
  -H "Content-Type: application/vnd.interoperability.parties+json;version=1.1" \
  -H "Date: $(date -u +%a,\ %d\ %b\ %Y\ %H:%M:%S\ GMT)" \
  -H "FSPIOP-Source: moov" \
  -H "FSPIOP-Destination: gto" \
  "http://127.0.0.1:11000/parties/MSISDN/22900000000"
```

Outbound **200**, inbound **202**. Relire cmcalavi : `GET /pm4ml-tenants` contient encore `cmcalavi`.

## 5. WAF

`gto.ext.openmfi.org` : `proxy_pass http://172.25.2.117:11000;`
`nginx -t && systemctl reload nginx`

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://gto.ext.openmfi.org/ping
# 405
```

`mcm-gto.ext.openmfi.org` reste `:5003`.

## 6. Outbound CBS

```text
http://172.25.2.117:11001/cmcalavi/transfers
http://172.25.2.117:11001/gto/transfers
```

## Retour arrière gto seul

WAF gto → `:5000`, retirer `gto@…` de `MGMT_API_WS_URLS`, `compose up -d`, `docker start sdk-scheme-adapter-gto`.
