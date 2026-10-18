// Fictional fixtures for the test suite.
//
// Everything in this file is invented: the people ("Alex" and "Sam"), the
// card masks (··1111 etc.), the Plaid-style ids ("fake-..."), balances, and
// amounts are made up. Posting names are modeled on the public Amex benefit
// catalog (e.g. Amex posts both Hilton Aspire credits with the bare name
// "Hilton" on real statements — the quarterly Flight Credit and the
// semiannual Resort Credit are told apart by amount), but no value here
// comes from any real account.

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

export const ALEX_BIZ_GOLD = {
  plaidAccountId: "fake-alex-bizgold-1212",
  name: "Business Gold Card",
  mask: "1212",
  balance: 0,
  creditLimit: 15000,
  owner: "A",
} as const;

export const SAM_BIZ_GOLD = {
  plaidAccountId: "fake-sam-bizgold-3434",
  name: "Business Gold Card",
  mask: "3434",
  balance: 0,
  creditLimit: 12000,
  owner: "B",
} as const;

export const SAM_STORE_CARD = {
  plaidAccountId: "fake-sam-store-4444",
  name: "Generic Store Card",
  mask: "4444",
  balance: 15,
  creditLimit: 2000,
  owner: "B",
} as const;

// Sam's co-branded personal Platinum (fictional id/mask, like everything
// in this file). It carries the clawback cases in import.test.ts, whose
// posting names, amounts, and date sequences are the owner's real
// Morgan Stanley Platinum records (used at the owner's direction) — the
// account identity here stays fictional.
export const SAM_MS_PLATINUM = {
  plaidAccountId: "fake-sam-msplat-5555",
  name: "Morgan Stanley Platinum Card",
  mask: "5555",
  balance: 0,
  creditLimit: 10000,
  owner: "B",
} as const;

// Alex's Chase cards (fictional ids/masks, like everything in this file).
export const ALEX_SAPPHIRE = {
  plaidAccountId: "fake-alex-sapphire-6666",
  name: "Chase Sapphire Preferred®",
  mask: "6666",
  balance: 0,
  creditLimit: 5000,
  owner: "A",
} as const;

export const ALEX_HYATT_BIZ = {
  plaidAccountId: "fake-alex-hyattbiz-7777",
  name: "World of Hyatt Business Credit Card",
  mask: "7777",
  balance: 0,
  creditLimit: 9000,
  owner: "A",
} as const;

export const ALEX_IHG_PREMIER = {
  plaidAccountId: "fake-alex-ihg-8888",
  name: "IHG One Rewards Premier Credit Card",
  mask: "8888",
  balance: 0,
  creditLimit: 4000,
  owner: "A",
} as const;

export const ALEX_RITZ = {
  plaidAccountId: "fake-alex-ritz-9999",
  name: "The Ritz-Carlton® Credit Card",
  mask: "9999",
  balance: 0,
  creditLimit: 10000,
  owner: "A",
} as const;

// Alex's U.S. Bank card. The name here carries the product (some reads
// do); real U.S. Bank accounts usually arrive with a generic Plaid name
// ("Credit Card - 7536") instead, which deliberately matches NO catalog
// — see tests/usbank.test.ts for both halves of that story.
export const ALEX_ALTITUDE_RESERVE = {
  plaidAccountId: "fake-alex-altitude-4321",
  name: "U.S. Bank Altitude® Reserve Visa Infinite® Card",
  mask: "4321",
  balance: 0,
  creditLimit: 10000,
  owner: "A",
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
      name: "Hilton",
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
