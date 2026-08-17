#!/usr/bin/env bash
#
# One-time setup so GitHub Actions can deploy this project.
#
#   ./deploy/setup-cicd.sh
#
# Creates a deployment identity and lets GitHub borrow it through workload
# identity federation, which means no service-account key is ever created,
# downloaded or stored in the repository. A key would be a permanent
# credential to a project holding client financial data, and one that leaks
# stays valid until someone notices; a federated token lasts minutes and only
# works for workflow runs in this one repository.
#
# Re-running is safe: every step checks for what it creates.
#
# Requires: gcloud, authenticated as someone who can manage IAM on the project.

set -euo pipefail

PROJECT="${GTG_PROJECT:-account-505805}"
REGION="${GTG_REGION:-asia-southeast1}"
ZONE="${GTG_ZONE:-${REGION}-a}"
VM="${GTG_VM:-gtg-financial}"
REPO="${GTG_REPO:-gtg}"
GITHUB_REPO="${GTG_GITHUB_REPO:-chaithanin/Acc}"

SA_NAME="${GTG_DEPLOY_SA:-gtg-deployer}"
POOL="${GTG_WIF_POOL:-github}"
PROVIDER="${GTG_WIF_PROVIDER:-github}"

SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

gcloud config set project "$PROJECT" >/dev/null
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='get(projectNumber)')

say "Enabling the APIs federation needs"
gcloud services enable \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  iam.googleapis.com \
  --quiet

say "Creating the deployment service account"
gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="Deploys the financial dashboard from GitHub Actions" \
    --quiet

say "Granting it what a deploy needs, and nothing more"

# Pushing the image, and granting the VM read access to it. Scoped to this one
# repository rather than the project, so the identity cannot touch any other
# artifacts the project may hold later.
gcloud artifacts repositories add-iam-policy-binding "$REPO" \
  --location="$REGION" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role=roles/artifactregistry.admin \
  --quiet >/dev/null

# Reaching the VM to restart the stack. instanceAdmin covers the SSH key that
# gcloud adds to instance metadata on first use.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role=roles/compute.instanceAdmin.v1 \
  --quiet >/dev/null

# The VM's SSH port is open to Identity-Aware Proxy only, so the deploy
# reaches it through a tunnel.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role=roles/iap.tunnelResourceAccessor \
  --quiet >/dev/null

# Connecting to an instance that runs as a service account counts as acting
# as that account, so this is required even though nothing impersonates it
# directly. Granted on the VM's account alone.
VM_SA=$(gcloud compute instances describe "$VM" --zone="$ZONE" \
  --format='get(serviceAccounts[0].email)' 2>/dev/null || true)

if [[ -n "$VM_SA" ]]; then
  gcloud iam service-accounts add-iam-policy-binding "$VM_SA" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role=roles/iam.serviceAccountUser \
    --quiet >/dev/null
  echo "  can act as ${VM_SA}"
else
  echo "  could not read the VM's service account — deploy the VM first, then re-run this" >&2
fi

say "Creating the workload identity pool"
gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "$POOL" \
    --location=global \
    --display-name="GitHub Actions" \
    --quiet

say "Creating the provider that trusts this repository"
# The attribute condition is the security boundary. Without it, any GitHub
# repository in the world could mint a token for this project — the issuer is
# GitHub's, shared by everyone. Pinning the repository means only workflow
# runs in this one are accepted.
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER" \
      --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --location=global \
    --workload-identity-pool="$POOL" \
    --display-name="GitHub" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}'" \
    --quiet
else
  # A provider set up for something else is left alone — rewriting its
  # conditions could break whatever already relies on it. But leaving it
  # unexamined is not safe either: the binding created below grants access to
  # whatever carries attribute.repository, so if this provider never sets that
  # attribute, the binding matches nothing and the first deploy fails on
  # credentials that look correct. And if its condition does not pin a
  # repository, the pool accepts tokens from anywhere on GitHub.
  echo "  provider already exists — checking it fits before relying on it"

  existing=$(gcloud iam workload-identity-pools providers describe "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" \
    --format='value[delimiter="|"](attributeMapping,attributeCondition)')

  mapping="${existing%%|*}"
  condition="${existing#*|}"

  echo "    mapping:   ${mapping:-(none)}"
  echo "    condition: ${condition:-(none)}"

  if [[ "$mapping" != *"attribute.repository"* ]]; then
    cat >&2 <<MSG

  This provider does not map attribute.repository, which the access below is
  granted on. Authentication would succeed and authorisation would then match
  nothing. Add the mapping, keeping any the provider already has:

    gcloud iam workload-identity-pools providers update-oidc ${PROVIDER} \\
      --location=global --workload-identity-pool=${POOL} \\
      --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner"

MSG
  fi

  if [[ -z "$condition" ]]; then
    cat >&2 <<MSG

  This provider has no attribute condition. Its token issuer is shared by every
  repository on GitHub, so as it stands any of them can obtain tokens from this
  pool. Only this repository can reach the deployment account — that is the
  binding below — but any other account bound to this pool is exposed. Consider:

    gcloud iam workload-identity-pools providers update-oidc ${PROVIDER} \\
      --location=global --workload-identity-pool=${POOL} \\
      --attribute-condition="assertion.repository=='${GITHUB_REPO}'"

MSG
  fi
fi

say "Letting that repository borrow the deployment account"
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPO}" \
  --quiet >/dev/null

PROVIDER_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"

cat <<MSG

$(printf '\033[1mDone. Add these to GitHub.\033[0m')

Settings → Secrets and variables → Actions → Variables → New repository variable.
All five are variables, not secrets: none of them is a credential. The
provider name and account email identify who may ask for access; the answer
still depends on the request coming from a workflow run in ${GITHUB_REPO}.

  GCP_WORKLOAD_IDENTITY_PROVIDER   ${PROVIDER_RESOURCE}
  GCP_DEPLOY_SERVICE_ACCOUNT       ${SA_EMAIL}
  GCP_PROJECT                      ${PROJECT}
  GCP_REGION                       ${REGION}
  GTG_DOMAIN                       ${GTG_DOMAIN:-acc.chaithanin.com}

Or from a shell with the GitHub CLI:

  gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER -b '${PROVIDER_RESOURCE}'
  gh variable set GCP_DEPLOY_SERVICE_ACCOUNT -b '${SA_EMAIL}'
  gh variable set GCP_PROJECT -b '${PROJECT}'
  gh variable set GCP_REGION -b '${REGION}'
  gh variable set GTG_DOMAIN -b '${GTG_DOMAIN:-acc.chaithanin.com}'

After that, a merge into main deploys on its own. The first run is worth
watching: it proves the federation works, and it is the only run where a
permission that is still missing looks like a deployment failure.

MSG
