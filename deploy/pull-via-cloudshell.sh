#!/usr/bin/env bash
#
# Pull from Mango on Cloud Shell, and land the result in the VM's database.
#
# Why it goes round. The pull needs Chromium and about 600 MB, and the VM is an
# e2-micro running the app; the repository is private, so the VM cannot clone
# it. Cloud Shell already runs the pull (it has been run there, and works). What
# was missing is that it wrote to Cloud Shell's own ./data, so the dashboard on
# the VM never saw any of it. This takes the VM's database to Cloud Shell, runs
# the pull against that copy, and puts it back.
#
#   ./deploy/pull-via-cloudshell.sh --all-companies --dry-run
#       Reads Mango and writes nothing, here or there. Lists the companies the
#       account can open. Run it first, and work out the --map from it.
#
#   ./deploy/pull-via-cloudshell.sh --all-companies --map MG1=CHTN,MG2=HAMONIA
#       Stops the app, takes a copy of the database, pulls, puts it back, starts
#       the app and runs the audit. The app is down for the length of the pull:
#       a sign-in per company, so several minutes for all six.
#
# Everything after the script name goes to `npm run anywhere:pull`.
#
# What keeps this from losing anything:
#   * the app is stopped first, so nothing can write to the database while it
#     is away and come back to find its work overwritten;
#   * its write-ahead log is folded into the database file before anything is
#     copied, since the app leaves writes there when it is stopped;
#   * a copy of the database is kept ON THE VM before anything is replaced, and
#     the command that puts it back is printed;
#   * if anything fails before the replacement, the VM's database is never
#     touched; if anything fails at all, the app is started again on the way out;
#   * nothing is uploaded unless the pull wrote something (it skips a pull
#     identical to an earlier one, and then the app is simply started again).
#
# Run it right after a deploy of the same commit, so the schema the pull writes
# is the one the app expects.
set -euo pipefail

VM=${GTG_VM:-gtg-financial}
ZONE=${GTG_ZONE:-asia-southeast1-a}
APP=${GTG_APP_CONTAINER:-gtg-app-1}
VM_DATA=${GTG_VM_DATA:-/mnt/data}
HERE=$(cd "$(dirname "$0")/.." && pwd)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

# Outside the repository, and private: it holds a copy of the live database.
WORK=${GTG_PULL_WORK:-$HOME/.gtg-pull}
DB=gtg-financial.db

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die()  { printf '\n%s\n\n' "$*" >&2; exit 1; }
vm()   { gcloud compute ssh "$VM" --zone="$ZONE" --quiet --command "$1"; }

[ "$#" -gt 0 ] || die "Say what to pull. Start with:
  $0 --all-companies --dry-run"

DRY=false
for arg in "$@"; do [ "$arg" = "--dry-run" ] && DRY=true; done

command -v npm >/dev/null || die "npm is not installed here."
[ -f "$HERE/package.json" ] || die "Run this from the repository."

# ----------------------------------------------------------------- credentials
: "${MANGO_BASE_URL:=https://chaithanin.mangoanywhere.com}"
export MANGO_BASE_URL
if [ -z "${MANGO_USER:-}" ]; then read -r -p 'Mango username: ' MANGO_USER; fi
if [ -z "${MANGO_PASS:-}" ]; then read -r -s -p 'Mango password: ' MANGO_PASS; echo; fi
export MANGO_USER MANGO_PASS

# ---------------------------------------------------------------- read-only run
if [ "$DRY" = true ]; then
  say "Reading Mango. Nothing is written, here or on the VM."
  cd "$HERE"
  GTG_DATA_DIR=$(mktemp -d) npm run anywhere:pull -- "$@"
  exit $?
fi

# -------------------------------------------------------------------- the real run
gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q . \
  || die "gcloud has no active account. Run this on Cloud Shell, or gcloud auth login."

cat <<PLAN

This will:
  1. stop the app on $VM  (it is down until the end: a sign-in per company, so several minutes for six)
  2. copy $VM_DATA/$DB on the VM to $DB.before-pull-$STAMP beside it
  3. take a copy of the database here, and pull from Mango into THAT copy
  4. put it back on the VM, and start the app
  5. run the audit

Commit here: $(cd "$HERE" && git rev-parse --short HEAD 2>/dev/null || echo unknown). It should be the one that is deployed.
PLAN
read -r -p 'Type "yes" to go ahead: ' ANSWER
[ "$ANSWER" = "yes" ] || die "Not going ahead. Nothing was changed."

APP_STOPPED=false
restart() {
  if [ "$APP_STOPPED" = true ]; then
    printf '\nStarting the app again.\n' >&2
    vm "sudo docker start $APP" >/dev/null || printf 'COULD NOT START THE APP. On the VM: sudo docker start %s\n' "$APP" >&2
  fi
}
cleanup() { rm -rf "$WORK"; restart; }
trap cleanup EXIT

umask 077
rm -rf "$WORK"; mkdir -p "$WORK"

say "Stopping the app, so the database is quiet"
vm "sudo docker stop $APP" >/dev/null
APP_STOPPED=true

