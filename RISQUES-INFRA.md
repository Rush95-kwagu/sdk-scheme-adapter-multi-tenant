# Registre des risques — infrastructure imbriquée (HDD)

**Date :** 15 octobre 2026  
**Périmètre :** hôte(s) Proxmox, clusters Talos `ml-cc` / `ml-test`, WAF-AGG, nœud SDK `172.25.2.117`.  
**Contrainte déclarée :** **disques HDD** (pas SSD/NVMe) sous toute la pile.

Un transfert d’argent traverse **plusieurs couches d’orchestration** qui se croient indépendantes (HA, IOPS, réseau). Sur HDD, chaque couche ajoute latence `fsync` et files d’attente. Les pannes 14–15 oct. (Vault Raft, API K8s `no route to host`, Envoy cert stale, stampede Docker) sont des **symptômes d’imbrication**, pas des bugs isolés.

---

## Architecture imbriquée (telle qu’exploitée)

```
HDD physique
  └─ Proxmox (LVM / qcow2 / OpenEBS backing)
       ├─ VM Talos ml-cc          (Harbor, MinIO, obs)
       ├─ VM Talos ml-test        (etcd, Vault, MySQL, Kafka, Envoy, MCM)
       │    └─ Kubernetes + Cilium
       │         ├─ etcd                    (fsync synchrone)
       │         ├─ Vault Raft ×3           (journal)
       │         ├─ PXC / MySQL, Kafka      (WAL)
       │         ├─ OpenEBS / PVC           (encore un FS)
       │         └─ Envoy + Cilium SDS
       ├─ VM WAF-AGG              (nginx, logs, Let's Encrypt)
       └─ VM SDK (Docker)
            ├─ overlayfs + volumes Vault×8, Redis×N, SDK×5 + overlay
            └─ extra_hosts → 172.16.2.28 (extapi)
```

**Chemin d’un POST /transfers (payer overlay → payee 1:1) :**

CBS → `:11001` (iptables hôte SDK) → `sdk-fececam` → TLS extapi (VM Hub) → Envoy inbound → ALS (etcd/MySQL) → Cilium Envoy **mTLS** → WAF HDD → nginx → SDK payee `:6000` → Redis/Vault DFSP sur **le même** HDD Docker → callback inverse.

Chaque saut = copie, NAT ou TLS. Le HDD est **partagé** par Kafka Hub, etcd, Vault Raft **et** 8 Vaults DFSP Docker.

---

## Élevé

### I1 — HA Kubernetes / Vault **sur le même disque et souvent le même nœud**

**Fait :** `vault-0/1/2` tous sur `ml-test-w-2`. Raft « 3 replicas » = **un worker + un HDD**.  
**Preuve :** 200+ restarts ; `dial :8201 connection refused` ; MCM `local node not active`.

**Risque :** une file d’attente HDD (Kafka compact, snapshot, `docker build`) → timeout Raft → élection → Vault standby sans leader → plus de JWS, plus de PKI, transferts en `invalid signature` / 500.

**Remède :** anti-affinity Vault **et** workers sur **disques/nœuds distincts**. SSD/NVMe pour etcd + Vault + MySQL + Kafka. Tant que HDD unique : **ne pas** traiter le cluster comme HA ; runbook unseal + freeze des jobs lourds (snapshots, Harbor GC) pendant la fenêtre argent.

### I2 — etcd / API K8s sur HDD + NAT Proxmox

**Preuve :** ping `172.16.2.25` OK, `kubectl` `no route to host` :6443, puis TLS OK. NAT `vmbr0`/`eno1`, routes `/32` **non persistantes**.

**Risque :** l’apiserver (etcd fsync) saturé ou conntrack plein → ops aveugle (pas de restart Envoy, pas de cert). Talos « 3 control planes » sur le même stockage = même goulot.

**Remède :** SSD etcd ; VIP API stable ; iptables/routes **systemd** (pas seulement session) ; alerte `nc -z :6443` **et** latence etcd. Console Proxmox / Tailscale si SSH `eno1` casse après NAT.

