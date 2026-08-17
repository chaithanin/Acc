# Deploying to Google Cloud

Target project: **`gtg-crm-499607`**.

```bash
export GTG_DOMAIN=finance.yourcompany.com   # DNS A record → the VM's IP
./deploy/deploy.sh
```

That is the whole deployment. What it does and why is below.

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

This is why `deploy.sh` refuses to run without `GTG_DOMAIN`. A managed load
balancer would also work and would cost about $18 a month — more than the rest
of the deployment put together.

If the domain does not exist yet: run the deploy once to create the VM (it will
stop at the domain check — create the VM first with `GTG_DOMAIN` set to the
eventual name), point DNS at the printed IP, then re-run.

---

## What gets created

| Resource | Purpose |
|---|---|
| Artifact Registry repo `gtg` | holds the container image |
| Cloud Build job | builds the image — an e2-micro cannot run `next build` in 1 GB |
| Persistent disk `gtg-financial-data` (20 GB) | the database and every uploaded original, at `/mnt/data` |
| VM `gtg-financial` (`e2-micro`, Debian 12) | runs the app and Caddy under Docker |
| Firewall rule `gtg-allow-web` | 80 for the ACME challenge, 443 for the app |

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
and syntax-checked, and the production build has been verified to produce a
working standalone bundle with `schema.sql` and the parsing worker in place.

The deployment itself has **not** been executed: this environment has no
`gcloud`, no Google Cloud credentials and no Docker daemon, so the image has
never been built or run, and nothing has been created in `gtg-crm-499607`.
Expect to fix small things on the first real run — most likely IAM permissions
on the Cloud Build service account, or the DNS record not having propagated
when Caddy first asks for a certificate.
