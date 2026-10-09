#!/usr/bin/env bash
# Create the one Cognito user for The Library. Cognito emails a temporary password; signing in
# at https://sandip.dev/thelibrary/ then asks for a new password and an authenticator app (TOTP).
#
#   AWS_PROFILE=admin pnpm create-user                 # dev.sandip@gmail.com
#   AWS_PROFILE=admin pnpm create-user you@example.com
set -euo pipefail

EMAIL="${1:-dev.sandip@gmail.com}"
REGION=us-east-1
POOL="$(aws cloudformation describe-stacks --region "$REGION" --stack-name TheLibrary-prod \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)"

aws cognito-idp admin-create-user --region "$REGION" --user-pool-id "$POOL" \
  --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL >/dev/null

echo "Invitation sent to $EMAIL (check spam for no-reply@verificationemail.com)."
echo "Sign in at https://sandip.dev/thelibrary/ with the temporary password, set your own,"
echo "then scan the QR code with an authenticator app."
