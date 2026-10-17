#!/usr/bin/env bash
# Put an issue or pull request on the Nutgraf project (github.com/users/devsandip/projects/10)
# and set its Status and, optionally, its Track. Adding one that is already there just updates it.
#
#   pnpm track <number|url> <status> [track]
#   pnpm track 81 "In progress" Sorting
#
# Status: Backlog, Up next, In progress, In review, Waiting, Done.
# Track: Reading, Sorting, Stories, Briefings, Agentic, Ops.
set -euo pipefail

OWNER=devsandip
NUMBER=10
REPO=devsandip/the-library

ref=${1:?usage: pnpm track <number|url> <status> [track]}
status=${2:?status: Backlog, Up next, In progress, In review, Waiting or Done}
track=${3:-}

case $ref in
  http*) url=$ref ;;
  # The issues endpoint answers for pull requests too.
  *) url=$(gh api "repos/$REPO/issues/${ref#\#}" --jq .html_url) ;;
esac

fields=$(gh project field-list "$NUMBER" --owner "$OWNER" --format json)
field_id() { jq -r --arg f "$1" '.fields[] | select(.name == $f) | .id' <<<"$fields"; }
option_id() {
  jq -r --arg f "$1" --arg o "$2" \
    '.fields[] | select(.name == $f) | .options[] | select(.name == $o) | .id' <<<"$fields"
}

# Check the names before touching the project.
status_option=$(option_id Status "$status")
[ -n "$status_option" ] || { echo "No Status called \"$status\"" >&2; exit 1; }
if [ -n "$track" ]; then
  track_option=$(option_id Track "$track")
  [ -n "$track_option" ] || { echo "No Track called \"$track\"" >&2; exit 1; }
fi

project=$(gh project view "$NUMBER" --owner "$OWNER" --format json --jq .id)
item=$(gh project item-add "$NUMBER" --owner "$OWNER" --url "$url" --format json --jq .id)
gh project item-edit --id "$item" --project-id "$project" \
  --field-id "$(field_id Status)" --single-select-option-id "$status_option" >/dev/null
if [ -n "$track" ]; then
  gh project item-edit --id "$item" --project-id "$project" \
    --field-id "$(field_id Track)" --single-select-option-id "$track_option" >/dev/null
fi
echo "$url: $status${track:+, $track}"
