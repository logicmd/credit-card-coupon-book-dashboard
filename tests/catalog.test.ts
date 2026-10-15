import { describe, expect, test } from "bun:test";
import {
  catalogFor,
  DEFAULT_OWNER_LABELS,
  isExcludedName,
  isPinnedCredit,
  issuerForAccountName,
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

describe("catalogFor — Chase products", () => {
  test("Sapphire Preferred gets the $50 hotel credit on a May 1 anniversary anchor", () => {
    const defs = catalogFor("Chase Sapphire Preferred®")!;
    expect(defs).toEqual([
      expect.objectContaining({
        name: "Annual Hotel Credit",
        amount: 50,
        period: "annual",
        anchorMonth: 5,
        anchorDay: 1,
        pattern: "annual hotel credit",
      }),
    ]);
  });

  test("World of Hyatt Business gets the $100 credit (2 x $50) on a May 1 anchor", () => {
    const defs = catalogFor("World of Hyatt Business Credit Card")!;
    expect(defs).toEqual([
      expect.objectContaining({
        name: "Hyatt Credit",
        amount: 100,
        period: "annual",
        anchorMonth: 5,
        anchorDay: 1,
        pattern: "credit adjustment",
      }),
    ]);
  });

  test("the personal World of Hyatt card (no 'Business') has no catalog", () => {
    expect(catalogFor("World of Hyatt Credit Card")).toBeNull();
  });

  test("IHG Premier gets the $100 airline credit plus the patternless TravelBank row", () => {
    const defs = catalogFor("IHG One Rewards Premier Credit Card")!;
    expect(defs).toEqual([
      expect.objectContaining({ name: "Airline Credit", amount: 100, period: "annual" }),
      // TravelBank is enrollment-based, not a statement credit: empty
      // pattern so it never auto-matches a posting.
      expect.objectContaining({
        name: "United TravelBank Credit",
        amount: 25,
        period: "semiannual",
        pattern: "",
      }),
    ]);
  });

  test("the non-Premier IHG card has no catalog", () => {
    expect(catalogFor("IHG One Rewards Traveler Credit Card")).toBeNull();
  });

  test("Ritz-Carlton gets the $300 travel credit (manual request, calendar year)", () => {
    const defs = catalogFor("The Ritz-Carlton® Credit Card")!;
    expect(defs).toEqual([
      expect.objectContaining({
        name: "Travel Credit",
        amount: 300,
        period: "annual",
        pattern: "travel credit",
      }),
    ]);
    expect(defs[0]!.anchorMonth).toBeUndefined();
  });
});

describe("issuerForAccountName", () => {
  test("Chase products are Chase", () => {
    for (const name of [
      "Chase Sapphire Preferred®",
      "World of Hyatt Business Credit Card",
      "IHG One Rewards Premier Credit Card",
      "The Ritz-Carlton® Credit Card",
    ]) {
      expect(issuerForAccountName(name)).toBe("Chase");
    }
  });

  test("Amex products (and anything unrecognized) default to Amex", () => {
    expect(issuerForAccountName("Hilton Honors Aspire Card")).toBe("Amex");
    expect(issuerForAccountName("Business Platinum Card®")).toBe("Amex");
    expect(issuerForAccountName("Generic Store Card")).toBe("Amex");
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
