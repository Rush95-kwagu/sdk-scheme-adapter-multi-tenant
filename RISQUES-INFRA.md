# Audit infrastructure : instabilité `ml-test` (imbrication + I/O)

**Sources :** audit 30 juil. – 31 août 2026 (`audit-infra-instabilite-ml-test.md`) ; observations 14–15 oct. 2026 (Vault Raft, `kubectl` :6443, stampede SDK).  
**Périmètre :** hébergement du cluster Talos `ml-test` et du Hub.  
**Chaîne :** VM Sonatel (KVM) → Proxmox VE 9.2.5 (**nested**) → VM Talos v1.13.3 / Kubernetes v1.36.1.

Les CrashLoopBackOff (cilium-operator, vault, kube-controller-manager, kube-scheduler, handlers Mojaloop) **ne sont pas** un défaut de chart Kubernetes. Cause racine : **latence disque** → etcd rate → VIP control plane retiré → API intermittente.

---

## Résumé exécutif

Trois facteurs structurels :

1. **Virtualisation imbriquée** (hyperviseur Sonatel → Proxmox → VM Talos).
2. **Stockage unique partagé** (`sda`, 300 Go) sollicité par plusieurs VM.
3. **etcd à instance unique** (un control plane), sans quorum.

Le cluster s’est stabilisé après l’arrêt de `ml-cc-m-0` et `<SDK_NODE>` : **contournement**, pas une correction. Récidive dès que l’I/O remonte.

```
Contention I/O sda (fsync 300–450 ms)
        → etcd : context deadline exceeded
        → etcd session closed → VIP <KUBE_API_VIP> retiré
        → API :6443 « no route to host »
        → CrashLoopBackOff en cascade
```

Chronologie Talos `ml-test-c-0` (30/07/2026 UTC) : health etcd OK 15:36 → deadline 15:37 → VIP assigné 15:40 → session closed / VIP retiré 15:41 → réassigné 15:42 → retiré 15:42 → réassigné 15:43. **Signature etcd instable**, pas un pare-feu.

---

## Preuves (août 2026)

| Métrique hôte (`iostat`) | Observé | Cible etcd |
|---|---|---|
| `w_await` | 78 – 208 ms | &lt; 10 ms |
| `f_await` (fsync) | 333 – 446 ms | &lt; 10–20 ms |
| `%util` | 85 – 93 % | &lt; 70–80 % continu |
| `aqu-sz` | 29 – 34 | ~0–2 |
| `%iowait` CPU | 10 – 16 % | &lt; 5 % |

Hôte : load 21–23 / 32 vCPU ; steal ~0 ; RAM 128 Go (~90 Go used) ; 5 VM KVM dont 4 à ~18 Go RSS.  
`sda` = QEMU HARDDISK ; `systemd-detect-virt` = kvm ; hébergeur VM `mojaloop` = Sonatel.  
PSI I/O VM `106` (`<SDK_NODE>`) Full ~15–35 %.

Redémarrages K8s : `vault-2` 537 ; handlers moja ~203–206 ; psmdb-operator 122 ; OpenEBS 111 ; redis-operator 103 ; kube-controller/scheduler 15–16. Uptime `ml-test-c-0` 50 min vs cluster 2 j → control plane **redémarré**.

Oct. 2026 : même VIP `no route to host` puis TLS OK ; Vault 3 pods sur `ml-test-w-2`, 200+ restarts, MCM `local node not active`.

---

## Failles (F1–F14)

### Élevé

**F1 — Saturation I/O (fsync).** 10–40× le seuil etcd. Impact : VIP, API, CrashLoop, risque cohérence Mongo/Redis/Vault.  
Court terme : ne pas lancer `ml-cc` + SDK + `ml-test` sans `iostat`. Moyen terme : SSD/NVMe (au moins le disque control plane). Bench fio § annexes.

**F2 — Nested virt ×3.** Chaque couche ajoute du jitter sur les écritures sync. Idéal : Proxmox bare metal ou Talos chez le fournisseur. À défaut : moins de VM, virtio cache caractérisé (F11).

