import { describe, expect, test } from "bun:test";
import {
  catalogFor,
  isCreditPostingName,
  matchCreditForPosting,
  suspectedDuplicatesFor,
} from "../server/src/actions";

describe("matchCreditForPosting — posting name to credit auto-mapping", () => {
  const credits = [
    { name: "Flight Credit", matchPattern: "flight credit" },
    { name: "Hilton Resort Credit", matchPattern: "hilton" },
    { name: "Patternless Credit", matchPattern: "" },
  ];

  test("matches a substring of the posting name, case-insensitively", () => {
    expect(matchCreditForPosting(credits, "AMEX Flight Credit")?.name).toBe("Flight Credit");
    expect(matchCreditForPosting(credits, "amex FLIGHT credit")?.name).toBe("Flight Credit");
    expect(matchCreditForPosting(credits, "Hilton")?.name).toBe("Hilton Resort Credit");
  });

  test("the first matching credit wins when several patterns match", () => {
    const overlapping = [
      { name: "Generic Credit", matchPattern: "credit" },
      { name: "Flight Credit", matchPattern: "flight credit" },
    ];
    expect(matchCreditForPosting(overlapping, "AMEX Flight Credit")?.name).toBe("Generic Credit");
    // Reversed order reverses the winner — order comes from the catalog seed.
    expect(matchCreditForPosting([...overlapping].reverse(), "AMEX Flight Credit")?.name).toBe(
      "Flight Credit",
    );
  });

  test("a credit with an empty pattern never matches", () => {
    const only = [{ name: "Patternless Credit", matchPattern: "" }];
    expect(matchCreditForPosting(only, "Patternless Credit")).toBeUndefined();
    expect(matchCreditForPosting(only, "anything at all")).toBeUndefined();
  });

  test("no match returns undefined (posting stays unassigned)", () => {
    expect(matchCreditForPosting(credits, "Mystery Statement Credit")).toBeUndefined();
    expect(matchCreditForPosting([], "AMEX Flight Credit")).toBeUndefined();
  });

  test("Hyatt's generic 'CREDIT ADJUSTMENT' posting matches on the Hyatt account only", () => {
    // Matching is scoped to the account's own credits: the Hyatt Business
    // catalog carries the "credit adjustment" pattern, so the generic
    // posting name resolves there — and nowhere else.
    const asCredits = (accountName: string) =>
      (catalogFor(accountName) ?? []).map((d) => ({ name: d.name, matchPattern: d.pattern }));
    expect(matchCreditForPosting(asCredits("World of Hyatt Business Credit Card"), "CREDIT ADJUSTMENT")?.name).toBe(
      "Hyatt Credit",
    );
    expect(matchCreditForPosting(asCredits("Business Platinum Card®"), "CREDIT ADJUSTMENT")).toBeUndefined();
    expect(matchCreditForPosting(asCredits("Hilton Honors Aspire Card"), "CREDIT ADJUSTMENT")).toBeUndefined();
  });
});

