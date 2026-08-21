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

PROJECT="${GTG_PROJECT:-account-505805}"
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
# Cloud Build is the default because it needs nothing installed locally. On a
# project where the caller lacks Cloud Build permission, --local-build does the
# same work with the Docker daemon that Cloud Shell already provides.
BUILD_MODE="${GTG_BUILD:-cloudbuild}"

for arg in "$@"; do
  case "$arg" in
    --update) UPDATE_ONLY=true ;;
    # Reserves the address and prints it, so the DNS record can be created and
    # allowed to propagate before anything else is built.
    --reserve-ip) IP_ONLY=true ;;
    --local-build) BUILD_MODE=local ;;
    # Redeploys the image already in the registry. Useful when only the VM
    # side failed and a rebuild would just cost several minutes.
    --skip-build) BUILD_MODE=skip ;;
    *) echo "Usage: $0 [--reserve-ip] [--update] [--local-build] [--skip-build]" >&2; exit 1 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# Registry uploads from Cloud Shell drop often enough to be worth retrying.
# A half-finished push leaves the old image in place, so failing here without
# retrying means the VM quietly keeps running the previous release.
retry() {
  local attempts=$1 delay=$2; shift 2
  local n=1
  until "$@"; do
    if (( n >= attempts )); then
      echo "Giving up after ${attempts} attempts: $*" >&2
      return 1
    fi
    echo "  attempt ${n} failed; retrying in ${delay}s..." >&2
    sleep "$delay"
    n=$(( n + 1 ))
    delay=$(( delay * 2 ))
  done
}

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

# Enabling APIs and creating the registry are first-deployment steps. On
# --update both are already done, and skipping them keeps the permissions an
# automated deploy needs down to pushing an image and reaching the VM — a CI
# identity has no business being able to turn project-wide services on.
if [[ "$UPDATE_ONLY" == false ]]; then
  say "Enabling the APIs this deployment uses"
  gcloud services enable \
    compute.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com \
    iap.googleapis.com \
    --quiet

  say "Ensuring the Artifact Registry repository exists"
  gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1 || \
    gcloud artifacts repositories create "$REPO" \
      --repository-format=docker \
      --location="$REGION" \
      --description="Global Top Group financial dashboard" \
      --quiet
fi

# Built away from the VM either way: an e2-micro cannot complete `next build`
# in 1 GB of RAM.
if [[ "$BUILD_MODE" == "skip" ]]; then
  say "Skipping the build — using the image already in the registry"
elif [[ "$BUILD_MODE" == "local" ]]; then
  say "Building the image locally with Docker"

  if ! docker info >/dev/null 2>&1; then
    echo "No Docker daemon is reachable. Run this from Cloud Shell, or drop --local-build." >&2
    exit 1
  fi

  gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
  docker build -t "$IMAGE" .
  retry 4 5 docker push "$IMAGE"
else
  say "Building the image with Cloud Build"
  if ! gcloud builds submit \
      --config deploy/cloudbuild.yaml \
      --substitutions="_REGION=${REGION},_REPO=${REPO},_IMAGE=${IMAGE_NAME}" \
      --quiet; then
    cat >&2 <<'MSG'

Cloud Build refused the submission. That is almost always the caller's IAM
rather than anything about this project's setup. Check which roles you hold:

  gcloud projects get-iam-policy "$(gcloud config get-value project)" \
    --flatten='bindings[].members' \
    --filter="bindings.members:$(gcloud config get-value account)" \
    --format='table(bindings.role)'

Grant yourself the build role if you are an Owner:

  gcloud projects add-iam-policy-binding "$(gcloud config get-value project)" \
    --member="user:$(gcloud config get-value account)" \
    --role=roles/cloudbuild.builds.editor

Or skip Cloud Build entirely — Cloud Shell has a Docker daemon:

  ./deploy/deploy.sh --local-build

MSG
    exit 1
  fi
