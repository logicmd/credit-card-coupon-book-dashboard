import { describe, expect, test } from "bun:test";
import { accountDuplicateKey, matchCreditForPosting } from "../server/src/actions";

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
});

describe("accountDuplicateKey — duplicate account record detection", () => {
  test("same name + non-zero balance + same limit produces a key", () => {
    expect(accountDuplicateKey("Hilton Honors Aspire Card", 300, 5000)).toBe(
      "Hilton Honors Aspire Card|300|5000",
    );
  });

  test("a null limit is part of the key as an empty suffix", () => {
    expect(accountDuplicateKey("Business Platinum Card®", 42, null)).toBe(
      "Business Platinum Card®|42|",
    );
  });

  test("zero or missing balance is never a duplicate key", () => {
    expect(accountDuplicateKey("Hilton Honors Aspire Card", 0, 5000)).toBeNull();
    expect(accountDuplicateKey("Hilton Honors Aspire Card", null, 5000)).toBeNull();
    expect(accountDuplicateKey("Hilton Honors Aspire Card", undefined, 5000)).toBeNull();
  });

  test("different balance or limit means a different key", () => {
    const base = accountDuplicateKey("Hilton Honors Aspire Card", 300, 5000);
    expect(accountDuplicateKey("Hilton Honors Aspire Card", 301, 5000)).not.toBe(base);
    expect(accountDuplicateKey("Hilton Honors Aspire Card", 300, 6000)).not.toBe(base);
  });
});
