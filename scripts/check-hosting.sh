#!/usr/bin/env bash
# Hosting checks from docs/architecture.md section 4.
#
#   scripts/check-hosting.sh                                   # through https://sandip.dev/thelibrary
#   scripts/check-hosting.sh https://dxxxx.cloudfront.net/thelibrary   # the app distribution directly
#
# Echo checks (ECHO=1, only while the R2 echo stub was deployed) proved that methods, query
# strings, bodies and auth headers survive the proxy chain. Default now checks the real API's auth.
set -uo pipefail

BASE="${1:-https://sandip.dev/thelibrary}"
BASE="${BASE%/}"
ORIGIN="$(printf '%s' "$BASE" | sed -E 's#^(https://[^/]+).*#\1#')"
ECHO="${ECHO:-0}"
FAILS=0

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }
sha12() { printf '%s' "$1" | shasum -a 256 | cut -c1-12; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s)[process.argv[1]];console.log(typeof v==="object"?JSON.stringify(v):v)})' "$1"; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
header() { curl -sI "$1" | tr -d '\r' | grep -i "^$2:" ; }

echo "Checking $BASE"

echo "Shell and routing"
loc="$(curl -sI "$BASE" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')"
code="$(status "$BASE")"
check "no-slash path redirects to the slash path ($code -> $loc)" \
  '[[ "$code" =~ ^30[178]$ ]] && [[ "$loc" == "/thelibrary/" || "$loc" == "$ORIGIN/thelibrary/" ]]'
for p in "/" "/x/y" "/senders/a.b" "/auth/callback?code=abc&state=xyz"; do
  check "GET $p serves the shell" '[[ "$(status "$BASE$p")" == 200 ]] && curl -s "$BASE$p" | grep -q "<title>The Library</title>"'
done
check "exactly one CSP header" '[[ "$(header "$BASE/" content-security-policy | wc -l | tr -d " ")" == 1 ]]'
check "CSP keeps scripts to self" 'header "$BASE/" content-security-policy | grep -q "script-src '"'"'self'"'"'"'
check "X-Robots-Tag noindex" 'header "$BASE/" x-robots-tag | grep -qi noindex'
check "index.html is not cacheable" 'header "$BASE/" cache-control | grep -qi no-cache'
asset="$(curl -s "$BASE/" | grep -oE '/thelibrary/assets/[^"]+\.js' | head -1)"
check "hashed asset is immutable ($asset)" '[[ -n "$asset" ]] && header "$ORIGIN$asset" cache-control | grep -qi immutable'
code="$(status "$BASE/assets/nope-123.js")"
check "missing asset is 404/403 without redirect ($code)" '[[ "$code" == 404 || "$code" == 403 ]]'
check "config.json served" '[[ "$(status "$BASE/config.json")" == 200 ]]'

if [[ "$ECHO" == 1 ]]; then
  echo "API chain (echo stub)"
  r="$(curl -s "$BASE/api/echo/a.b?c=a%2Bb%40c%2Fd&z=1" -H 'authorization: Bearer t1' -H 'x-library-auth: t1')"
  check "path with a dot arrives" '[[ "$(json rawPath <<<"$r")" == "/thelibrary/api/echo/a.b" ]]'
  check "encoded query string arrives intact" '[[ "$(json rawQueryString <<<"$r")" == "c=a%2Bb%40c%2Fd&z=1" ]]'
  check "Authorization header arrives" '[[ "$(json authorizationHash <<<"$r")" == "$(sha12 "Bearer t1")" ]]'
  check "custom x-library-auth header arrives" '[[ "$(json customAuthHash <<<"$r")" == "$(sha12 t1)" ]]'
  body='{"a":1,"b":"x y"}'
  for m in POST PATCH PUT DELETE; do
    r="$(curl -s -X "$m" "$BASE/api/echo" -H 'content-type: application/json' -d "$body")"
    check "$m arrives with its body" '[[ "$(json method <<<"$r")" == "$m" && "$(json bodyHash <<<"$r")" == "$(sha12 "$body")" ]]'
  done
  n1="$(curl -s "$BASE/api/echo?same=1" | json nonce)"
  n2="$(curl -s "$BASE/api/echo?same=1" | json nonce)"
  check "API responses are not cached" '[[ -n "$n1" && "$n1" != "$n2" ]]'
  check "API cache-control no-store" 'header "$BASE/api/echo" cache-control | grep -qi no-store'
  code="$(curl -s -o /dev/null -w '%{http_code}' -H 'accept-encoding: br, gzip' "$BASE/api/echo?bytes=3000000")"
  check "3 MB response comes through ($code)" '[[ "$code" == 200 ]]'
fi

if [[ "$ECHO" != 1 ]]; then
  echo "API auth (real API)"
  for p in "/api/status" "/api/issues" "/api/senders"; do
    code="$(status "$BASE$p")"
    check "GET $p without a token is 401 ($code)" '[[ "$code" == 401 ]]'
  done
  code="$(status -H 'authorization: Bearer not-a-real-token' "$BASE/api/status")"
  check "GET /api/status with a forged token is 401 ($code)" '[[ "$code" == 401 ]]'
  check "config.json names the Cognito client" 'curl -s "$BASE/config.json" | grep -q clientId'
fi

if [[ "$ORIGIN" == "https://sandip.dev" ]]; then
  echo "Root site untouched"
  check "root page still 200" '[[ "$(status https://sandip.dev/)" == 200 ]]'
  check "root page has no CSP from us" '[[ -z "$(header https://sandip.dev/ content-security-policy)" ]]'
  check "root page has no X-Robots-Tag" '[[ -z "$(header https://sandip.dev/ x-robots-tag)" ]]'
fi

echo
if [[ "$FAILS" == 0 ]]; then echo "All checks passed."; else echo "$FAILS check(s) failed."; fi
exit "$FAILS"
