# Setup playbook for Muse

You are setting up the Credit Card Coupon Book Dashboard for your user from this repository. Follow these steps in order. Do not skip the questions in steps 3 and 5.

## 1. Create the app

Create a private web artifact (full-stack) in the user's workspace with slug `credit-card-coupon-book-dashboard`, using the source in this repository (`client/`, `server/`, `drizzle/`, `package.json`) as the app's code. Do not invent a different implementation — the value of this repo is its tested data logic (merge-only import, transaction-date attribution, catalog matching).

If the user already has an artifact with that slug, stop and ask before replacing anything.

## 2. Connect Plaid

The app's data comes from the Plaid connector. Check whether the user has Plaid connected; if not, walk them through connecting it and linking their American Express login(s). Households commonly have **two** Amex logins (e.g. the user and their spouse) — link both if they exist, and expect up to one login per person per issuer overall. If the user also holds Chase cards with coupon-book credits (Sapphire Preferred, World of Hyatt Business, IHG One Rewards Premier, Ritz-Carlton), link the Chase login too — the catalog covers those products, including their anniversary-year cycles.

Supported cards are exactly the nine listed under "Supported cards (verified)" in the README — "verified" means the card has catalog definitions in this repo **and** unit tests pinning them down. Any other card is not yet supported — in particular, Chase United cards (e.g. United Explorer) have not been verified: their accounts may appear via Plaid, but no credits are tracked for them. If the user wants another card supported, that is a contribution: add its catalog definitions **and** unit tests, run `bun test` and `bun run typecheck`, and open a pull request (see "Contributing" in the README) — do not improvise a catalog entry without tests.

Do not ask for, accept, or store Amex usernames/passwords yourself. The connection happens through the connector's own flow.

If Plaid turns out not to be connected at all, stop here: run the Plaid connector's status check, post the connect link it gives you, and wait for the user to finish linking before doing anything else — then check status again before importing. Never substitute the repo's fictional test fixtures, sample data, or hand-typed numbers for a real connection; a dashboard built on invented data is worse than no dashboard. Linking additional institutions (a spouse's login, a Chase login) uses the connector's add-account flow — one institution per link session — so repeat it once per login.

A linked login can also stop working later: banks periodically require re-authentication, and a login in that state returns no data. That surfaces during refresh, not setup — see step 6 for how to spot it and what to tell the user.

## 3. Ask: whose logins are these?

Every account carries an owner key, and the key names a **person, not a login**. Only two keys have display labels — `A` and `B` (defaults "Login 1" / "Login 2"). A person with logins at two issuers (their own Amex login **and** their own Chase login) uses the **same key for both**; the dashboard groups that person's cards by issuer under the one label. Households commonly link three or four logins (two people × Amex + Chase) — map every login to one of the two people, and never invent extra keys (`C`, `D`, …): accounts carrying an unknown key surface under "login not identified yet" with no label. A one-person household simply uses `A` for everything.

Ask the user whose each login is and what label each person should get — typically their first name and their spouse's first name. Save the answers with the `setOwnerLabels` action (meta keys `ownerALabel` / `ownerBLabel`); the user can also edit them later in the page's Cards section ("Login labels").

**Timing: labels do not have to be settled before the first import.** They are plain meta values and can be set or corrected at any time. It is often easier after the import in step 4, when the accounts are visible — a distinctive card in a login (e.g. a Morgan Stanley Platinum) often settles whose login it is. What has to be right is the owner key on each account: the importer tags accounts by institution grouping in order (first grouping `A`, second `B`), which is only a shorthand for the common two-login case. After the first import, check every account's owner in `getDashboard`; if a login landed under the wrong person, correct it with a follow-up `importSnapshot` that passes those accounts with the right `owner` values (import updates a stored account's owner), then re-check.

Within one person, cards are told apart by the automatic product prefix (Aspire, BusPlat, BusGold, …), the card name, and the mask (··1234). There is no per-account nickname setting in the app, so do not promise one — two cards of the same product under the same person are distinguished by their masks.

Never hardcode names into code. Labels live in app meta only.

## 4. First import (bootstrap) and reconciliation

Open the app and trigger `refreshCredits`. With an empty database it performs a bootstrap pull from **January 1 of the current year** to today, imports all accounts and credit postings, and records the coverage start.

How many accounts appear varies by household — every card record on every linked login shows up before dedup. Supplementary (authorized-user) records whose transactions are a strict subset of a primary account are ignored automatically; exact duplicate records across logins are collapsed.

Then pull `getDashboard` and reconcile before telling the user setup is done. Report:

