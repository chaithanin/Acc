#!/usr/bin/env bash
#
# Runs once when the VM is created: installs Docker, prepares the data disk
# and drops a small runner the deploy script calls on each release.

set -euo pipefail

DEVICE=/dev/disk/by-id/google-gtgdata
MOUNT=/mnt/data

# ------------------------------------------------------------------- packages
if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl gnupg

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
fi

# ------------------------------------------------------------------ data disk
# Formatted only if blank, so re-running never destroys the database.
if ! blkid "$DEVICE" >/dev/null 2>&1; then
  mkfs.ext4 -m 0 -E lazy_itable_init=0,lazy_journal_init=0,discard "$DEVICE"
fi

mkdir -p "$MOUNT"
grep -q "$MOUNT" /etc/fstab || \
  echo "$DEVICE $MOUNT ext4 discard,defaults,nofail 0 2" >> /etc/fstab
mount -a

mkdir -p "$MOUNT/caddy/data" "$MOUNT/caddy/config"

# ----------------------------------------------------------------------- swap
# An e2-micro has 1 GB of RAM. Swap keeps a large workbook parse from being
# OOM-killed; it is slow to touch but far better than losing the request.
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Prefer reclaiming cache over swapping; swap is the safety net, not the plan.
  sysctl -w vm.swappiness=10
  grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi

# --------------------------------------------------------------------- runner
mkdir -p /opt/gtg

cat > /opt/gtg/run.sh <<'RUNNER'
#!/usr/bin/env bash
# Pulls the current image and restarts the stack. Called by deploy.sh.
set -euo pipefail

: "${GTG_IMAGE:?GTG_IMAGE must be set}"
: "${GTG_DOMAIN:?GTG_DOMAIN must be set}"

cd /opt/gtg

gcloud auth configure-docker "$(echo "$GTG_IMAGE" | cut -d/ -f1)" --quiet
docker pull "$GTG_IMAGE"

cat > /opt/gtg/.env <<ENV
GTG_IMAGE=${GTG_IMAGE}
GTG_DOMAIN=${GTG_DOMAIN}
ENV

docker compose --project-name gtg up -d --remove-orphans

# Untagged layers from previous releases would otherwise fill a 20 GB disk.
docker image prune -f
RUNNER

chmod +x /opt/gtg/run.sh