### I3 — Triple NAT / triple proxy sur le data path argent

CBS → Docker publish `0.0.0.0` → (option) overlay réseau → extra_hosts → **Cilium LB** → Envoy → **Cilium Envoy egress mTLS** → **nginx WAF** → Docker 1:1.

**Risque :** timeout quote 30 s (vu) sans qu’aucune appli « soit lente » : une jambe HDD + handshake TLS de trop. 301 ALS `http://` = encore un round-trip. Perte de `Host` / client cert au mauvais hop.

**Remède :** moins de sauts (endpoints ALS **https**, pas de redirect 80). Mesurer `duration_ms` Envoy + `request_time` nginx + temps SDK. MTU cohérent (Proxmox → Cilium VXLAN → Docker bridge) : fragments = CPU+HDD.

### I4 — OpenEBS / PVC **imbriqués dans des qcow2/LVM HDD**

Kube croit avoir des volumes « locaux rapides ». Ils sont des fichiers sur HDD Proxmox, souvent thin-provisioned.

**Risque :** amplification write (qcow2 + FS guest + WAL Kafka/MySQL). `Discard`/fstrim rarement en ligne. Latence p99 imprévisible → PXC flow control, Kafka under-replicated.

**Remède :** disques VM **raw + SSD** pour `data` (MySQL, Kafka, etcd). HDD seulement MinIO froid / backups. Monitorer `iowait` hôte Proxmox **et** `kubectl top` **et** `iostat` SDK.

### I5 — Nœud SDK : Docker overlayfs × dizaines de volumes sur le **même HDD**

8 Vaults file-backend + Redis + 5 SDK + overlay + images. `just build` / `docker restart` = tempête I/O.

**Risque :** un `docker restart` de 8 agents (15 oct.) coïncide avec Vault Hub instable : **contention disque globale** si SDK et Hub partagent le même SAN/HDD Proxmox, ou saturation CPU iowait sur le nœud SDK → WS `:4004` `ECONNREFUSED` prolongé.

**Remède :** quota I/O cgroup ; ne pas co-héberger Hub et SDK sur le même spindle. SSD pour `/var/lib/docker`. Étaler les restarts. `ionice` backups.

### I6 — iptables / `rp_filter` / pont **sans NIC esclave**

`vmbr0` isolé, SNAT vers `eno1`, `rp_filter=0`. Règles **perdues au reboot**.

**Risque :** après reboot Proxmox, Talos sans DHCP, API morte, Extapi injoignable — **tous** les DFSPs.

**Remède :** netplan/ifup + iptables-persistent + test reboot. Pont : une NIC bridge port, une IP.

---

## Moyen

### J1 — Deux clusters (`ml-cc` / `ml-test`) + WAF unique + Cloudflare `wan`

external-dns `sync` peut **effacer** des records. Un WAF sert Hub, MCM, FSPIOP, docs, ERP tiers.

**Risque :** reload nginx pour un vhost DFSP casse hydra/mcm (déjà des handshake reset). HDD logs nginx `access.log` unique.

**Remède :** WAF Mojaloop dédié ; error_log par vhost ; freeze DNS pendant cutover.

### J2 — Observabilité (Loki/Tempo/MinIO) sur HDD

Les mêmes spindles que etcd. Un scrape trop fréquent = vol d’IOPS au Raft.

**Remède :** rétention courte ; scrape Prometheus allégé sur Vault/etcd ; MinIO sur autre disque.

### J3 — Job `vault-raft-snapshot` Init:Error

Pas de backup Raft. Sur HDD un snapshot coincé **aggrave** I1.

**Remède :** fixer le Job ; snapshots hors heures ; destination SSD/NFS pas le volume Raft.

### J4 — Horloge / NTP (Talos + Docker + WAF)

JWS et certs `notBefore`/`Date` FSPIOP. HDD n’aide pas le drift, mais un `fsync` lent retarde `chrony`.

**Remède :** NTP explicite Talos + hôtes ; alerte offset &gt; 1 s.

