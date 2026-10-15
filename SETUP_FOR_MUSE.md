# Setup playbook for Muse

You are setting up the Credit Card Coupon Book Dashboard for your user from this repository. Follow these steps in order. Do not skip the questions in steps 3 and 5.

## 1. Create the app

Create a private web artifact (full-stack) in the user's workspace with slug `credit-card-coupon-book-dashboard`, using the source in this repository (`client/`, `server/`, `drizzle/`, `package.json`) as the app's code. Do not invent a different implementation — the value of this repo is its tested data logic (merge-only import, transaction-date attribution, catalog matching).

If the user already has an artifact with that slug, stop and ask before replacing anything.

## 2. Connect Plaid

The app's data comes from the Plaid connector. Check whether the user has Plaid connected; if not, walk them through connecting it and linking their American Express login(s). Households commonly have **two** Amex logins (e.g. the user and their spouse) — link both if they exist. If the user also holds Chase cards with coupon-book credits (Sapphire Preferred, World of Hyatt Business, IHG One Rewards Premier, Ritz-Carlton), link the Chase login too — the catalog covers those products, including their anniversary-year cycles.

Supported cards are exactly the nine listed under "Supported cards" in the README. Any other card is not yet supported — in particular, Chase United cards (e.g. United Explorer) have not been verified: their accounts may appear via Plaid, but no credits are tracked for them.

Do not ask for, accept, or store Amex usernames/passwords yourself. The connection happens through the connector's own flow.

## 3. Ask: what should the two logins be called?

Accounts are tagged by login as `A` (first Plaid institution grouping) and `B` (second). Ask the user what display label each login should get — typically their first name and their spouse's first name. Save the answers with the `setOwnerLabels` action (meta keys `ownerALabel` / `ownerBLabel`). Defaults are "Login 1" / "Login 2" if they do not care.

Never hardcode names into code. Labels live in app meta only.

## 4. First import (bootstrap)

Open the app and trigger `refreshCredits`. With an empty database it performs a bootstrap pull from **January 1 of the current year** to today, imports all accounts and credit postings, and records the coverage start. Confirm afterwards with `getDashboard`:

- 16-or-so accounts may appear before dedup — supplementary (authorized-user) records whose transactions are a strict subset of a primary account are ignored automatically; exact duplicate records across logins are collapsed.
- Each tracked credit shows current-period used/remaining based on actual postings.

## 5. Ask: which credits to hide?

The built-in exclusion list already hides credits most people cannot or do not want to use (ChatGPT Business, Indeed, Adobe, CLEAR+, Equinox, Digital Entertainment, Walmart+, Uber One, the discontinued Brilliant property credit, Saks). Ask the user if they want any of those shown, or anything else hidden, and adjust `EXCLUDED_NAME_PATTERNS` in `server/src/actions.ts` accordingly, then rebuild the artifact.

## 6. Set the daily refresh (recommended)

Create a scheduled job (cron) that runs every morning and invokes the app's refresh: it pulls only the **last 30 days** from Plaid, diffs against stored postings by transaction ID, and merges — never deletes. Attribution is by transaction date: for every posting, pass the Plaid `authorized_date` as `transactionDate` alongside the posted `date` (the app buckets by `transactionDate`; a re-import may correct a stored transaction date in place). The job should stay silent unless the refresh fails.

Optionally also offer a monthly reminder (e.g. on the 24th) summarizing credits that will expire at the end of the current period with a remaining balance. Only create it if the user says yes.

## Ground rules

- Never delete stored postings during a refresh. The store only grows.
- Never place orders, book anything, or spend a credit on the user's behalf. This app observes; it does not transact.
- The user's data stays in their workspace. Do not copy it anywhere else.
