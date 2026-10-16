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

Some credits are hidden by default — the built-in list covers ChatGPT Business, Indeed, Adobe, CLEAR+, Equinox, Digital Entertainment, and Walmart+. Hidden credits never appear on the dashboard and never count in any total. They do not need a stored database row to exist: the dashboard synthesizes every catalog credit for every account at read time (a stored row, when present, supplies the saved state and its postings still count as assigned), so removing a credit's entry from the preference below always brings it back — even on accounts imported before that credit family was tracked.

Hiding is a **stored preference, not a code setting**: it lives in the app's meta table under the key `excludedCredits` (a JSON list of lowercase name patterns). The user can change it themselves in the web page's Display settings section (one toggle per hideable family) or by asking you in chat — both paths go through the same two actions below, and a selection the user saves is authoritative (the built-in defaults only apply until something is stored):

- Read the current list with the `getPreferences` action. (When nothing has ever been stored, it returns the built-in defaults.)
- Change it with the `setExcludedCredits` action, passing the **complete** new list — it replaces the stored one, it does not append. To show a hidden credit again, resend the list without its entry; to hide another credit, add its name. An empty list shows everything.
- Entries are matched as case-insensitive substrings of credit names and are validated against the catalog and the credits stored in the database — an unknown name is rejected, so if a call fails, compare the spelling against `getDashboard` or the catalog before retrying.

The change takes effect immediately — in the dashboard, and in the Agent Markdown export, which names the hidden credits under "Hidden by preference" so you always know they exist. Ask the user whether they want any of the default-hidden credits shown, or anything else hidden, and apply their answer with the action. Never edit source code to change the exclusion list.

## 6. Set the daily refresh (recommended)

Create a scheduled job (cron) that runs every morning and invokes the app's refresh: it pulls only the **last 30 days** from Plaid, diffs against stored postings by transaction ID, and merges — never deletes. Attribution is by transaction date: for every posting, pass the Plaid `authorized_date` as `transactionDate` alongside the posted `date` (the app buckets by `transactionDate`; a re-import may correct a stored transaction date in place). The job should stay silent unless the refresh fails.

Optionally also offer a monthly reminder (e.g. on the 24th) summarizing credits that will expire at the end of the current period with a remaining balance. Only create it if the user says yes.

## Ground rules

- Never delete stored postings during a refresh. The store only grows.
- Never place orders, book anything, or spend a credit on the user's behalf. This app observes; it does not transact.
- The user's data stays in their workspace. Do not copy it anywhere else.
