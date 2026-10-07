#!/usr/bin/env bash
#
# Install the scheduled pull on the VM, and leave it switched off.
#
# Deliberately does not enable anything. The pull signs in to Mango, Mango
# allows one session per account, and a schedule started before there is a
# service account would sign an employee out of Mango every morning. So this
# puts everything in place and prints what remains.
set -euo pipefail

REPO=${GTG_PULL_REPO:-/opt/gtg/Acc}
SECRETS=/opt/gtg/pull-secrets.env

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: this installs systemd units."; exit 1; }
[ -d "$REPO" ] || { echo "No repository at $REPO. Clone it there first, or set GTG_PULL_REPO."; exit 1; }

install -m 0644 "$REPO/deploy/gtg-pull.service" /etc/systemd/system/gtg-pull.service
install -m 0644 "$REPO/deploy/gtg-pull.timer" /etc/systemd/system/gtg-pull.timer

if [ -e "$SECRETS" ]; then
  echo "Left $SECRETS alone — it already exists, and it holds the only copy of the credentials."
else
  install -m 0600 "$REPO/deploy/pull-secrets.env.example" "$SECRETS"
  echo "Wrote $SECRETS from the example, mode 600. Fill it in."
fi

install -d -m 0755 /var/log/gtg-pull

systemctl daemon-reload

cat <<'NEXT'

Installed, and switched off. Three things in order:

  1. A service account for Mango, not an employee's login. Mango allows one
     session per account, so a schedule under somebody's name signs them out
     every morning. This is the one that has to come first.

  2. Fill in /opt/gtg/pull-secrets.env, and in it set
       MANGO_IS_SERVICE_ACCOUNT=yes   once (1) is true
       GTG_PULL_ENABLED=1             to let a run do any work

  3. Then start the timer:
       sudo systemctl enable --now gtg-pull.timer
       systemctl list-timers gtg-pull.timer

Try it by hand first — it is safe, and says what it would do:

    sudo /opt/gtg/Acc/deploy/pull-all.sh

Logs: /var/log/gtg-pull/, kept for thirty days.
NEXT
