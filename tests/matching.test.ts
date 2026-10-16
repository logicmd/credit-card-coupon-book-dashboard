import { describe, expect, test } from "bun:test";
import {
  catalogFor,
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

describe("suspectedDuplicatesFor — duplicate suspicion is a flag, never a guess acted on", () => {
  // SEMANTICS CHANGED (fix package): duplicates used to be GUESSED at
  // import from name + balance + limit and auto-ignored. Now suspicion
  // is computed from product + mask (balance is irrelevant — it drifts)
  // plus import-recorded transaction evidence, and it only ever FLAGS
  // accounts for the user to resolve.
  const acct = (id: number, name: string, mask: string, ignored = 0) => ({
    id,
    name,
    mask,
    ignored,
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