describe("matchCreditForPosting — amount-capped patterns (Aspire 'Hilton' postings)", () => {
  // Amex posts BOTH Hilton Aspire credits with the bare name "Hilton".
  // The Flight Credit pays at most $50 per posting, so it carries an
  // amount cap of 50; the Resort Credit is uncapped and takes the rest.
  const aspireCredits = () =>
    (catalogFor("Hilton Honors Aspire Card") ?? []).map((d) => ({
      name: d.name,
      matchPattern: d.pattern,
      matchAmount: d.matchAmount ?? null,
    }));

  test("a $50 'Hilton' posting goes to the Flight Credit", () => {
    expect(matchCreditForPosting(aspireCredits(), "Hilton", 50)?.name).toBe("Flight Credit");
  });

  test("a partial $20 'Hilton' posting still goes to the Flight Credit (under the cap)", () => {
    expect(matchCreditForPosting(aspireCredits(), "Hilton", 20)?.name).toBe("Flight Credit");
  });

  test("a $200 'Hilton' posting goes to the Resort Credit, never the capped Flight Credit", () => {
    expect(matchCreditForPosting(aspireCredits(), "Hilton", 200)?.name).toBe(
      "Hilton Resort Credit",
    );
  });

  test("a $150 'Hilton' posting (partial resort stay) goes to the Resort Credit", () => {
    expect(matchCreditForPosting(aspireCredits(), "Hilton", 150)?.name).toBe(
      "Hilton Resort Credit",
    );
  });

  test("a reversal (-$50) of the Flight Credit still matches it", () => {
    expect(matchCreditForPosting(aspireCredits(), "Hilton", -50)?.name).toBe("Flight Credit");
  });

  test("an unknown 'Hilton'-free name stays unassigned", () => {
    expect(matchCreditForPosting(aspireCredits(), "Mystery Statement Credit", 50)).toBeUndefined();
  });

  test("without an amount, the first pattern hit wins (backward compatible)", () => {
    const credits = [
      { name: "Flight Credit", matchPattern: "hilton", matchAmount: 50 },
      { name: "Hilton Resort Credit", matchPattern: "hilton", matchAmount: null },
    ];
    expect(matchCreditForPosting(credits, "Hilton")?.name).toBe("Flight Credit");
  });

  test("a capped credit never takes a posting above its cap, even when listed first", () => {
    const credits = [
      { name: "Flight Credit", matchPattern: "hilton", matchAmount: 50 },
      { name: "Hilton Resort Credit", matchPattern: "hilton", matchAmount: null },
    ];
    expect(matchCreditForPosting(credits, "Hilton", 200)?.name).toBe("Hilton Resort Credit");
    // And when nothing uncapped shares the pattern, the posting stays unassigned.
    const onlyCapped = [{ name: "Flight Credit", matchPattern: "hilton", matchAmount: 50 }];
    expect(matchCreditForPosting(onlyCapped, "Hilton", 200)).toBeUndefined();
  });
});

describe("isCreditPostingName — the import keep-rule for Plaid transaction names", () => {
  test("names containing 'credit' are kept", () => {
    expect(isCreditPostingName("AMEX Airline Credit")).toBe(true);
    expect(isCreditPostingName("CREDIT ADJUSTMENT")).toBe(true);
  });

  test("the bare name 'Hilton' is kept", () => {
    expect(isCreditPostingName("Hilton")).toBe(true);
  });

  test("names containing 'reimbursement' are kept (Amex airline fee credits)", () => {
    expect(isCreditPostingName("AMEX Airline Fee Reimbursement")).toBe(true);
    expect(isCreditPostingName("amex airline fee reimbursement")).toBe(true);
  });

  test("ordinary purchases are not kept", () => {
    expect(isCreditPostingName("Whole Foods Market")).toBe(false);
    expect(isCreditPostingName("Hilton Hotels")).toBe(false);
    expect(isCreditPostingName("Delta Air Lines")).toBe(false);
  });
});

