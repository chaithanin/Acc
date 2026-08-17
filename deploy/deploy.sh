#!/usr/bin/env bash
#
# Deploys the Financial Management Dashboard to a single Compute Engine VM
# with the database on a persistent disk.
#
# Re-running is safe: every step checks for what it creates, so this doubles
# as the update path. Updating just the app is `--update` (skips VM creation).
#
#   ./deploy/deploy.sh
#   ./deploy/deploy.sh --update      # rebuild image + restart, keep the VM
#
# Requires: gcloud, authenticated, with billing enabled on the project.

set -euo pipefail

PROJECT="${GTG_PROJECT:-gtg-crm-499607}"
REGION="${GTG_REGION:-asia-southeast1}"
ZONE="${GTG_ZONE:-${REGION}-a}"
VM="${GTG_VM:-gtg-financial}"
DISK="${GTG_DISK:-gtg-financial-data}"
DISK_GB="${GTG_DISK_GB:-20}"
REPO="${GTG_REPO:-gtg}"
IMAGE_NAME="${GTG_IMAGE_NAME:-financial-dashboard}"
MACHINE="${GTG_MACHINE:-e2-micro}"
DOMAIN="${GTG_DOMAIN:-}"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${IMAGE_NAME}:latest"
UPDATE_ONLY=false
[[ "${1:-}" == "--update" ]] && UPDATE_ONLY=true

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

if [[ -z "$DOMAIN" ]]; then
  cat >&2 <<'MSG'
GTG_DOMAIN is not set.

This application handles passwords and financial data, so it is only deployed
behind HTTPS. Caddy will obtain a certificate automatically, but it needs a
domain name whose DNS A record points at this VM.

  export GTG_DOMAIN=finance.yourcompany.com
  ./deploy/deploy.sh

If the domain does not exist yet, create the VM first, note its external IP,
point the DNS record at it, then re-run with GTG_DOMAIN set.
MSG
  exit 1
fi

gcloud config set project "$PROJECT" >/dev/null

say "Enabling the APIs this deployment uses"
gcloud services enable \
  compute.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --quiet

say "Ensuring the Artifact Registry repository exists"
gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Global Top Group financial dashboard" \
    --quiet

say "Building the image with Cloud Build"
# Built remotely: an e2-micro cannot complete `next build` in 1 GB of RAM.
gcloud builds submit \
  --config deploy/cloudbuild.yaml \
  --substitutions="_REGION=${REGION},_REPO=${REPO},_IMAGE=${IMAGE_NAME}" \
  --quiet

if [[ "$UPDATE_ONLY" == false ]]; then
  say "Ensuring the data disk exists"
  # A separate disk from the boot disk, so the VM can be rebuilt or resized
  # without touching the database or the uploaded originals.
  gcloud compute disks describe "$DISK" --zone="$ZONE" >/dev/null 2>&1 || \
    gcloud compute disks create "$DISK" \
      --size="${DISK_GB}GB" \
      --type=pd-balanced \
      --zone="$ZONE" \
      --quiet

  say "Ensuring the firewall allows HTTP and HTTPS"
  gcloud compute firewall-rules describe gtg-allow-web >/dev/null 2>&1 || \
    gcloud compute firewall-rules create gtg-allow-web \
      --allow=tcp:80,tcp:443 \
      --target-tags=gtg-web \
      --description="HTTP for the ACME challenge, HTTPS for the app" \
      --quiet

  if ! gcloud compute instances describe "$VM" --zone="$ZONE" >/dev/null 2>&1; then
    say "Creating the VM"
    gcloud compute instances create "$VM" \
      --zone="$ZONE" \
      --machine-type="$MACHINE" \
      --image-family=debian-12 \
      --image-project=debian-cloud \
      --boot-disk-size=20GB \
      --boot-disk-type=pd-balanced \
      --disk="name=${DISK},device-name=gtgdata,mode=rw,auto-delete=no" \
      --tags=gtg-web \
      --scopes=https://www.googleapis.com/auth/cloud-platform \
      --metadata-from-file=startup-script=deploy/startup-script.sh \
      --quiet
  else
    say "VM already exists — leaving it in place"
  fi
fi

IP=$(gcloud compute instances describe "$VM" --zone="$ZONE" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

say "Waiting for the VM to finish its first-boot setup"
# The startup script installs Docker and formats the data disk; on a fresh VM
# that takes a minute or two and the runner does not exist until it finishes.
for attempt in $(seq 1 30); do
  if gcloud compute ssh "$VM" --zone="$ZONE" --tunnel-through-iap --quiet \
       --command 'test -x /opt/gtg/run.sh' 2>/dev/null; then
    break
  fi
  if [[ $attempt -eq 30 ]]; then
    echo "The VM did not finish its setup in time. Check the serial console:" >&2
    echo "  gcloud compute instances get-serial-port-output $VM --zone=$ZONE" >&2
    exit 1
  fi
  sleep 10
done

say "Copying the stack definition to the VM"
gcloud compute scp deploy/docker-compose.yml "${VM}:/tmp/docker-compose.yml" \
  --zone="$ZONE" --tunnel-through-iap --quiet
gcloud compute scp deploy/Caddyfile "${VM}:/tmp/Caddyfile" \
  --zone="$ZONE" --tunnel-through-iap --quiet

say "Deploying the application"
gcloud compute ssh "$VM" --zone="$ZONE" --tunnel-through-iap --quiet --command "
  set -e
  sudo install -D -m 0644 /tmp/docker-compose.yml /opt/gtg/docker-compose.yml
  sudo install -D -m 0644 /tmp/Caddyfile /mnt/data/caddy/Caddyfile
  sudo GTG_IMAGE='${IMAGE}' GTG_DOMAIN='${DOMAIN}' /opt/gtg/run.sh
"

cat <<MSG

$(printf '\033[1mDeployed.\033[0m')

  URL         https://${DOMAIN}
  VM          ${VM} (${MACHINE}) in ${ZONE}
  External IP ${IP}
  Data disk   ${DISK} (${DISK_GB} GB), mounted at /mnt/data

Point the DNS A record for ${DOMAIN} at ${IP} if it is not already.
Caddy issues the certificate on first request, which can take a minute.

The first start creates an administrator account and prints the password to
the container log exactly once:

  gcloud compute ssh ${VM} --zone=${ZONE} --command 'sudo docker logs gtg-app-1 | head -40'

To update the application later:

  ./deploy/deploy.sh --update
MSG
