import { describe, expect, test } from "bun:test";
import { groupCredits, type GroupableCredit } from "../client/src/grouping";

let nextId = 1;
function credit(overrides: Partial<GroupableCredit> = {}): GroupableCredit {
  nextId += 1;
  return {
    name: "Flight Credit",
    period: "quarterly",
    periodLabel: "Q4 2026",
    periodEnd: "2026-12-31",
    daysLeft: 77,
    amount: 50,
    currentUsed: 0,
    currentRemaining: 50,
    owner: "Alex",
    enrolled: true,
    ...overrides,
  };
}

describe("groupCredits — merging the same credit type across cards", () => {
  test("same name + period + window merges across cards and across logins", () => {
    const groups = groupCredits([
      credit({ owner: "Alex", currentUsed: 50, currentRemaining: 0 }),
      credit({ owner: "Sam", currentUsed: 20, currentRemaining: 30 }),
      credit({ owner: "Sam", currentUsed: 0, currentRemaining: 50 }),
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.amount).toBe(150);
    expect(g.used).toBe(70);
    expect(g.remaining).toBe(80);
    expect(g.members).toHaveLength(3);
    // Both logins appear on the one combined entry — totals are never split by login.
    expect(g.owners).toEqual(["Alex", "Sam"]);
  });

  test("members are sorted by remaining, largest first", () => {
    const groups = groupCredits([
      credit({ currentUsed: 50, currentRemaining: 0 }),
      credit({ currentUsed: 0, currentRemaining: 50 }),
      credit({ currentUsed: 20, currentRemaining: 30 }),
    ]);
    expect(groups[0]!.members.map((m) => m.currentRemaining)).toEqual([50, 30, 0]);
  });

  test("same name in a different period window does NOT merge", () => {
    const groups = groupCredits([
      credit({ periodLabel: "Q3 2026", periodEnd: "2026-09-30" }),
      credit({ periodLabel: "Q4 2026", periodEnd: "2026-12-31" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  test("same name with a different period type does NOT merge", () => {
    const groups = groupCredits([
      credit({ period: "quarterly" }),
      credit({ period: "monthly", periodLabel: "October 2026" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  test("name matching ignores case and surrounding whitespace; display name is the first seen", () => {
    const groups = groupCredits([
      credit({ name: "Flight Credit" }),
      credit({ name: "  flight credit " }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.name).toBe("Flight Credit");
    expect(groups[0]!.members).toHaveLength(2);
  });

  test("daysLeft is the minimum across members and notEnrolled counts unenrolled members", () => {
    const groups = groupCredits([
      credit({ daysLeft: 40, enrolled: false }),
      credit({ daysLeft: 12, enrolled: true }),
      credit({ daysLeft: 30, enrolled: false }),
    ]);
    expect(groups[0]!.daysLeft).toBe(12);
    expect(groups[0]!.notEnrolled).toBe(2);
  });

  test("fractional amounts are rounded to cents after summing", () => {
    const groups = groupCredits([
      credit({ amount: 33.33, currentUsed: 11.11, currentRemaining: 22.22 }),
      credit({ amount: 33.33, currentUsed: 11.11, currentRemaining: 22.22 }),
      credit({ amount: 33.33, currentUsed: 11.11, currentRemaining: 22.22 }),
    ]);
    expect(groups[0]!.amount).toBe(99.99);
    expect(groups[0]!.used).toBe(33.33);
    expect(groups[0]!.remaining).toBe(66.66);
  });

  test("null owners are left out of the owners list", () => {
    const groups = groupCredits([credit({ owner: null }), credit({ owner: "Sam" })]);
    expect(groups[0]!.owners).toEqual(["Sam"]);
  });
});

describe("groupCredits — ordering", () => {
  test("groups with remaining balance come before used-up groups", () => {
    const groups = groupCredits([
      credit({ name: "Done Credit", currentUsed: 50, currentRemaining: 0, daysLeft: 5 }),
      credit({ name: "Open Credit", currentUsed: 0, currentRemaining: 50, daysLeft: 90 }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["Open Credit", "Done Credit"]);
  });

  test("among open groups, sooner expiry first, then larger remaining", () => {
    const groups = groupCredits([
      credit({ name: "Later", daysLeft: 60, currentRemaining: 500 }),
      credit({ name: "Sooner Small", daysLeft: 10, currentRemaining: 20 }),
      credit({ name: "Sooner Big", daysLeft: 10, currentRemaining: 200 }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["Sooner Big", "Sooner Small", "Later"]);
  });

  test("empty input gives no groups", () => {
    expect(groupCredits([])).toEqual([]);
  });
});
