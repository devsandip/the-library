#!/usr/bin/env bash
# Bring the main checkout up to main after a merge: fetch, then fast-forward, but only when it is
# on main with no local changes. Run from any worktree after every merge:
#
#   pnpm sync-main                 # the main checkout of this repository
#   pnpm sync-main /path/to/clone  # another checkout
set -euo pipefail

# The main checkout is the first entry `git worktree list` gives.
repo="${1:-$(git worktree list --porcelain | awk '/^worktree /{sub(/^worktree /, ""); print; exit}')}"
git -C "$repo" fetch --quiet origin
branch="$(git -C "$repo" symbolic-ref --quiet --short HEAD || echo "a detached HEAD")"
if [[ "$branch" != main ]]; then
  echo "Left alone: $repo is on $branch, not main."
  exit 0
fi
if [[ -n "$(git -C "$repo" status --porcelain --untracked-files=no)" ]]; then
  echo "Left alone: $repo has local changes."
  exit 0
fi
before="$(git -C "$repo" rev-parse --short HEAD)"
# Fails, and says why, if local main has commits that are not on origin.
git -C "$repo" merge --ff-only --quiet origin/main
after="$(git -C "$repo" rev-parse --short HEAD)"
if [[ "$before" == "$after" ]]; then
  echo "$repo is at $after, even with origin/main."
else
  echo "$repo moved from $before to $after, even with origin/main."
fi
