# Credit Card Coupon Book Dashboard

Track every American Express statement credit across all your cards — and actually use them before they expire.

If you hold multiple Amex cards (Platinum, Business Platinum, Business Gold, Hilton Aspire, Marriott Brilliant…), each card carries statement credits on different cycles: monthly, quarterly, semi-annual, annual. They are easy to forget and Amex does not roll them over. This dashboard pulls your real credit postings from Plaid, matches them against a built-in catalog of each card's credits, and shows — per current period — how much you have used and how much is left, grouped by credit type across cards.

## Features

- **Real usage, not guesses** — usage is computed from the actual statement-credit postings on your accounts (e.g. `Platinum Lululemon Credit`, `AMEX Flight Credit`), never inferred from spending.
- **Transaction-date attribution** — a credit counts toward the period of the underlying transaction (`authorized_date`), not the day Amex posted it. A Hilton charge on Sep 30 whose credit posts Oct 2 counts in Q3, not Q4.
- **Merged view** — the same credit on six cards shows as one row with the combined total; expand it to see each card.
- **Two logins supported** — households often have cards spread across two Amex logins (e.g. you and your spouse). Each account is tagged with its login; labels are configurable ("Login 1" / "Login 2" by default). Summary totals are always combined.
- **Only what you can still use** — the dashboard focuses on the current period. Used-up credits collapse behind a toggle. Credits you do not care about (a built-in exclusion list, editable in code) never appear.
- **Incremental refresh** — daily refresh pulls only the last 30 days from Plaid and merges by transaction ID. Nothing already stored is ever deleted; a coverage-start marker shows how far back your data goes. If coverage is incomplete, refresh bootstraps from Jan 1 of the current year first.

## Run it in Muse (recommended)

This app is built to run as a Muse web artifact. The fastest path:

1. Paste this repo's URL into your Muse chat.
2. Say: **"Set this up for me — follow SETUP_FOR_MUSE.md."**
3. Your Muse will create the app, ask you to connect your Amex account(s) through Plaid, ask what to call your two logins, and run the first import.

See [SETUP_FOR_MUSE.md](SETUP_FOR_MUSE.md) for the exact playbook your Muse will follow.

## Run it standalone

The app is a standard TypeScript full-stack project (React client + server actions + SQLite via Drizzle):

```bash
bun install
bun run build   # server bundle; the client is built by the hosting runtime
bun run typecheck
```

Without Muse, the Plaid auto-refresh agent is unavailable; you can still maintain data manually in the UI (add postings, edit credits) or feed it through the `importSnapshot` action.

## How it works

- `server/src/actions.ts` — data actions: `importSnapshot` (merge-only Plaid import), `refreshCredits` (spawns the incremental 30-day refresh), `getDashboard`, credit/posting CRUD, `setOwnerLabels`.
- `server/src/schema.ts` — accounts, credits, postings, meta (incl. `ownerALabel` / `ownerBLabel`, `dataCoverageStart`).
- The built-in catalog encodes public Amex program rules (amounts, periods, posting-name patterns) for Platinum / Business Platinum / Business Gold / Hilton Aspire / Marriott Brilliant. Excluded by default (display preference, easy to change in `EXCLUDED_NAME_PATTERNS`): ChatGPT Business, Indeed, Adobe, CLEAR+, Equinox, Digital Entertainment, Walmart+, Uber One credits, the discontinued Brilliant property credit, and Saks.

## Privacy

Your financial data never leaves your own environment: accounts and postings live in the app's local database in *your* workspace. This repo contains no one's data — the database starts empty and bootstraps from your own Plaid connection.

## License

MIT
