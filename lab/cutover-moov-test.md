# Cutover <fspid> → overlay (déjà <fspid> + <fspid>)

Ne **pas** arrêter `mcm-agent-<fspid>`, Vault, Redis <fspid>.  
Ne **pas** arrêter le DFSP prod **`<fspid>`** (`sdk-scheme-adapter-<fspid>` `:6000`, agent `:6003`).  
Ne pas changer CoreDNS / WAF **<fspid>**.

WAF actuel : `<fspid>.ext.<HUB_DOMAIN>` → `:10200`.  
UI MCM : `mcm-<fspid>` → `:10203` (inchangé).

---

## 1. Réseaux + overlay

Sur `sdk@<SDK_NODE>`, clone overlay (ex. `~/sdk-fececam/sdk-scheme-adapter-multi-tenant`) :

```bash
cd ~/sdk-fececam/sdk-scheme-adapter-multi-tenant   # adapter le chemin

export CMCALAVI_DOCKER_NET=$(docker inspect mcm-agent-<fspid> \
  -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | head -1)
export GTO_DOCKER_NET=$(docker inspect mcm-agent-<fspid> \
  -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | head -1)
export MOOV_TEST_DOCKER_NET=$(docker inspect mcm-agent-<fspid> \
  -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | head -1)
export IN=11000 OUT=11001 MET=11040

echo "<fspid>=$CMCALAVI_DOCKER_NET"
echo "<fspid>=$GTO_DOCKER_NET"
echo "<fspid>=$MOOV_TEST_DOCKER_NET"
```

Dans `lab/docker-compose.yml` (si pas déjà à jour) :

- `MGMT_API_WS_URLS` contient `<fspid>@mcm-agent-<fspid>:4004`
- réseau externe `<fspid>` → `$MOOV_TEST_DOCKER_NET`

## 2. Stopper le SDK dédié <fspid> seulement

Outage Hub **<fspid>** jusqu’au reload WAF.

```bash
docker update --restart=no sdk-scheme-adapter-<fspid>
docker stop sdk-scheme-adapter-<fspid>
```

## 3. Recréer l’overlay

```bash
docker compose -f lab/docker-compose.yml up --build -d
sleep 15
curl -sS http://127.0.0.1:11000/pm4ml-tenants
docker exec sdk-fececam getent hosts mcm-agent-<fspid>
```

Attendu : `"tenants"` contient `<fspid>`, `<fspid>` **et** `<fspid>` ; `backendEndpoint` avec `/mojaloop` ; `outboundCertBytes` > 0.

```bash
curl -sS -w " HTTP %{http_code}\n" -o /dev/null http://127.0.0.1:11001/<fspid>/
curl -sS -o /tmp/in-<fspid>.json -w "HTTP %{http_code}\n" \
  -H "Host: <fspid>.ext.<HUB_DOMAIN>" \
  -H "Accept: application/vnd.interoperability.parties+json;version=1.1" \
  -H "Content-Type: application/vnd.interoperability.parties+json;version=1.1" \
  -H "Date: $(date -u +%a,\ %d\ %b\ %Y\ %H:%M:%S\ GMT)" \
  -H "FSPIOP-Source: <fspid>" \
  -H "FSPIOP-Destination: <fspid>" \
  "http://127.0.0.1:11000/parties/MSISDN/22900000000"
```

Outbound préfixe **200**, inbound **202**. Relire `/pm4ml-tenants` : <fspid> et <fspid> toujours là.

## 4. WAF

`<fspid>.ext.<HUB_DOMAIN>` : `proxy_pass http://<SDK_HOST>:11000;`  
(`nginx -t && systemctl reload nginx`)

`mcm-<fspid>.ext.<HUB_DOMAIN>` reste `:10203`.

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://<fspid>.ext.<HUB_DOMAIN>/ping
# 405
```

MCM callbacks : déjà `https://<fspid>.ext.<HUB_DOMAIN>` — ne pas changer.

## 5. Outbound CBS / tests

```text
POST http://127.0.0.1:11001/<fspid>/transfers
POST http://127.0.0.1:11001/<fspid>/transfers          # payee ALS = <fspid>
POST http://127.0.0.1:11001/<fspid>/transfers
```

Le CBS <fspid> doit viser `:11001/<fspid>/…` (plus `:10201`).  
`cbs.counterparties` : payer `<fspid>` / `<fspid>` si tu crédites cette caisse.

Ne pas utiliser `0195920986` (ALS → **<fspid>** prod). Alias payee dont `GET /parties` renvoie `"fspId":"<fspid>"`.

## Retour arrière <fspid> seul

WAF → `:10200`, retirer `<fspid>@…` de `MGMT_API_WS_URLS` + réseau compose, `compose up -d`, `docker start sdk-scheme-adapter-<fspid>`.