fi

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

  say "Ensuring SSH is reachable through IAP"
  # The deploy step reaches the VM with --tunnel-through-iap. That traffic
  # arrives from Google's IAP range, so it needs its own rule rather than
  # relying on the default VPC's allow-ssh-from-anywhere, which may not exist
  # and should not be depended on in any case.
  gcloud compute firewall-rules describe gtg-allow-iap-ssh >/dev/null 2>&1 || \
    gcloud compute firewall-rules create gtg-allow-iap-ssh \
      --allow=tcp:22 \
      --source-ranges=35.235.240.0/20 \
      --target-tags=gtg-web \
      --description="SSH from Identity-Aware Proxy only" \
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

if [[ "$BUILD_MODE" != "skip" ]]; then
  say "Confirming the image reached the registry"
  # A push that failed part-way leaves the previous image in place, and the VM
  # would then pull that instead — succeeding while running the wrong release.
  if ! gcloud artifacts docker images describe "$IMAGE" >/dev/null 2>&1; then
    echo "The image is not in the registry. The push did not complete." >&2
    echo "Re-run the same command; the build is cached, so only the push repeats." >&2
    exit 1
  fi
  echo "  ${IMAGE} is present"
fi

say "Granting the VM permission to pull the image"
# The VM authenticates to Artifact Registry as its own service account, which
# has no access to the repository by default — the cloud-platform scope only
# says which APIs the instance may call, not what its identity is allowed to
# do. Granted on the repository rather than the project, so the VM can read
# this one repository and nothing else.
VM_SA=$(gcloud compute instances describe "$VM" --zone="$ZONE" \
  --format='get(serviceAccounts[0].email)' 2>/dev/null || true)

if [[ -z "$VM_SA" ]]; then
  echo "Could not determine the VM's service account; skipping the grant." >&2
elif ! gcloud artifacts repositories add-iam-policy-binding "$REPO" \
        --location="$REGION" \
        --member="serviceAccount:${VM_SA}" \
        --role=roles/artifactregistry.reader \
        --quiet >/dev/null 2>&1; then
  cat >&2 <<MSG

Could not grant ${VM_SA} read access to the ${REPO} repository. Ask an
administrator to run:

  gcloud artifacts repositories add-iam-policy-binding ${REPO} \\
    --location=${REGION} \\
    --member="serviceAccount:${VM_SA}" \\
    --role=roles/artifactregistry.reader

Without it the VM cannot pull the image and the container will not start.

MSG
else
  note_sa="${VM_SA}"
  echo "  ${note_sa} can now read ${REPO}"
fi

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
# Staged in the login user's own home rather than a fixed name in /tmp. Each
# identity that deploys — a person, and now the CI service account — logs in as
# a different Linux user, and /tmp is sticky: whoever writes a given filename
# there first owns it, and every later identity fails to overwrite it. A path
# under $HOME cannot collide between users at all.
gcloud compute ssh "$VM" --zone="$ZONE" --tunnel-through-iap --quiet \
  --command 'mkdir -p ~/gtg-deploy'

gcloud compute scp deploy/docker-compose.yml deploy/Caddyfile \
  "${VM}:~/gtg-deploy/" --zone="$ZONE" --tunnel-through-iap --quiet

say "Deploying the application"
gcloud compute ssh "$VM" --zone="$ZONE" --tunnel-through-iap --quiet --command "
  set -e
  sudo install -D -m 0644 ~/gtg-deploy/docker-compose.yml /opt/gtg/docker-compose.yml
  sudo install -D -m 0644 ~/gtg-deploy/Caddyfile /mnt/data/caddy/Caddyfile

  # The compose file requires this to exist. Created here as well as in the
  # VM's boot script, because a VM built before that change has an older
  # run.sh and would otherwise fail on the next deploy. Never overwritten: a
  # deploy must not wipe a secret someone set.
  if [ ! -f /opt/gtg/secrets.env ]; then
    sudo install -m 0600 /dev/null /opt/gtg/secrets.env
    echo '# GTG_ADMIN_EMAIL / GTG_ADMIN_PASSWORD — read only while no user exists.' \
      | sudo tee -a /opt/gtg/secrets.env >/dev/null
  fi

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
