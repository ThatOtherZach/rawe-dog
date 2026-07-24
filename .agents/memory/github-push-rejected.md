---
name: GitHub PUSH_REJECTED diagnosis
description: What a bare PUSH_REJECTED from the git push callback usually means and the filter-branch worktree gotcha
---

# GitHub PUSH_REJECTED diagnosis

- A bare `PUSH_REJECTED` from the platform git-push callback (with fast-forwardable history and valid credentials) is often **GitHub secret-scanning push protection**: any new blob in the push containing an API key gets the whole push rejected, with no useful message surfaced.
- **How to apply:** before blaming credentials, scan the unpushed range for committed secrets (app data/settings files are the usual culprits — check field lengths with jq, never print values). Fix by rewriting only the unpushed commits (`git filter-branch --index-filter 'git rm --cached ...' -- <base>..HEAD`), gitignoring the file, then pushing.
- **Gotcha:** despite `--index-filter` not touching the worktree during the rewrite, filter-branch checks out the rewritten HEAD at the end — a file removed from history **vanishes from disk**. Restore it from `refs/original/refs/heads/<branch>` BEFORE deleting that backup ref.
- In this project the app stores user API keys in a JSON settings file under the api-server data dir (written by the Settings UI at runtime); it must stay untracked.