### J5 — Un seul nœud SDK pour prod + lab

Pas d’anti-affinity métier. Panne VM ou HDD = moov 1:1 **et** overlay.

**Remède :** nœud SDK prod vs lab ; backup `docker volume` **avant** `apt upgrade`.

### J6 — extra_hosts `extapi → 172.16.2.28` vs DNS public

Bypass Cloudflare/WAF pour le SDK → Envoy. Le WAF ne voit pas le TLS DFSP→Hub.

**Risque :** split-brain cert (on debug le WAF, le SDK parle au LB interne). IP 172.16.2.28 bougée = tous les extra_hosts morts.

**Remède :** inventaire extra_hosts ; documenter le chemin réel ; probe depuis le **SDK** pas seulement openssl WAF.

---

## Faible

### K1 — Thin provisioning Proxmox : `df` guest OK, datastore 100 %

Arrêt brutal VM → corruption etcd/Vault.

### K2 — Pas de QoS disque Proxmox (`iops_rd` / `mbps`)

Un `docker pull` Hub ISO tue Kafka.

### K3 — Logs Docker json-file illimités sur HDD

Remplir le disque → Redis/Vault read-only.

**Remède :** `log-opts max-size` daemon.json.

### K4 — Backup HDD lent = RPO illusoire

Un dump MySQL de nuit encore en cours le matin vole les IOPS des transferts.

---

## HDD : ce que ça change pour l’argent

| Charge | Effet HDD | Impact transfert |
|--------|-----------|------------------|
| etcd `fsync` | p99 10–100× vs NVMe | API K8s / ALS lents, timeouts |
| Vault Raft log | Élections, standby | JWS/PKI 500 |
| Kafka + PXC WAL | Queue, flow control | Quote/transfer Hub 5xx |
| Docker overlayfs | `just build`, restarts | Trous WS, callbacks 502 |
| nginx access.log | Sync éventuellement | WAF lent sous volume |

**Cible mini pour un scheme qui bouge de l’argent :** NVMe (ou SSD entreprise) pour etcd, Vault, MySQL, Kafka, `/var/lib/docker`. HDD : archives MinIO, backups froids, ISO Proxmox.

---

## Matrice symptôme → couche imbriquée

| Symptôme | Couche à regarder **en premier** |
|----------|----------------------------------|
| Vault `8201 connection refused` + 3 pods 1 node | I1 + iowait `ml-test-w-2` |
| kubectl `no route` / ping OK | I2 NAT/conntrack, pas « le DNS » |
| Quote 504, CPU SDK bas | I3 hops + I4 PVC Hub |
| 8 × `ECONNREFUSED :4004` | I5 stampede Docker/HDD |
| Après reboot Proxmox, plus de Talos | I6 iptables |
| Cert extapi K8s OK, TLS expired | Envoy (appli) **mais** I/O peut empêcher watched_directory |

---

## Ordre de durcissement infra

1. Mesurer : `iostat -xz 5` Proxmox, workers Talos, SDK — confirmer HDD saturé.  
2. **I6** persistance réseau (reboot Proxmox testé).  
3. **I2** SSD etcd + VIP + alerte :6443.  
4. **I1** Vault/workers pas co-localisés ; NVMe Raft.  
5. **I5** Docker sur SSD ; quota ; pas de co-résidence Hub/SDK.  
6. **I4** PVC data sur raw SSD, pas qcow2 thin.  
7. **I3** réduire hops (https ALS, pas 301).  
8. Logs Docker rotation (K3) ; QoS Proxmox (K2).

---

## Commandes (constat HDD / imbrication)

```bash
# Hôte Proxmox
lsblk -d -o NAME,ROTA,TYPE,SIZE,MODEL   # ROTA=1 → HDD
iostat -xz 5 3
pvesm status

# Worker Hub
kubectl -n vault get pods -o wide
kubectl get nodes -o custom-columns=NAME:.metadata.name,OS:.status.nodeInfo.osImage

# SDK
df -hT /var/lib/docker
docker system df -v | head
```
