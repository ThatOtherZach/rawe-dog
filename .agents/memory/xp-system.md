---
name: XP & achievements system
description: Implementation details for the client-side Office Space XP gamification layer — localStorage keys, event contract, widget visibility rule, and the full-loop bonus.
---

# XP & achievements system

Easter egg — **not documented in replit.md by design**. Mention only in memory files and code comments.

## Storage (localStorage)
- `"rawedog_profile"` — full `XpProfile` JSON (xp, achievements, events, firstKitAt, etc.)
- `"rawedog_kit_ever_generated"` — `"1"` when any kit has been generated; controls widget visibility

## Visibility rule
The `XpWidget` is **hidden until `"rawedog_kit_ever_generated"` is set**. It only appears after the user generates their first kit (free lane is the entry point, not the paid lane).

## CustomEvents dispatched by `xpStore.ts`
- `"rawedog:xp_updated"` — fired on any profile change; `XpWidget` listens and re-renders
- `"rawedog:achievement"` — `{ achievement: AchievementRecord }` — widget shows the toast

## XP values (key ones)
- Kit generated: +25 XP (same whether from paste or paid search)
- Mark applied: +100 XP
- Paid search: +50 XP (the paid-lane wedge — free lane has no equivalent)
- Daily first-action bonus: +50 XP
- **Full-loop bonus**: +75 XP — paid search → kit generated (same posting) → applied, within 48 h
- Dismiss posting: +5 XP; compose doc: +30 XP; upload file: +20 XP

## Full-loop bonus cross-page persistence
`lastPaidSearchAt` is stored in the profile in `localStorage`. The generate page and postings page read it independently — no session state required. The 48 h window survives page navigation and reloads.

## Levels (Office Space themed, 12 total)
Unpaid Intern → New Hire → Has a Case of the Mondays → Filed the TPS Report → Sufficient Flair → The Bobs Approve → Jumped Ship → Do Nothing → CEO → Boss → Who's The Boss? → You da Boss frfr

## Achievements (22 total)
Key ids: `memo`, `pc_load_letter`, `case_of_mondays`, `not_the_singer`, `miltons_stapler`, `flair`, `burned_it_down`, `basement`, `did_nothing`, `jumped_ship`, `derive_filters`, `setup_api`, `librarian`, `memo_drafted`, `imported_goods`, `taking_it_with_you`, `paper_trail`, `delegated`, `serial_refresher`, `move_fast`, `laser_focused`, `overachiever`.

## Hook points (where awardXP is called)
- `GeneratePage` — `"done"` SSE event (kit complete)
- `PostingsPage` — `patchStatus` success for `"applied"` and `"dismissed"`; `refreshPostings` success for `"paid_search"`; `saveFilters` for `"filter_changed"`; `deriveFilters` for `"derive_filters"`
- `LibraryPage` — `onUpload` success; `ComposeWizard` `onSaved` callback
- `SettingsPage` — `onSave` success; `wipeAllData` success

**Why:** pure localStorage module + CustomEvent pattern keeps XP logic out of React state and avoids prop-drilling or a context provider. The widget self-updates by listening on `window`.