**F3 — etcd unique (`ml-test-c-0`).** Pas de quorum. Test : acceptable si disque rapide. Préprod/prod : **3** control planes (impair), hôtes physiques distincts. Palliatif : `heartbeat-interval` / `election-timeout` (masque le symptôme).

**F4 — SPOF hôte + disque.** Profil `tps-1` : tous les placement groups sur le nœud Proxmox `mojaloop` / `sda`. Une panne = control plane + workers + Hub. Documenter « pas de HA » ou répartir 2–3 hôtes.

**F5 — Co-hébergement sans isolation I/O.** `ml-cc-m-0`, `<SDK_NODE>`, CT101 et `ml-test` (4 VM) sur le même `sda`. Stabilité seulement après arrêt ml-cc + SDK. QoS Proxmox `mbps_*` / `iops_*` ; disque CP dédié ; règle d’exploitation (quelles VM en parallèle).

### Moyen

**F6 — ml-test dépend de ml-cc** (Harbor, S3, Loki/Thanos) alors que ml-cc doit parfois être éteint. Vérifier le fallback images ; déplacer ml-cc ; documenter.

**F7 — Pas d’alerte I/O / etcd.** Découverte via CrashLoop. Obs pointe vers ml-cc arrêté. Alerter : `etcd_disk_wal_fsync_duration_seconds` p99 &gt; 10 ms ; iostat ; pertes de session etcd ; flapping VIP Talos. Supervision **hors ml-cc**.

**F8 — Vault CrashLoop (537).** Après I/O stable : `vault status` chaque pod, Raft, snapshot. 3 réplicas sains avant test argent.

**F9 — Marge RAM/CPU hôte.** ~70 % RAM, load 21–23. Réserver le control plane ; pas de swap pour etcd.

**F10 — `talosconfig` collé en clair** (cert client + clé). Accès admin Talos. Ne jamais le mettre dans la doc ; rotation si l’échange a fuité.

**F11 — Stockage Sonatel / `cache=` Proxmox inconnus.** Demander type, IOPS, offre NVMe. `qm config`. `cache=writeback` : moins de latence, risque perte crash — test only.

### Faible

**F12 — `talosconfig` par défaut vers `<TALOSCONFIG_STALE>`.** Faux « no route ». `TALOSCONFIG` / `talosctl config info`.

**F13 — talosctl 1.13.5 vs nœuds 1.13.3.** Aligner.

**F14 — NTP/DNS Talos commentés dans `config.yaml`.** `talosctl time` ; etcd/certs sensibles à l’horloge.

---

## Plan priorisé

| P | Action |
|---|---|
| P0 | Pas de ml-cc + SDK + ml-test ensemble sans `iostat` |
| P0 | Limites I/O disques virtuels Proxmox |
| P0 | Masquer/rotation credentials Talos |
| P1 | Interroger Sonatel (NVMe / IOPS) ; alertes etcd hors ml-cc ; santé Vault ; ml-test sans ml-cc |
| P2 | Disque CP rapide dédié ; resize VM ; talosconfig/NTP |
| P3 | Sortir du nested ; 3 CP / plusieurs hôtes |

---

## Annexes

**fio etcd (p99 fdatasync &lt; ~10 ms) :**

```bash
mkdir -p /tmp/etcd-bench && cd /tmp/etcd-bench
fio --rw=write --ioengine=sync --fdatasync=1 \
    --directory=/tmp/etcd-bench --size=22m --bs=2300 --name=etcd-fsync
```

**QoS Proxmox (exemple) :** `scsi0: …,mbps_rd=100,mbps_wr=50,iops_rd=2000,iops_wr=1000`

**Palliatif etcd (dernier recours) :**

```yaml
cluster:
  etcd:
    extraArgs:
      heartbeat-interval: "500"
      election-timeout: "5000"
```

Hors infra : un PUT /parties error 400 sans `errorCode` (<fspid>) est applicatif ; la PSI I/O du SDK peut aggraver, non démontré.

Limites : iostat court ; logs etcd natifs non lus ; type stockage Sonatel non confirmé ; intégrité Vault/Mongo après crash non auditée.
