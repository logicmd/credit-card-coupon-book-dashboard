# Sync with the live deployment

This repository is the **open-source mirror** of a live, private deployment of
the Credit Card Coupon Book Dashboard. The two codebases are the same app and
must keep the **same feature set**; they differ only in data.

## Where personal data lives

Only in the live deployment's own database — never in code, on either side:

- Accounts, postings, balances: rows in the live app's database, imported
  from its owner's own Plaid connection.
- Login labels ("who is login A / login B"): the live app's `meta` table
  (`ownerALabel` / `ownerBLabel`), set through the `setOwnerLabels` action.
  Code and this repo only ever contain the neutral defaults "Login 1" /
  "Login 2".

Nothing personal flows into this repo. What flows in is code and **public
program facts** (card benefit amounts, cycles, posting names) — the same
facts anyone can read on the issuers' pages. Tests here use fictional
fixtures only.

## How changes flow

1. **Live → repo.** A fix or feature lands in the live app first (it is the
   one tracking real cards). It is then ported here, sanitized: real account
   identifiers, names, and amounts are replaced with fictional ones, and the
   behavior is pinned down with unit tests (`bun test` must pass).
2. **Repo → live.** An improvement made here (a refactor, a new catalog
   entry, a display tweak) is applied to the live app through its editor,
   against the live database, which is never reset or re-seeded — the
   merge-only import guarantees existing data survives code changes.

When porting, port the *behavior*, not the data: if a change only makes
sense with the live owner's cards, generalize it (a catalog entry, a config
value, an anchor date) before bringing it here.

## Shared feature set (keep both sides in step)

- Merge-only Plaid import: postings deduped by transaction id, never
  deleted; re-import may correct a posting's transaction date in place.
- Transaction-date attribution: postings bucket by `authorized_date`
  (transaction date); the posted date is stored and shown, never bucketed.
- Catalogs for Amex (Platinum / Business Platinum / Business Gold / Hilton
  Aspire / Marriott Brilliant) and Chase (Sapphire Preferred, World of
  Hyatt Business, IHG One Rewards Premier, Ritz-Carlton), including
  anniversary-anchored annual cycles.
- Display exclusion list and pinned credits; grouped totals across cards
  and logins; Cards section grouped by issuer, then login; used-up credits
  surface their next-period renewal date.
- Login labels stored in `meta`, configurable in the app; daily incremental
  refresh (trailing 30 days) with bootstrap / gap-fill windows.
- Unit tests with fictional fixtures covering the period math, catalog,
  matching, import, and dashboard logic.
