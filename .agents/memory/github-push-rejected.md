---
name: GitHub PUSH_REJECTED diagnosis
description: What a bare PUSH_REJECTED from the git push callback usually means and the filter-branch worktree gotcha
---

# GitHub PUSH_REJECTED diagnosis

- A bare `PUSH_REJECTED` from the platform git-push callback (with fast-forwardable history and valid credentials) is often **GitHub secret-scanning push protection**: any new blob in the push containing an API key gets the whole push rejected, with no useful message surfaced.
- **How to apply:** before blaming credentials, scan the unpushed range for committed secrets (app data/settings files are the usual culprits — check field lengths with jq, never print values). Fix by rewriting only the unpushed commits (`git filter-branch --index-filter 'git rm --cached ...' -- <base>..HEAD`), gitignoring the file, then pushing.
- **Gotcha:** despite `--index-filter` not touching the worktree during the rewrite, filter-branch checks out the rewritten HEAD at the end — a file removed from history **vanishes from disk**. Restore it from `refs/original/refs/heads/<branch>` BEFORE deleting that backup ref.
- In this project the app stores user API keys in a JSON settings file under the api-server data dir (written by the Settings UI at runtime); it must stay untracked.
- **Tracked config files are the other trap**: a key pasted into `.replit`'s `[env]` block rides in every later commit's tree until rewritten — one bad blob poisons the whole push range. Users may paste keys into URL-shaped env vars (`XAI_BASE_URL`), which also poisons runtime since code falls back to env for the base URL.
- For line-level purges where the file must survive (e.g. `.replit`), `git filter-branch --tree-filter 'sed -i "/^BAD_LINE/d" file' -- <first_clean_commit>..HEAD` works; scan history first to find the boundary. The final HEAD checkout updates the worktree copy too, so no separate worktree edit is needed. Keep `refs/original` until the push succeeds.
- **Both URL-env slots are traps**: `XAI_BASE_URL` and `THEIRSTACK_BASE_URL` in `.replit` have each hosted a real API key/JWT by accident. Add URL-validity guards in both adapters so a non-URL value is ignored with a warning rather than poisoning the fetch call. Keys belong in the Settings page only.
