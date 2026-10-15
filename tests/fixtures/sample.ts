// Fictional fixtures for the test suite.
//
// Everything in this file is invented: the people ("Alex" and "Sam"), the
// card masks (··1111 etc.), the Plaid-style ids ("fake-..."), balances, and
// amounts are made up. Posting names are modeled on the public Amex benefit
// catalog (e.g. a flight-credit posting is called "AMEX Flight Credit" on
// real statements), but no value here comes from any real account.

export const ALEX_ASPIRE = {
  plaidAccountId: "fake-alex-aspire-1111",
  name: "Hilton Honors Aspire Card",
  mask: "1111",
  balance: 120.5,
  creditLimit: 10000,
  owner: "A",
} as const;

export const SAM_ASPIRE = {
  plaidAccountId: "fake-sam-aspire-2222",
  name: "Hilton Honors Aspire Card",
  mask: "2222",
  balance: 0,
  creditLimit: 8000,
  owner: "B",
} as const;

export const ALEX_BIZ_PLAT = {
  plaidAccountId: "fake-alex-bizplat-3333",
  name: "Business Platinum Card®",
  mask: "3333",
  balance: 42,
  creditLimit: null,
  owner: "A",
} as const;

export const SAM_STORE_CARD = {
  plaidAccountId: "fake-sam-store-4444",
  name: "Generic Store Card",
  mask: "4444",
  balance: 15,
  creditLimit: 2000,
  owner: "B",
} as const;

/** A complete January snapshot for Alex's two cards. */
export const JANUARY_SNAPSHOT = {
  windowStart: "2026-01-01",
  windowEnd: "2026-01-31",
  complete: true,
  accounts: [ALEX_ASPIRE, ALEX_BIZ_PLAT],
  postings: [
    {
      txnId: "fake-txn-flight-1",
      accountPlaidId: ALEX_ASPIRE.plaidAccountId,
      date: "2026-01-10",
      name: "AMEX Flight Credit",
      amount: 50,
    },
    {
      txnId: "fake-txn-resort-1",
      accountPlaidId: ALEX_ASPIRE.plaidAccountId,
      date: "2026-01-12",
      name: "Hilton",
      amount: 200,
    },
    {
      txnId: "fake-txn-airline-1",
      accountPlaidId: ALEX_BIZ_PLAT.plaidAccountId,
      date: "2026-01-15",
      name: "AMEX Airline Fee Reimbursement",
      amount: 80,
    },
    {
      txnId: "fake-txn-mystery-1",
      accountPlaidId: ALEX_BIZ_PLAT.plaidAccountId,
      date: "2026-01-16",
      name: "Mystery Statement Credit",
      amount: 5,
    },
  ],
} as const;
