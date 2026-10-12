#!/usr/bin/env bash
# Create the one Cognito user for The Library. Cognito emails a temporary password; signing in
# at https://sandip.dev/nutgraf/ then asks for a new password and an authenticator app (TOTP).
#
#   AWS_PROFILE=admin pnpm create-user                 # dev.sandip@gmail.com
#   AWS_PROFILE=admin pnpm create-user you@example.com
#
# Single-user by design: every account has full control (there are no read-only roles), so this
# refuses to create a second account. Rerunning for your own not-yet-used invite resends it.
set -euo pipefail

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

EMAIL="$(lower "${1:-dev.sandip@gmail.com}")"
REGION=us-east-1
POOL="$(aws cloudformation describe-stacks --region "$REGION" --stack-name TheLibrary-prod \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)"

# One line per existing account: "<email>\t<status>".
EXISTING="$(aws cognito-idp list-users --region "$REGION" --user-pool-id "$POOL" \
  --query "Users[].[Attributes[?Name=='email'].Value | [0], UserStatus]" --output text)"

if [[ -n "$EXISTING" ]]; then
  COUNT="$(printf '%s\n' "$EXISTING" | grep -c .)"
  IFS=$'\t' read -r CURRENT_EMAIL CURRENT_STATUS <<<"$(printf '%s\n' "$EXISTING" | head -n 1)"

  if [[ "$COUNT" -gt 1 || "$(lower "$CURRENT_EMAIL")" != "$EMAIL" ]]; then
    echo "Refusing: The Library is single-user and already has an account ($CURRENT_EMAIL)." >&2
    echo "Every account has full control; there are no read-only roles." >&2
    echo "To replace it, delete that user in the Cognito console (user pool $POOL), then rerun." >&2
    exit 1
  fi

  if [[ "$CURRENT_STATUS" == "FORCE_CHANGE_PASSWORD" ]]; then
    aws cognito-idp admin-create-user --region "$REGION" --user-pool-id "$POOL" \
      --username "$EMAIL" --message-action RESEND --desired-delivery-mediums EMAIL >/dev/null
    echo "Resent the invitation to $EMAIL (check spam for no-reply@verificationemail.com)."
    exit 0
  fi

  echo "$EMAIL already has an account. Lost the password? Use 'Forgot your password?' on the sign-in page."
  exit 0
fi

aws cognito-idp admin-create-user --region "$REGION" --user-pool-id "$POOL" \
  --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL >/dev/null

echo "Invitation sent to $EMAIL (check spam for no-reply@verificationemail.com)."
echo "Sign in at https://sandip.dev/nutgraf/ with the temporary password, set your own,"
echo "then scan the QR code with an authenticator app."
