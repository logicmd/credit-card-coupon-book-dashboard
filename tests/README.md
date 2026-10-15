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
| `matching.test.ts` | Posting→credit auto-mapping (`matchCreditForPosting`: substring, case-insensitive, first match wins, empty pattern never matches, and account-scoped matching for Hyatt's generic `CREDIT ADJUSTMENT` postings) and the duplicate-account key (`accountDuplicateKey`). |
| `grouping.test.ts` | Client-side grouping of the same credit type across cards (`groupCredits` in `client/src/grouping.ts`): merged totals across both logins, member ordering, group ordering, rounding. |
| `import.test.ts` | DB-backed `importSnapshot` against an in-memory SQLite database with the real migrations: catalog seeding, posting auto-mapping, **merge-only idempotence** (re-importing the same snapshot adds nothing), coverage certification rules (incomplete imports certify nothing; coverage never moves forward), and duplicate-account flagging. |
| `transaction-date.test.ts` | Transaction-date attribution: postings bucket by `authorized_date`, not the posted date (authorized Sep 30 / posted Oct 2 counts in Q3); both dates are stored; a re-import with a corrected `transactionDate` fixes the stored date in place (`postingsCorrected`) and moves the bucket without duplicating the posting. |
| `chase.test.ts` | DB-backed Chase end to end: fictional Chase accounts import with issuer "Chase", seed the Chase catalog (incl. May 1 anchors and the patternless TravelBank row), and the dashboard runs Sapphire/Hyatt on the anniversary year while auto-mapping `ANNUAL HOTEL CREDIT` / `CREDIT ADJUSTMENT` / `TRAVEL CREDIT` postings. |
| `dashboard.test.ts` | DB-backed `getDashboard`: current-period usage (last period's postings don't leak in), totals aggregated across cards and logins, exclusion filtering in credits/totals/unassigned, pinned-credit visibility, owner labels end to end, and ignored accounts dropping out of totals. |

The DB-backed tests call the action handlers directly with a fake ctx whose
`db` accessor returns a Drizzle instance over `bun:sqlite` `:memory:` — no
server, no network, no Plaid.

## What is NOT covered

- **Anniversary anchors beyond annual periods**: anchors exist and are
  covered (period math in `period-bounds.test.ts`, end to end in
  `chase.test.ts`), but they apply to annual credits only — monthly /
  quarterly / semiannual credits always use calendar windows, and a
  semiannual credit on a cardmember-year program (e.g. the Aspire resort
  credit) is still tracked in calendar halves, as its catalog note says.
- **`refreshCredits`**: it spawns a platform agent task (`ctx.agent`), which
  does not exist outside the hosted runtime. Its window-selection logic
  (bootstrap / gap-fill / 30-day incremental) is therefore not unit-tested
  here; the merge-only import behavior it relies on *is* covered by
  `import.test.ts`.
- **Supplementary-account dedup semantics**: the import flags a record as a
  duplicate when name + non-zero balance + credit limit all match another
  record (a primary/supplementary pair seen from two logins reports
  identical values). It does not compare transaction sets; the tests pin the
  implemented heuristic.
- **React rendering**: components are not rendered in tests. The one piece of
  client logic with real behavior — `groupCredits` — was extracted to
  `client/src/grouping.ts` and is tested directly.
- The tests directory is not part of either tsconfig project, so
  `bun run typecheck` does not typecheck the tests themselves; `bun test`
  transpiles and runs them.
