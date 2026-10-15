import { describe, expect, test } from "bun:test";
import {
  catalogFor,
  DEFAULT_OWNER_LABELS,
  isExcludedName,
  isPinnedCredit,
  ownerLabelFor,
} from "../server/src/actions";

describe("catalogFor — product detection", () => {
  test("Business Platinum gets the business catalog (checked before generic Platinum)", () => {
    const defs = catalogFor("Business Platinum Card®");
    expect(defs).not.toBeNull();
    const names = defs!.map((d) => d.name);
    expect(names).toContain("Dell Credit");
    expect(names).toContain("Wireless Credit");
    expect(names).not.toContain("Resy Credit");
  });

  test("Aspire gets flight + resort credits", () => {
    const defs = catalogFor("Hilton Honors Aspire Card")!;
    expect(defs).toEqual([
      expect.objectContaining({ name: "Flight Credit", amount: 50, period: "quarterly" }),
      expect.objectContaining({ name: "Hilton Resort Credit", amount: 200, period: "semiannual" }),
    ]);
  });

  test("Brilliant gets the monthly dining credit", () => {
    const defs = catalogFor("Marriott Bonvoy Brilliant® American Express® Card")!;
    expect(defs[0]).toEqual(
      expect.objectContaining({ name: "Dining Credit", amount: 25, period: "monthly" }),
    );
  });

  test("Business Gold gets the flexible business credit", () => {
    const defs = catalogFor("Business Gold Card")!;
    expect(defs).toEqual([
      expect.objectContaining({ name: "Flexible Business Credit", amount: 20, period: "monthly" }),
    ]);
  });

  test("co-branded Platinum variants fall through to the personal Platinum catalog", () => {
    const defs = catalogFor("Morgan Stanley Platinum Card®")!;
    const names = defs.map((d) => d.name);
    expect(names).toContain("Resy Credit");
    expect(names).toContain("Lululemon Credit");
    expect(names).not.toContain("Dell Credit");
  });

  test("cards without a coupon-book catalog return null", () => {
    expect(catalogFor("Blue Business Plus Card")).toBeNull();
    expect(catalogFor("Generic Store Card")).toBeNull();
    expect(catalogFor("Amex EveryDay® Card")).toBeNull();
  });

  test("matching is case-insensitive", () => {
    expect(catalogFor("hilton honors aspire card")).not.toBeNull();
    expect(catalogFor("BUSINESS GOLD CARD")).not.toBeNull();
  });
});

describe("isExcludedName — display exclusion list", () => {
  test("excludes the seven hidden benefit families", () => {
    for (const name of [
      "ChatGPT Business Credit",
      "AMEX Indeed Credit",
      "Adobe Acrobat Credit",
      "CLEAR+ Credit",
      "Equinox Credit",
      "Digital Entertainment Credit",
      "Walmart+ Credit",
    ]) {
      expect(isExcludedName(name)).toBe(true);
    }
  });

  test("matching is case-insensitive substring matching", () => {
    expect(isExcludedName("amex chatgpt business credit")).toBe(true);
    expect(isExcludedName("ENTERTAINMENT CREDIT")).toBe(true);
  });

  test("ordinary credits are not excluded", () => {
    for (const name of [
      "Flight Credit",
      "Hilton Resort Credit",
      "Dining Credit",
      "Wireless Credit",
      "Flexible Business Credit",
      "Airline Fee Credit",
    ]) {
      expect(isExcludedName(name)).toBe(false);
    }
  });
});

describe("isPinnedCredit — always-displayed credits", () => {
  test("flexible business and wireless credits are pinned", () => {
    expect(isPinnedCredit("Flexible Business Credit")).toBe(true);
    expect(isPinnedCredit("AMEX Wireless Credit")).toBe(true);
  });

  test("other credits are not pinned", () => {
    expect(isPinnedCredit("Dining Credit")).toBe(false);
    expect(isPinnedCredit("Flight Credit")).toBe(false);
  });
});

describe("ownerLabelFor — login label resolution", () => {
  const labels: [string, string] = ["Alex", "Sam"];

  test("keys A and B resolve to the configured labels", () => {
    expect(ownerLabelFor("A", labels)).toBe("Alex");
    expect(ownerLabelFor("B", labels)).toBe("Sam");
  });

  test("missing owner stays null", () => {
    expect(ownerLabelFor(null, labels)).toBeNull();
    expect(ownerLabelFor("", labels)).toBeNull();
  });

  test("a stored value that is not a key passes through verbatim (it is already a label)", () => {
    expect(ownerLabelFor("Alex", labels)).toBe("Alex");
  });

  test("defaults are neutral login names", () => {
    expect(DEFAULT_OWNER_LABELS).toEqual(["Login 1", "Login 2"]);
    expect(ownerLabelFor("A", DEFAULT_OWNER_LABELS)).toBe("Login 1");
  });
});
