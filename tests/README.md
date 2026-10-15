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
| `period-bounds.test.ts` | Pure calendar math: monthly / quarterly / semiannual / annual period windows (incl. leap-year February), period keys and labels, `addDays` / `daysBetween`, LA date conversion. |
| `catalog.test.ts` | The benefit catalog per card product (`catalogFor`, incl. product-detection precedence and co-branded Platinum fall-through), the display exclusion list (`isExcludedName`), pinned credits (`isPinnedCredit`), and login label resolution (`ownerLabelFor`). |
| `matching.test.ts` | Posting→credit auto-mapping (`matchCreditForPosting`: substring, case-insensitive, first match wins, empty pattern never matches) and the duplicate-account key (`accountDuplicateKey`). |
| `grouping.test.ts` | Client-side grouping of the same credit type across cards (`groupCredits` in `client/src/grouping.ts`): merged totals across both logins, member ordering, group ordering, rounding. |
| `import.test.ts` | DB-backed `importSnapshot` against an in-memory SQLite database with the real migrations: catalog seeding, posting auto-mapping, **merge-only idempotence** (re-importing the same snapshot adds nothing), coverage certification rules (incomplete imports certify nothing; coverage never moves forward), and duplicate-account flagging. |
| `dashboard.test.ts` | DB-backed `getDashboard`: current-period usage (last period's postings don't leak in), totals aggregated across cards and logins, exclusion filtering in credits/totals/unassigned, pinned-credit visibility, owner labels end to end, and ignored accounts dropping out of totals. |

The DB-backed tests call the action handlers directly with a fake ctx whose
`db` accessor returns a Drizzle instance over `bun:sqlite` `:memory:` — no
server, no network, no Plaid.

## What is NOT covered

- **Anniversary-anchored periods**: the app has none. Annual credits use the
  calendar year and semiannual credits use calendar halves; a card whose
  program runs on a cardmember-year cycle is tracked on the calendar cycle
  (the catalog notes say so). There is no anchor logic to test.
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
