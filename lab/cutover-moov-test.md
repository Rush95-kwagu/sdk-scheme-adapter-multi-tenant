# Cutover moov-test → overlay (déjà cmcalavi + gto)

Ne **pas** arrêter `mcm-agent-moov-test`, Vault, Redis moov-test.  
Ne **pas** arrêter le DFSP prod **`moov`** (`sdk-scheme-adapter-moov` `:6000`, agent `:6003`).  
Ne pas changer CoreDNS / WAF **moov**.

WAF actuel : `moov-test.ext.openmfi.org` → `:10200`.  
UI MCM : `mcm-moov-test` → `:10203` (inchangé).

---

## 1. Réseaux + overlay

Sur `sdk@cmcalavi-sdk-node`, clone overlay (ex. `~/sdk-fececam/sdk-scheme-adapter-multi-tenant`) :

```bash
cd ~/sdk-fececam/sdk-scheme-adapter-multi-tenant   # adapter le chemin

export CMCALAVI_DOCKER_NET=$(docker inspect mcm-agent-cmcalavi \
  -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | head -1)
export GTO_DOCKER_NET=$(docker inspect mcm-agent-gto \
  -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | head -1)
export MOOV_TEST_DOCKER_NET=$(docker inspect mcm-agent-moov-test \
  -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | head -1)
export IN=11000 OUT=11001 MET=11040

echo "cmcalavi=$CMCALAVI_DOCKER_NET"
echo "gto=$GTO_DOCKER_NET"
echo "moov-test=$MOOV_TEST_DOCKER_NET"
```

Dans `lab/docker-compose.yml` (si pas déjà à jour) :

- `MGMT_API_WS_URLS` contient `moov-test@mcm-agent-moov-test:4004`
- réseau externe `moov-test` → `$MOOV_TEST_DOCKER_NET`

## 2. Stopper le SDK dédié moov-test seulement

Outage Hub **moov-test** jusqu’au reload WAF.

```bash
docker update --restart=no sdk-scheme-adapter-moov-test
docker stop sdk-scheme-adapter-moov-test
```

## 3. Recréer l’overlay

```bash
docker compose -f lab/docker-compose.yml up --build -d
sleep 15
curl -sS http://127.0.0.1:11000/pm4ml-tenants
docker exec sdk-mt-sdk-1 getent hosts mcm-agent-moov-test
```

Attendu : `"tenants"` contient `cmcalavi`, `gto` **et** `moov-test` ; `backendEndpoint` avec `/mojaloop` ; `outboundCertBytes` > 0.

```bash
curl -sS -w " HTTP %{http_code}\n" -o /dev/null http://127.0.0.1:11001/moov-test/
curl -sS -o /tmp/in-moov-test.json -w "HTTP %{http_code}\n" \
  -H "Host: moov-test.ext.openmfi.org" \
  -H "Accept: application/vnd.interoperability.parties+json;version=1.1" \
  -H "Content-Type: application/vnd.interoperability.parties+json;version=1.1" \
  -H "Date: $(date -u +%a,\ %d\ %b\ %Y\ %H:%M:%S\ GMT)" \
  -H "FSPIOP-Source: gto" \
  -H "FSPIOP-Destination: moov-test" \
  "http://127.0.0.1:11000/parties/MSISDN/22900000000"
```

Outbound préfixe **200**, inbound **202**. Relire `/pm4ml-tenants` : cmcalavi et gto toujours là.

## 4. WAF

`moov-test.ext.openmfi.org` : `proxy_pass http://172.25.2.117:11000;`  
(`nginx -t && systemctl reload nginx`)

`mcm-moov-test.ext.openmfi.org` reste `:10203`.

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://moov-test.ext.openmfi.org/ping
# 405
```

MCM callbacks : déjà `https://moov-test.ext.openmfi.org` — ne pas changer.

## 5. Outbound CBS / tests

```text
POST http://127.0.0.1:11001/moov-test/transfers
POST http://127.0.0.1:11001/gto/transfers          # payee ALS = moov-test
POST http://127.0.0.1:11001/cmcalavi/transfers
```

Le CBS moov-test doit viser `:11001/moov-test/…` (plus `:10201`).  
`cbs.counterparties` : payer `gto` / `cmcalavi` si tu crédites cette caisse.

Ne pas utiliser `0195920986` (ALS → **moov** prod). Alias payee dont `GET /parties` renvoie `"fspId":"moov-test"`.

## Retour arrière moov-test seul

WAF → `:10200`, retirer `moov-test@…` de `MGMT_API_WS_URLS` + réseau compose, `compose up -d`, `docker start sdk-scheme-adapter-moov-test`.
