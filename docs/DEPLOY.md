# Deploying to Google Cloud

Target project: **`account-505805`**.
Target hostname: **`acc.chaithanin.com`** (the default — no export needed).

From Cloud Shell, or any machine with `gcloud` authenticated:

```bash
git clone https://github.com/chaithanin/Acc.git
cd Acc
git checkout claude/global-top-financial-dashboard-2jrq6e

# 1. Reserve the address and print the DNS record to create.
./deploy/deploy.sh --reserve-ip

# 2. Add that A record at your DNS provider, then:
./deploy/deploy.sh
```

Two steps rather than one because DNS has to exist before a certificate can be
issued. Running `deploy.sh` straight away also works — it reserves the address,
tells you the record to add and carries on — but the certificate will not be
issued until the record resolves.

### DNS as it stands

`chaithanin.com` and `www.chaithanin.com` currently resolve to
`118.139.181.63`, which is a different host. **`acc.chaithanin.com` has no
record yet**, so it needs to be created. The main site is untouched by any of
this: only the new `acc` subdomain is involved.

The address is a *reserved static IP*, not an ephemeral one. An ephemeral
address changes whenever the VM is stopped and started, which would silently
break both DNS and TLS. Reserved addresses are free while attached to a running
instance.

---

## Choosing the database — the economical option

The brief was to keep the database cheap. These are the real choices:

| Option | Monthly cost | Code change | Verdict |
|---|---|---|---|
| **VM + SQLite on a persistent disk** | **disk only (~$2 for 20 GB); VM free in a US free-tier region, ~$7 in Singapore** | none | **chosen** |
| Cloud Run + Cloud SQL PostgreSQL | Cloud Run ≈ $0 at this traffic, but Cloud SQL has **no free tier** — the smallest shared-core instance is roughly $10–15 before storage | substantial — see below | rejected on cost |
| Cloud Run + SQLite on a mounted bucket | ~$1 | none | **unsafe — never do this** |
| Firestore | generous free tier | total rewrite | wrong shape for a relational ledger |

Prices move; check the pricing calculator before committing. The ordering is
what matters, and it is stable: **Cloud SQL is the expensive part**, not the
compute.

**Why not Cloud Run.** Cloud Run is stateless, so SQLite on it would lose every
import on each cold start. Making Cloud Run viable means PostgreSQL, and that
is where the cost lands. It is also not a small change: every repository in
`src/lib/db/repositories/` is synchronous today, because `better-sqlite3` is a
synchronous driver. A PostgreSQL driver is asynchronous, so the conversion
reaches every repository, every page and every route. `docs/DATABASE.md`
describes the path — the schema was written for it — but it is a real piece of
work, not a config flag. It is worth doing when concurrent editors or
horizontal scaling justify it; neither applies to a finance team of this size.

**Why not SQLite on Cloud Storage or Filestore.** SQLite's locking assumes a
local filesystem. Over a network mount, concurrent writes corrupt the database.
For an accounting system that is not a risk worth taking at any price.

**What the chosen option gives up.** One VM means no autoscaling and manual OS
patching, and SQLite means one writer at a time. For a handful of finance users
importing a workbook once a month, neither is a real constraint. The data disk
is separate from the boot disk, so the VM can be rebuilt or resized without
touching the database.

---

## Region: cost against data residency

The Always Free tier covers one `e2-micro` **only** in `us-west1`,
`us-central1` or `us-east1`. Singapore (`asia-southeast1`) costs roughly $7 a
month for the same machine.

The default here is **`asia-southeast1`**, not the free US region, because the
data is Thai company financial records. Keeping it in Singapore is far better
for latency and for a defensible answer under the Thai PDPA on where financial
records are held.

If saving that $7 matters more than residency:

```bash
export GTG_REGION=us-central1 GTG_ZONE=us-central1-a
```

That is a business decision about where financial records live, so it is left
explicit rather than defaulted to the cheaper answer.

---

## HTTPS is not optional here

The application authenticates with a session cookie and serves financial data,
so it is never exposed over plain HTTP. The VM runs Caddy in front of the app,
which obtains and renews a Let's Encrypt certificate automatically.

A managed load balancer would also work and would cost about $18 a month —
more than the rest of the deployment put together.

