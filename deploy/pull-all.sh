#!/usr/bin/env bash
#
# Pull every source Mango and Booking will give us, once.
#
# Called by gtg-pull.timer. Safe to run by hand; safe to run twice.
#
# Three gates stand in front of the work, and all three exist because of
# something that has already gone wrong or would:
#
#   GTG_PULL_ENABLED       the switch. Absent, this does nothing and says so,
#                          so an accidentally-enabled timer is harmless.
#
#   MANGO_IS_SERVICE_ACCOUNT
#                          Mango allows one session per account — it serves an
#                          API/Public/KickUserOnline endpoint, and a sign-in
#                          from here turns another off. Pulling every morning
#                          as a person would sign that person out of Mango,
#                          daily, with no explanation on either side. This
#                          refuses to run until somebody writes down that the
#                          account is not a person's.
#
#   a lock                 two runs overlapping would do the same thing to each
#                          other, for the same reason.
#
set -uo pipefail

REPO=${GTG_PULL_REPO:-/opt/gtg/Acc}
SECRETS=${GTG_PULL_SECRETS:-/opt/gtg/pull-secrets.env}
LOG_DIR=${GTG_PULL_LOG_DIR:-/var/log/gtg-pull}
LOCK=/var/lock/gtg-pull.lock

mkdir -p "$LOG_DIR"
STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
LOG="$LOG_DIR/$STAMP.log"

log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$LOG"; }
die() { log "$*"; exit 1; }

# ------------------------------------------------------------------- the gates

[ -r "$SECRETS" ] || die "No $SECRETS. Nothing to run with; see docs/SCHEDULED-PULLS.md."

# Read, rather than source into the environment of everything below: a secrets
# file is not a shell script and should not be able to act like one.
set -a
# shellcheck disable=SC1090
. "$SECRETS"
set +a

if [ "${GTG_PULL_ENABLED:-}" != "1" ]; then
  log "GTG_PULL_ENABLED is not 1 in $SECRETS — doing nothing."
  log "That is the off switch, and it is deliberately off until somebody turns it on."
  exit 0
fi

if [ "${MANGO_IS_SERVICE_ACCOUNT:-}" != "yes" ]; then
  die "MANGO_IS_SERVICE_ACCOUNT is not yes in $SECRETS.

  Mango allows one session per account. Pulling every morning as a person would
  sign that person out of Mango daily, and their session would sign this one out
  in turn — intermittently, and with nothing on either side saying why.

  Set it once the account is a service account of its own. It is an
  acknowledgement, not a setting: nothing checks it but you."
fi

cd "$REPO" || die "No repository at $REPO."

# One at a time. Two runs would turn each other's Mango session off.
exec 9>"$LOCK" || die "Cannot open $LOCK."
flock -n 9 || die "Another pull is already running; leaving it alone."

log "pulling into ${GTG_DATA_DIR:-$REPO/data}"

FAILED=()
ran() { log "── $1"; }

# ------------------------------------------------------- the inexpensive ones

# Plain HTTP, a few megabytes, no browser. These are safe on a small machine.
if [ -n "${MANGO_USER:-}" ] && [ -n "${MANGO_PASS:-}" ]; then
  ran "Mango RE — the sales ledger"
  if npm run --silent mango:pull -- "${MANGO_PULL_ARGS:---dry-run}" >>"$LOG" 2>&1; then
    log "   ok"
  else
    log "   failed; see $LOG"
    FAILED+=("mango:pull")
  fi
else
  log "── Mango RE skipped: MANGO_USER / MANGO_PASS not set"
fi

if [ -n "${BOOKING_API_KEY:-}" ]; then
  ran "Booking — the unit inventory"
  if npm run --silent booking:pull -- "${BOOKING_PULL_ARGS:---dry-run}" >>"$LOG" 2>&1; then
    log "   ok"
  else
    log "   failed; see $LOG"
    FAILED+=("booking:pull")
  fi
else
  log "── Booking skipped: BOOKING_API_KEY not set"
fi

# ------------------------------------------------------------ the costly one

# The accounting pull drives a browser, and a browser wants about half a
# gigabyte. This VM is an e2-micro with one gigabyte total, already running the
# application with a 320 MB heap — so rather than discover that at six in the
# morning as an OOM kill, the memory is measured first and the pull is skipped
# with a reason.
AVAILABLE_MB=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
NEEDED_MB=${GTG_PULL_BROWSER_MB:-600}

if [ -z "${ANYWHERE_PULL_ARGS:-}" ]; then
  log "── Mango Anywhere skipped: ANYWHERE_PULL_ARGS not set"
elif [ "$AVAILABLE_MB" -lt "$NEEDED_MB" ]; then
  log "── Mango Anywhere skipped: ${AVAILABLE_MB} MB available, it needs about ${NEEDED_MB} MB"
  log "   A browser does not fit beside the application on this machine. Run it"
  log "   from somewhere with more memory, or raise GTG_PULL_BROWSER_MB if this"
  log "   machine has grown."
  FAILED+=("anywhere:pull (no memory)")
else
  ran "Mango Anywhere — balances and bank"
  # shellcheck disable=SC2086
  if npm run --silent anywhere:pull -- $ANYWHERE_PULL_ARGS >>"$LOG" 2>&1; then
    log "   ok"
  else
    log "   failed; see $LOG"
    FAILED+=("anywhere:pull")
  fi
fi

# ------------------------------------------------------------------- the tally

# Old logs are deleted here rather than by a second timer somebody has to know
# about. Thirty days is long enough to see a pattern in a morning failure.
find "$LOG_DIR" -name '*.log' -mtime +30 -delete 2>/dev/null || true

if [ ${#FAILED[@]} -eq 0 ]; then
  log "done; everything that was configured ran"
  exit 0
fi

log "done; these did not: ${FAILED[*]}"
# Non-zero so systemd records a failure and `systemctl status` says so, rather
# than a silent morning where nothing arrived and nothing complained.
exit 1
