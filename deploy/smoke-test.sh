#!/usr/bin/env bash
#
# Checks a deployment from outside: DNS, TLS, the health endpoint, the
# redirect and the security headers.
#
#   ./deploy/smoke-test.sh
#   ./deploy/smoke-test.sh acc.example.com
#
# Exits non-zero if any check fails, so it is usable in a pipeline.

set -uo pipefail

DOMAIN="${1:-${GTG_DOMAIN:-acc.chaithanin.com}}"
EXPECTED_IP="${GTG_EXPECTED_IP:-}"

pass=0
fail=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; pass=$((pass + 1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; fail=$((fail + 1)); }
note() { printf '    %s\n' "$*"; }

printf '\nChecking https://%s\n\n' "$DOMAIN"

# ------------------------------------------------------------------ 1. DNS
resolved=$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1)
if [[ -z "$resolved" ]]; then
  bad "DNS: $DOMAIN does not resolve"
  note "Create an A record pointing at the reserved address, then retry."
elif [[ -n "$EXPECTED_IP" && "$resolved" != "$EXPECTED_IP" ]]; then
  bad "DNS: resolves to $resolved, expected $EXPECTED_IP"
else
  ok "DNS resolves to $resolved"
fi

# --------------------------------------------------------- 2. reachability
# Checked before TLS so that "nothing is listening" is never reported as a
# certificate problem. They need completely different fixes.
port_open() { timeout 6 bash -c "exec 3<>/dev/tcp/$1/$2" 2>/dev/null; }

https_open=false
http_open=false
port_open "$DOMAIN" 443 && https_open=true
port_open "$DOMAIN" 80  && http_open=true

if [[ "$https_open" == false && "$http_open" == false ]]; then
  bad "Nothing is listening on 443 or 80"
  note ""
  note "DNS is correct, so this is not a name-resolution problem: no server is"
  note "answering. The usual cause is that the deployment has not run to"
  note "completion — the VM is created after the image is built, so a failed"
  note "build leaves nothing to connect to."
  note ""
  note "Check whether the VM exists at all:"
  note "  gcloud compute instances list --filter='name=gtg-financial'"
  note ""
  note "If it is missing, run the deployment:"
  note "  ./deploy/deploy.sh --local-build"
  note ""
  printf '\n%d passed, %d failed\n\n' "$pass" $((fail + 7))
  exit 1
fi

[[ "$https_open" == true ]] && ok "Port 443 is open" || bad "Port 443 is closed"

# ------------------------------------------------------------------ 3. TLS
# --max-time bounds the whole check; a certificate still being issued shows up
# as a handshake failure rather than a hang.
if tls=$(echo | timeout 20 openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null); then
  issuer=$(echo "$tls" | openssl x509 -noout -issuer 2>/dev/null | sed 's/^issuer=//')
  expiry=$(echo "$tls" | openssl x509 -noout -enddate 2>/dev/null | sed 's/^notAfter=//')
  if [[ -n "$issuer" ]]; then
    ok "TLS certificate present"
    note "issuer:  $issuer"
    note "expires: $expiry"
  else
    bad "TLS: connected but no certificate was presented"
  fi
else
  bad "TLS: handshake failed"
  note "Caddy issues the certificate on the first request and backs off after"
  note "a failure. If DNS has only just been created, force a retry:"
  note "  gcloud compute ssh gtg-financial --zone=asia-southeast1-a \\"
  note "    --command 'sudo docker compose --project-name gtg -f /opt/gtg/docker-compose.yml restart caddy'"
fi

# --------------------------------------------------------------- 4. health
health=$(curl -sS --max-time 20 "https://${DOMAIN}/api/health" 2>/dev/null)
if [[ "$health" == *'"status":"ok"'* ]]; then
  ok "Health endpoint reports ok"
else
  bad "Health endpoint did not report ok"
  note "got: ${health:-<no response>}"
fi

# ---------------------------------------------------------------- 5. login
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://${DOMAIN}/login" 2>/dev/null)
[[ "$code" == "200" ]] && ok "Sign-in page returns 200" || bad "Sign-in page returned ${code:-no response}"

# ----------------------------------------------------- 6. auth is enforced
# The dashboard must never be served to an anonymous request.
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://${DOMAIN}/financial" 2>/dev/null)
if [[ "$code" == "307" || "$code" == "302" ]]; then
  ok "Dashboard redirects an anonymous visitor to sign-in"
elif [[ "$code" == "200" ]]; then
  bad "Dashboard served financial data without a session — investigate immediately"
else
  bad "Dashboard returned ${code:-no response}"
fi

# ------------------------------------------------------- 7. HTTP redirect
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "http://${DOMAIN}/" 2>/dev/null)
[[ "$code" == "308" || "$code" == "301" || "$code" == "302" ]] \
  && ok "Plain HTTP redirects to HTTPS ($code)" \
  || bad "Plain HTTP returned ${code:-no response}, expected a redirect"

# -------------------------------------------------------- 8. TLS headers
headers=$(curl -sSI --max-time 20 "https://${DOMAIN}/login" 2>/dev/null)
for header in "strict-transport-security" "x-content-type-options" "x-frame-options"; do
  grep -qi "^${header}:" <<<"$headers" \
    && ok "Header ${header} present" \
    || bad "Header ${header} missing"
done

printf '\n%d passed, %d failed\n\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
