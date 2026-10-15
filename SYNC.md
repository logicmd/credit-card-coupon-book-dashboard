# This repo is the source of truth

This repository is the **single source of truth** for the Credit Card Coupon
Book Dashboard's code. The live, private deployment (which tracks its owner's
real cards) is a **deployment target**: it runs this code against its own
database. Nobody edits the live app directly.

## Where personal data lives

Only in the live deployment's own database — never in code:

- Accounts, postings, balances: rows in the live app's database, imported
  from its owner's own Plaid connection.
- Login labels ("who is login A / login B"): the live app's `meta` table
  (`ownerALabel` / `ownerBLabel`), set through the `setOwnerLabels` action.
  Code and this repo only ever contain the neutral defaults "Login 1" /
  "Login 2".

Tests use fictional fixtures only. What legitimately lives in the code —
here and therefore in production — is **public program facts**: card benefit
amounts, cycles, and posting names, the same facts anyone can read on the
issuers' pages.

## How changes flow (one direction only)

1. **Edit here.** Every feature, fix, catalog entry, and display tweak is
   made in this repo first. If a change only makes sense with the live
   owner's cards, generalize it (a catalog entry, a config value, an anchor
   date) instead of hardcoding anything personal.
2. **Verify locally.** `bun test` and the typecheck must pass before
   anything moves. New behavior gets new tests with fictional fixtures.
3. **Push to GitHub.** The commit on `main` is the release.
4. **Deploy to live.** The live app is updated to the repo's new code state
   through its editor. Its database is never reset or re-seeded — the
   merge-only import guarantees existing data survives code changes.

There is no manual back-porting step anymore: because the live app is never
edited directly, the two sides cannot drift. A hotfix follows the same path,
just faster — repo, test, push, deploy.

## Feature set (what "this code" currently includes)

- Merge-only Plaid import: postings deduped by transaction id, never
  deleted; re-import may correct a posting's transaction date in place.
- Transaction-date attribution: postings bucket by `authorized_date`
  (transaction date); the posted date is stored and shown, never bucketed.
- Catalogs for Amex (Platinum / Business Platinum / Business Gold / Hilton
  Aspire / Marriott Brilliant) and Chase (Sapphire Preferred, World of
  Hyatt Business, IHG One Rewards Premier, Ritz-Carlton), including
  anniversary-anchored annual cycles.
- Display exclusion list as a stored database preference (meta
  `excludedCredits`, a JSON list of name patterns; the built-in list
  applies until a preference is stored), read and changed only through
  the `getPreferences` / `setExcludedCredits` actions from chat — no
  settings UI; pinned credits; grouped totals across cards and logins;
  Cards section grouped by issuer, then login; used-up credits surface
  their next-period renewal date.
- Login labels stored in `meta`, configurable in the app; daily incremental
  refresh (trailing 30 days) with bootstrap / gap-fill windows.
- Agent Markdown export: one action renders the same aggregated dashboard
  state as a compact markdown file (headline totals, credits ordered by
  nearest period end, catalog usage rules, Plaid-vs-manual posting
  provenance, plus a "Hidden by preference" section naming the credits
  the exclusion preference hides) for pasting to an AI assistant; the
  header offers copy and .md download.
- Unit tests with fictional fixtures covering the period math, catalog,
  matching, import, and dashboard logic.