- **Accounts per person** — how many tracked cards sit under each login label, how many records were ignored as duplicates, and any account sitting under "login not identified yet" (its owner key is missing or wrong — fix it per step 3 before going further).
- **The headline numbers** — total unused (`totals.remainingNow`) and how many open credits it spans. Expect the same product on both people's cards (two Sapphire Preferreds, two sets of Aspires) whenever both hold it: that is normal — the rows are the same credit name told apart by owner label and mask, and the totals combine both people by design.
- **Anniversary anchors** — the Sapphire Preferred hotel credit and the World of Hyatt Business credit are seeded with the catalog's **default anchor, May 1**. That date is a placeholder, not something read from the user's account: if a card's real anniversary falls in a different month, its credit year runs on the wrong dates until corrected. Ask for each such card's anniversary month and fix the anchor on that credit — the credit's edit form in the page ("Anniversary anchor"), or `updateCredit` with `anchorMonth` / `anchorDay`. Anchors are per credit, so the two people's cards can legitimately differ.
- **Credits showing $0 used that the user expected to see used** — check the credit's `currentPostings` and compare its `matchPattern` against the actual posting names (the Agent Markdown lists each credit's postings). The usual cause is a posting name the pattern does not match; fix the pattern on the credit (`updateCredit`) rather than adjusting any amounts.
- **Unassigned postings** — say how many entries sit in `getDashboard`'s `unassigned` list. Postings belonging to the synthesized families (ChatGPT Business and the other default-hidden ones) are already counted automatically at read time and never appear there; what remains is genuinely unmatched. Walk through it with the user: attach a stray posting to its credit with `assignPosting`, and if a recurring credit the catalog does not know keeps stranding postings, add it with `addCredit` (name + match pattern) so future imports file its postings automatically.
- **Enrollment** — tracking is not enrollment. Some credits only pay out after the holder activates them with the issuer: read the visible credits' `note` fields and list for the user the ones that say so (e.g. ChatGPT Business enrolls separately per card; Resy, Equinox, Digital Entertainment, and Walmart+ require enrollment; the airline fee credit needs an airline selected first; the Ritz-Carlton travel credit is claimed manually after the purchase). The dashboard tracks these credits either way — until the user enrolls, the money simply never posts. Each credit carries an `enrolled` flag, flippable in the page or via `updateCredit`; credits flagged not-enrolled are called out in the page and in the Agent Markdown, so use the flag to track which enrollments are still outstanding.

## 5. Ask: which credits to hide?

Some credits are hidden by default — the built-in list covers ChatGPT Business, Indeed, Adobe, CLEAR+, Equinox, Digital Entertainment, Walmart+, and Instacart. Hidden credits never appear on the dashboard and never count in any total. They do not need a stored database row to exist: the dashboard synthesizes every catalog credit for every account at read time (a stored row, when present, supplies the saved state and its postings still count as assigned), so removing a credit's entry from the preference below always brings it back — even on accounts imported before that credit family was tracked.

Hiding is a **stored preference, not a code setting**: it lives in the app's meta table under the key `excludedCredits` (a JSON list of lowercase name patterns). The user can change it themselves in the web page's Display settings section (one toggle per hideable family) or by asking you in chat — both paths go through the same two actions below, and a selection the user saves is authoritative (the built-in defaults only apply until something is stored):

- Read the current list with the `getPreferences` action. (When nothing has ever been stored, it returns the built-in defaults.)
- Change it with the `setExcludedCredits` action, passing the **complete** new list — it replaces the stored one, it does not append. To show a hidden credit again, resend the list without its entry; to hide another credit, add its name. An empty list shows everything.
- Entries are matched as case-insensitive substrings of credit names and are validated against the catalog and the credits stored in the database — an unknown name is rejected, so if a call fails, compare the spelling against `getDashboard` or the catalog before retrying.

The change takes effect immediately — in the dashboard, and in the Agent Markdown export, which names the hidden credits under "Hidden by preference" so you always know they exist. Ask the user whether they want any of the default-hidden credits shown, or anything else hidden, and apply their answer with the action. Never edit source code to change the exclusion list.

## 6. Set the daily refresh (recommended)

Create a scheduled job (cron) that runs every morning and invokes the app's refresh: it pulls only the **last 30 days** from Plaid, diffs against stored postings by transaction ID, and merges — never deletes. Attribution is by transaction date: for every posting, pass the Plaid `authorized_date` as `transactionDate` alongside the posted `date` (the app buckets by `transactionDate`; a re-import may correct a stored transaction date in place). The job should stay silent while refreshes succeed — with one exception that must never stay silent: a login that needs re-authentication. When a Plaid login drops out, the refresh imports with `complete: false`: whatever could be read still merges, but `lastImportAt` does not advance and the next run retries a wider window instead of the 30-day one. If a refresh reports Plaid not connected or a login failing — or `getDashboard` shows `lastImportAt` no longer advancing day to day — tell the user promptly which login is affected and that they need to re-authenticate it through the Plaid connector (the status / connect flow from step 2). Do not let the job retry in silence for weeks: the dashboard will look calm while quietly going stale.

Optionally also offer a monthly reminder (e.g. on the 24th) summarizing credits that will expire at the end of the current period with a remaining balance. Only create it if the user says yes.

## Ground rules

- Never delete stored postings during a refresh. The store only grows.
- Never place orders, book anything, or spend a credit on the user's behalf. This app observes; it does not transact.
- The user's data stays in their workspace. Do not copy it anywhere else.