describe("suspectedDuplicatesFor — duplicate suspicion is a flag, never a guess acted on", () => {
  // SEMANTICS CHANGED (fix package): duplicates used to be GUESSED at
  // import from name + balance + limit and auto-ignored. Now suspicion
  // is computed from product + mask (balance is irrelevant — it drifts)
  // plus import-recorded transaction evidence, and it only ever FLAGS
  // accounts for the user to resolve. FIFTH-DIGIT EXTENSION: the
  // heuristic compares EFFECTIVE endings (the recorded fifth digit
  // counts) and is scoped within one owner — the owner label already
  // distinguishes two people's same-ending cards, so they never flag
  // each other on the heuristic. Transaction evidence, the stronger
  // signal, still applies regardless of owner.
  const acct = (
    id: number,
    name: string,
    mask: string,
    ignored = 0,
    extra: { owner?: string | null; fifthDigit?: string } = {},
  ) => ({
    id,
    name,
    mask,
    ignored,
    owner: extra.owner === undefined ? "A" : extra.owner,
    fifthDigit: extra.fifthDigit ?? "",
  });

  test("same product + mask suspects both records of each other", () => {
    const accounts = [
      acct(1, "Hilton Honors Aspire Card", "1111"),
      acct(2, "Hilton Honors Aspire Card", "1111"),
    ];
    const res = suspectedDuplicatesFor(accounts, []);
    expect(res.get(1)).toEqual([2]);
    expect(res.get(2)).toEqual([1]);
  });

  test("same product + mask under DIFFERENT owners is not suspected — the owner label already distinguishes them", () => {
    const accounts = [
      acct(1, "Hilton Honors Aspire Card", "1111", 0, { owner: "A" }),
      acct(2, "Hilton Honors Aspire Card", "1111", 0, { owner: "B" }),
    ];
    expect(suspectedDuplicatesFor(accounts, []).size).toBe(0);
  });

  test("different fifth digits clear the suspicion: the five-digit endings differ", () => {
    const accounts = [
      acct(1, "Hilton Honors Aspire Card", "6006", 0, { fifthDigit: "2" }),
      acct(2, "Hilton Honors Aspire Card", "6006", 0, { fifthDigit: "7" }),
    ];
    expect(suspectedDuplicatesFor(accounts, []).size).toBe(0);
  });

  test("the SAME fifth digit keeps the suspicion: the effective endings still agree", () => {
    const accounts = [
      acct(1, "Hilton Honors Aspire Card", "6006", 0, { fifthDigit: "2" }),
      acct(2, "Hilton Honors Aspire Card", "6006", 0, { fifthDigit: "2" }),
    ];
    const res = suspectedDuplicatesFor(accounts, []);
    expect(res.get(1)).toEqual([2]);
    expect(res.get(2)).toEqual([1]);
  });

  test("recording just one card's digit already separates it from the unrecorded twin", () => {
    const accounts = [
      acct(1, "Hilton Honors Aspire Card", "6006", 0, { fifthDigit: "2" }),
      acct(2, "Hilton Honors Aspire Card", "6006"),
    ];
    expect(suspectedDuplicatesFor(accounts, []).size).toBe(0);
  });

  test("transaction evidence still suspects a pair across owners — it is the stronger signal", () => {
    const accounts = [
      acct(1, "Hilton Honors Aspire Card", "1111", 0, { owner: "A" }),
      acct(2, "Hilton Honors Aspire Card", "2222", 0, { owner: "B" }),
    ];
    const res = suspectedDuplicatesFor(accounts, [[1, 2]]);
    expect(res.get(1)).toEqual([2]);
    expect(res.get(2)).toEqual([1]);
  });

  test("same product with a different mask is not suspected (two holders, one product)", () => {
    const accounts = [
      acct(1, "Hilton Honors Aspire Card", "1111"),
      acct(2, "Hilton Honors Aspire Card", "2222"),
    ];
    expect(suspectedDuplicatesFor(accounts, []).size).toBe(0);
  });

  test("an empty mask never suspects (nothing to key on)", () => {
    const accounts = [
      acct(1, "Hilton Honors Aspire Card", ""),
      acct(2, "Hilton Honors Aspire Card", ""),
    ];
    expect(suspectedDuplicatesFor(accounts, []).size).toBe(0);
  });

  test("name matching is case-insensitive and trimmed", () => {
    const accounts = [
      acct(1, "hilton honors aspire card ", "1111"),
      acct(2, "Hilton Honors Aspire Card", "1111"),
    ];
    expect(suspectedDuplicatesFor(accounts, []).get(1)).toEqual([2]);
  });

  test("transaction evidence suspects both sides of the pair, whatever the masks", () => {
    const accounts = [
      acct(1, "Hilton Honors Aspire Card", "1111"),
      acct(2, "Hilton Honors Aspire Card", "9999"),
    ];
    const res = suspectedDuplicatesFor(accounts, [[2, 1]]);
    expect(res.get(1)).toEqual([2]);
    expect(res.get(2)).toEqual([1]);
  });

  test("ignored accounts take no part — a settled decision is not re-flagged", () => {
    const accounts = [
      acct(1, "Hilton Honors Aspire Card", "1111"),
      acct(2, "Hilton Honors Aspire Card", "1111", 1),
    ];
    expect(suspectedDuplicatesFor(accounts, [[1, 2]]).size).toBe(0);
  });
});
