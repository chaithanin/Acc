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
ADDRESS="${GTG_ADDRESS:-gtg-financial-ip}"
DOMAIN="${GTG_DOMAIN:-acc.chaithanin.com}"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${IMAGE_NAME}:latest"
UPDATE_ONLY=false
IP_ONLY=false
case "${1:-}" in
  --update) UPDATE_ONLY=true ;;
  # Reserves the address and prints it, so the DNS record can be created and
  # allowed to propagate before anything else is built.
  --reserve-ip) IP_ONLY=true ;;
  '') ;;
  *) echo "Usage: $0 [--reserve-ip | --update]" >&2; exit 1 ;;
esac

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

if [[ -z "$DOMAIN" ]]; then
  echo "GTG_DOMAIN is empty. This app is only served over HTTPS, so it needs a domain." >&2
  exit 1
fi

gcloud config set project "$PROJECT" >/dev/null

if [[ "$IP_ONLY" == true ]]; then
  gcloud services enable compute.googleapis.com --quiet
  gcloud compute addresses describe "$ADDRESS" --region="$REGION" >/dev/null 2>&1 || \
    gcloud compute addresses create "$ADDRESS" --region="$REGION" --quiet

  RESERVED_IP=$(gcloud compute addresses describe "$ADDRESS" --region="$REGION" --format='get(address)')
  cat <<MSG

Reserved ${RESERVED_IP} in ${REGION}.

Create this DNS record, then run ./deploy/deploy.sh:

    ${DOMAIN}.   A   ${RESERVED_IP}

MSG
  exit 0
fi

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
  say "Reserving a static external IP"
  # Reserved before the VM so the DNS record can be created up front, and so
  # the address survives a stop/start — an ephemeral IP would change and
  # silently break both DNS and the certificate.
  gcloud compute addresses describe "$ADDRESS" --region="$REGION" >/dev/null 2>&1 || \
    gcloud compute addresses create "$ADDRESS" --region="$REGION" --quiet

  RESERVED_IP=$(gcloud compute addresses describe "$ADDRESS" --region="$REGION" --format='get(address)')

  # Point DNS at the address now: the certificate is issued on first request,
  # so a record that already resolves means TLS works immediately.
  CURRENT_DNS=$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)
  if [[ "$CURRENT_DNS" != "$RESERVED_IP" ]]; then
    cat <<MSG

$(printf '\033[1mDNS is not pointing at this deployment yet.\033[0m')

  Create or update this record with your DNS provider:

      ${DOMAIN}.   A   ${RESERVED_IP}

  Currently resolving to: ${CURRENT_DNS:-(no record)}

  The deployment continues regardless — the certificate is requested on the
  first HTTPS request, so add the record and it will be issued then. If Caddy
  has already backed off after a failed attempt, force an immediate retry with:

      gcloud compute ssh ${VM} --zone=${ZONE} \\
        --command 'sudo docker compose --project-name gtg -f /opt/gtg/docker-compose.yml restart caddy'

MSG
  fi

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
      --address="$ADDRESS" \
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
DNS_NOW=$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)

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
  External IP ${IP} (static)
  Data disk   ${DISK} (${DISK_GB} GB), mounted at /mnt/data
  DNS         ${DOMAIN} -> ${DNS_NOW:-(no record yet)}$( [[ "$DNS_NOW" == "$IP" ]] && echo '  [ok]' || echo "  [needs an A record pointing at ${IP}]" )

Caddy issues the certificate on the first HTTPS request, which takes a moment.

The first start creates an administrator account and prints the password to
the container log exactly once:

  gcloud compute ssh ${VM} --zone=${ZONE} --command 'sudo docker logs gtg-app-1 | head -40'

If HTTPS does not come up, the cause is almost always DNS. Check what Caddy
is doing:

  gcloud compute ssh ${VM} --zone=${ZONE} --command 'sudo docker logs gtg-caddy-1 --tail 40'

To update the application later:

  ./deploy/deploy.sh --update
MSG