The hostname defaults to `acc.chaithanin.com`; override it with `GTG_DOMAIN`.
This is also why the deployment reserves its IP first: the DNS record can then be
created and allowed to propagate before anything depends on it.

If Caddy has already failed an attempt it backs off, so after adding the record
force an immediate retry rather than waiting:

```bash
gcloud compute ssh gtg-financial --zone=asia-southeast1-a \
  --command 'sudo docker compose --project-name gtg -f /opt/gtg/docker-compose.yml restart caddy'
```

---

## What gets created

| Resource | Purpose |
|---|---|
| Static IP `gtg-financial-ip` | the address `acc.chaithanin.com` points at; survives a stop/start |
| Artifact Registry repo `gtg` | holds the container image |
| Cloud Build job | builds the image — an e2-micro cannot run `next build` in 1 GB |
| Persistent disk `gtg-financial-data` (20 GB) | the database and every uploaded original, at `/mnt/data` |
| VM `gtg-financial` (`e2-micro`, Debian 12) | runs the app and Caddy under Docker |
| Firewall rule `gtg-allow-web` | 80 for the ACME challenge, 443 for the app |
| Firewall rule `gtg-allow-iap-ssh` | port 22 from the IAP range only — not from the internet |

The VM's first boot also creates a 2 GB swap file. An e2-micro has 1 GB of RAM,
and a large workbook parse would otherwise risk being OOM-killed. For the same
reason the container caps the parser at a 320 MB heap
(`GTG_PARSE_MAX_HEAP_MB`) rather than the 1 GB default.

---

## First sign-in

The first start creates an administrator account and prints the password to the
container log **once**:

```bash
gcloud compute ssh gtg-financial --zone=asia-southeast1-a \
  --command 'sudo docker logs gtg-app-1 | head -40'
```

Set your own instead by exporting `GTG_ADMIN_EMAIL` and `GTG_ADMIN_PASSWORD`
before deploying. Change it after first sign-in either way.

---

## Updating

```bash
./deploy/deploy.sh --update
```

Rebuilds the image and restarts the container. The data disk is untouched, so
imports, snapshots and history all survive. Re-running the full script is also
safe — every step checks for what it creates.

---

## Backups

Not automated, deliberately — a backup schedule is a decision about retention,
not a default worth guessing. The straightforward option:

```bash
gcloud compute disks snapshot gtg-financial-data \
  --zone=asia-southeast1-a --snapshot-names=gtg-$(date +%Y%m%d)
```

Attach a resource policy to take that daily. SQLite in WAL mode is crash-safe,
so a disk snapshot is a consistent restore point; for a belt-and-braces copy,
`sqlite3 /mnt/data/gtg-financial.db ".backup /tmp/backup.db"` produces a clean
file while the app is running.

---

## Verified, and not

The container definition, the build configuration and both scripts are written
and syntax-checked. The runtime layer was then reproduced locally — the exact
set of files the Dockerfile copies into the runtime stage — and booted:
`/api/health` returns ok, the sign-in page renders, and the parsing worker
reads one of the real GL workbooks end to end.

That rehearsal caught three defects that would each have surfaced only after a
deploy:

* the Dockerfile copied `bindings` and `file-uri-to-path`, which
  `better-sqlite3` v13 does not use and which are not installed — the image
  build would have failed outright;
* `xlsx` was absent from the image. The parser runs in a plain `.mjs` worker
  outside Next's build graph, so tracing never saw it and every workbook
  import would have failed at runtime while the rest of the app looked fine;
* `xlsx` pulls eight transitive packages that had to come with it.

The image now self-checks at build time: it loads `xlsx`, opens a SQLite
database through the native binding, and asserts both runtime-read files are
present. A regression fails the build in seconds instead of producing a
crash-looping container.

The deployment itself has **not** been executed: this environment has no
`gcloud`, no Google Cloud credentials and no Docker daemon, so the image has
never been built or run, and nothing has been created in `account-505805`.
Expect to fix small things on the first real run — most likely IAM permissions
on the Cloud Build service account, or the DNS record not having propagated
when Caddy first asks for a certificate. The `--reserve-ip` step exists to make
the second of those unlikely.
