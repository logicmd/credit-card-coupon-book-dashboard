# Tests

Unit and integration tests for the Credit Card Coupon Book Dashboard, written
with Bun's built-in test runner. **All fixture data is fictional** — invented
people ("Alex" / "Sam"), fake card masks (··1111), fake Plaid-style ids
(`fake-...`), and made-up balances and amounts. Posting names are modeled on
the public Amex benefit catalog, but no value comes from a real account.

## Run

```bash
bun install
bun test          # or: bun run test
bun run typecheck # the suite must not break the app's typecheck either
```

## What is covered

| File | Covers |
| --- | --- |
| `period-bounds.test.ts` | Pure calendar math: monthly / quarterly / semiannual / annual period windows (incl. leap-year February), **anniversary-anchored annual windows** (anchor-to-anchor cycles, e.g. May 1 – Apr 30), period keys and labels, `addDays` / `daysBetween`, LA date conversion. |
| `catalog.test.ts` | The benefit catalog per card product (`catalogFor`, incl. product-detection precedence, co-branded Platinum fall-through, and the Chase products with their anchor dates), the display exclusion list (`isExcludedName`), pinned credits (`isPinnedCredit`), login label resolution (`ownerLabelFor`), and issuer detection (`issuerForAccountName`). |
| `matching.test.ts` | Posting→credit auto-mapping (`matchCreditForPosting`: substring, case-insensitive, first match wins, empty pattern never matches, and account-scoped matching for Hyatt's generic `CREDIT ADJUSTMENT` postings) and duplicate suspicion (`suspectedDuplicatesFor`: same product + mask, or import-recorded transaction evidence — a flag for the user, never an automatic ignore). |
| `grouping.test.ts` | Client-side grouping of the same credit type across cards (`groupCredits` in `client/src/grouping.ts`): merged totals across both logins, member ordering, group ordering, rounding. |
| `refer-prompt.test.ts` | The header Refer button's invitation (`REFER_PROMPT` in `client/src/referPrompt.ts`): pinned verbatim, points at the repo URL + `SETUP_FOR_MUSE.md`, contains no user data; and App.tsx renders that constant in its Refer panel (no inline copy to drift). |
| `import.test.ts` | DB-backed `importSnapshot` against an in-memory SQLite database with the real migrations: catalog seeding (with truthful defaults — enrollment-required credits seed not-enrolled, catalog anchors seed unconfirmed), posting auto-mapping, **merge-only idempotence** (re-importing the same snapshot adds nothing), coverage certification rules (incomplete imports certify nothing; coverage never moves forward), sticky owner attribution (imports fill, never overwrite; never un-ignore), suspected-duplicate flagging (never auto-ignore), signed postings / clawback netting, strict calendar-date rejection, and Plaid currency storage. |
| `refresh.test.ts` | The refresh fetch window (`resolveRefreshWindow`): the floor is Jan 1 or the earliest current anchored-period start when earlier; bootstrap until coverage reaches the floor; gap-fill clamped at the floor. Plus `refreshCredits` handler integration with a capturing fake agent ctx, pinning the spawned prompt (owner by person, signed clawback amounts, currency). |
| `materialization.test.ts` | Materialize-on-write for synthesized (negative-id) credits: edits / enrolled toggles / deletes stick, deletes are tombstones synthesis respects, re-adding revives a tombstone; `assignPosting` target validation; account nicknames surviving re-import and rendering; `listUnassignedCount` agreeing with the dashboard; the timezone preference; anchor-pair validation. |
| `transaction-date.test.ts` | Transaction-date attribution: postings bucket by `authorized_date`, not the posted date (authorized Sep 30 / posted Oct 2 counts in Q3); both dates are stored; a re-import with a corrected `transactionDate` fixes the stored date in place (`postingsCorrected`) and moves the bucket without duplicating the posting. |
| `chase.test.ts` | DB-backed Chase end to end: fictional Chase accounts import with issuer "Chase", seed the Chase catalog (incl. May 1 anchors; the IHG TravelBank benefit is a deposit, not a statement credit, so it is not seeded), and the dashboard runs Sapphire/Hyatt on the anniversary year while auto-mapping `ANNUAL HOTEL CREDIT` / `CREDIT ADJUSTMENT` / `TRAVEL CREDIT` postings. |
| `dashboard.test.ts` | DB-backed `getDashboard`: current-period usage (last period's postings don't leak in), totals aggregated across cards and logins, exclusion filtering in credits/totals/unassigned, pinned-credit visibility, owner labels end to end, and ignored accounts dropping out of totals. |

The DB-backed tests call the action handlers directly with a fake ctx whose
`db` accessor returns a Drizzle instance over `bun:sqlite` `:memory:` — no
server, no network, no Plaid.

## What is NOT covered

- **The spawned refresh agent's own work**: `refreshCredits`' window
  selection and prompt are covered (`refresh.test.ts`, with a capturing
  fake agent ctx), but the agent task it spawns — the actual Plaid reads
  it performs in the hosted runtime — cannot run here. The merge-only
  import behavior it relies on *is* covered by `import.test.ts`.
- **React rendering**: components are not rendered in tests. The one piece of
  client logic with real behavior — `groupCredits` — was extracted to
  `client/src/grouping.ts` and is tested directly.
- The tests directory is not part of either tsconfig project, so
  `bun run typecheck` does not typecheck the tests themselves; `bun test`
  transpiles and runs them.