# The app does not close its database when it is stopped, so what it last wrote
# can still be in the write-ahead log (the -wal file) and not in the database
# file proper. Copying only the .db file would then drop those writes, and the
# upload would put the loss on the VM. So fold the log into the file first, with
# the app stopped (nothing else has it open), from a throwaway container of the
# same image, which is where better-sqlite3 is.
CHECKPOINT_JS="const D=require(\"better-sqlite3\");const db=new D(\"/data/$DB\");const r=db.pragma(\"wal_checkpoint(TRUNCATE)\");db.close();console.log(\"checkpoint: \"+JSON.stringify(r));process.exit(r[0].busy?3:0)"

say "Folding the write-ahead log into the database"
vm "set -e
  IMAGE=\$(sudo docker inspect -f '{{.Config.Image}}' $APP)
  sudo docker run --rm --entrypoint node -v $VM_DATA:/data \$IMAGE -e '$CHECKPOINT_JS'" \
  || die "Could not fold the log into the database. The VM's database was not touched; the app is being started again."

say "Checking it shut down cleanly, and keeping a copy on the VM"
vm "set -e
  if [ -s $VM_DATA/$DB-wal ]; then echo 'UNCLEAN: $DB-wal is not empty; the app did not close the database.' >&2; exit 3; fi
  [ -f $VM_DATA/$DB ] || { echo 'No database at $VM_DATA/$DB' >&2; exit 4; }
  sudo cp -p $VM_DATA/$DB $VM_DATA/$DB.before-pull-$STAMP
  sudo cp $VM_DATA/$DB /tmp/gtg-pull-$STAMP.db && sudo chmod 644 /tmp/gtg-pull-$STAMP.db
  ls -l $VM_DATA/$DB.before-pull-$STAMP" \
  || die "Could not take a safe copy. The VM's database was not touched; the app is being started again."

say "Taking the database here"
gcloud compute scp --zone="$ZONE" --quiet "$VM:/tmp/gtg-pull-$STAMP.db" "$WORK/$DB"
vm "sudo rm -f /tmp/gtg-pull-$STAMP.db" >/dev/null

# What the database HOLDS, not its bytes: merely opening a SQLite file in WAL
# mode rewrites its header, so a hash says "changed" after a pull that wrote
# nothing. Every company a pull writes adds an import and a snapshot.
fingerprint() {
  GTG_FP_DB="$1" node -e '
    const D = require("better-sqlite3");
    const db = new D(process.env.GTG_FP_DB, { readonly: true });
    const n = (t) => db.prepare("SELECT COUNT(*) c FROM " + t).get().c;
    console.log([n("imports"), n("financial_snapshots")].join("/"));'
}
BEFORE=$(cd "$HERE" && fingerprint "$WORK/$DB") || die "Could not read the copy of the database here. The VM's database was not touched; the app is being started again."

say "Pulling from Mango into the copy"
cd "$HERE"
GTG_DATA_DIR="$WORK" npm run anywhere:pull -- "$@" \
  || die "The pull failed. The VM's database was not touched; the app is being started again."

AFTER=$(cd "$HERE" && fingerprint "$WORK/$DB") || die "Could not read the database after the pull. The VM's database was not touched; the app is being started again."
if [ "$BEFORE" = "$AFTER" ]; then
  say "The pull wrote nothing (identical to a previous one, or nothing was mapped). The VM's database is as it was."
  exit 0
fi

say "Putting it back on the VM"
gcloud compute scp --zone="$ZONE" --quiet "$WORK/$DB" "$VM:/tmp/gtg-pull-$STAMP.new"
vm "set -e
  sudo install -o 1000 -g 1000 -m 0644 /tmp/gtg-pull-$STAMP.new $VM_DATA/$DB
  sudo rm -f /tmp/gtg-pull-$STAMP.new $VM_DATA/$DB-wal $VM_DATA/$DB-shm"

say "Starting the app"
vm "sudo docker start $APP" >/dev/null
APP_STOPPED=false
for _ in $(seq 1 24); do
  state=$(vm "sudo docker inspect -f '{{.State.Health.Status}}' $APP" 2>/dev/null || true)
  [ "$state" = "healthy" ] && break
  sleep 5
done
[ "${state:-}" = "healthy" ] || printf '\nThe app is not reporting healthy yet: sudo docker logs %s --tail 30\n' "$APP" >&2

say "What the database holds now"
vm "sudo docker exec $APP node scripts/audit-pulls.mjs" || true

cat <<DONE

Done. A copy of the database from before is on the VM:
  $VM_DATA/$DB.before-pull-$STAMP

To put it back (stops the app first):
  gcloud compute ssh $VM --zone=$ZONE --command 'sudo docker stop $APP && sudo install -o 1000 -g 1000 -m 0644 $VM_DATA/$DB.before-pull-$STAMP $VM_DATA/$DB && sudo rm -f $VM_DATA/$DB-wal $VM_DATA/$DB-shm && sudo docker start $APP'
DONE
