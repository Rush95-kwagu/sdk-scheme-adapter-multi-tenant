# Cutover <fspid> → overlay (déjà <fspid>)

Ne pas arrêter `mcm-agent-<fspid>`, Vault, Redis <fspid>.
Ne pas relancer `sdk-scheme-adapter-<fspid>`.
MCM UI <fspid> (`:5003`) inchangée.

**Deux tenants** : l’outbound **sans** préfixe n’est plus fiable. CBS <fspid> doit passer à `http://<SDK_HOST>:11001/<fspid>/…`.

WAF actuel : `<fspid>.ext.<HUB_DOMAIN>` → `:5000`.

---

## 1. Pull

```bash
cd ~/sdk-fececam/sdk-scheme-adapter-multi-tenant
git pull
```

## 2. Réseaux

```bash
export CMCALAVI_DOCKER_NET=$(docker inspect mcm-agent-<fspid> \
  -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | head -1)
export GTO_DOCKER_NET=$(docker inspect mcm-agent-<fspid> \
  -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | head -1)
echo "<fspid>=$CMCALAVI_DOCKER_NET"
echo "<fspid>=$GTO_DOCKER_NET"
export IN=11000 OUT=11001 MET=11040
```

## 3. Stopper le SDK dédié <fspid>

```bash
docker update --restart=no sdk-scheme-adapter-<fspid>
docker stop sdk-scheme-adapter-<fspid>
```

Outage Hub <fspid> jusqu’au WAF.

## 4. Recréer l’overlay (<fspid> reconnecte)

```bash
docker compose -f lab/docker-compose.yml up --build -d
sleep 10
curl -sS http://127.0.0.1:11000/pm4ml-tenants
```

Attendu : `{"tenants":["<fspid>","<fspid>"]}` (ordre indifférent).

```bash
docker exec sdk-fececam getent hosts mcm-agent-<fspid>
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

Outbound **200**, inbound **202**. Relire <fspid> : `GET /pm4ml-tenants` contient encore `<fspid>`.

## 5. WAF

`<fspid>.ext.<HUB_DOMAIN>` : `proxy_pass http://<SDK_HOST>:11000;`
`nginx -t && systemctl reload nginx`

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://<fspid>.ext.<HUB_DOMAIN>/ping
# 405
```

`mcm-<fspid>.ext.<HUB_DOMAIN>` reste `:5003`.

## 6. Outbound CBS

```text
http://<SDK_HOST>:11001/<fspid>/transfers
http://<SDK_HOST>:11001/<fspid>/transfers
```

## Retour arrière <fspid> seul

WAF <fspid> → `:5000`, retirer `<fspid>@…` de `MGMT_API_WS_URLS`, `compose up -d`, `docker start sdk-scheme-adapter-<fspid>`.
