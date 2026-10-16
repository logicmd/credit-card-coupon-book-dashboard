// The Refer button's prompt: a fixed, data-free invitation. A friend pastes
// it into their own Muse, which builds them their OWN private dashboard
// from the public repo and connects THEIR OWN Plaid. It contains no account
// data and grants no access to this dashboard instance — keep it that way.
// It deliberately carries no setup steps: the repo's SETUP_FOR_MUSE.md
// playbook does all the guiding. The wording is pinned verbatim by
// tests/refer-prompt.test.ts.
export const REFER_PROMPT = `Muse, set up my own Credit Card Coupon Book dashboard from this repo: https://github.com/yextyk/credit-card-coupon-book-dashboard — read SETUP_FOR_MUSE.md and follow it to build the app and connect my own accounts.`;
