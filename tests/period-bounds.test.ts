import { describe, expect, test } from "bun:test";
import { addDays, daysBetween, laDateOf, periodBounds } from "../server/src/actions";

describe("periodBounds — monthly", () => {
  test("mid-month date gives the calendar month", () => {
    expect(periodBounds("monthly", "2026-03-15")).toEqual({
      start: "2026-03-01",
      end: "2026-03-31",
      key: "2026-03",
      label: "March 2026",
    });
  });

  test("February in a non-leap year ends on the 28th", () => {
    const b = periodBounds("monthly", "2026-02-10");
    expect(b.start).toBe("2026-02-01");
    expect(b.end).toBe("2026-02-28");
    expect(b.label).toBe("February 2026");
  });

  test("February in a leap year ends on the 29th", () => {
    expect(periodBounds("monthly", "2024-02-03").end).toBe("2024-02-29");
  });

  test("December ends on the 31st", () => {
    expect(periodBounds("monthly", "2026-12-25").end).toBe("2026-12-31");
  });
});

describe("periodBounds — quarterly", () => {
  test("Q1 runs Jan 1 to Mar 31", () => {
    expect(periodBounds("quarterly", "2026-01-15")).toEqual({
      start: "2026-01-01",
      end: "2026-03-31",
      key: "2026-Q1",
      label: "Q1 2026",
    });
  });

  test("Q2 runs Apr 1 to Jun 30", () => {
    const b = periodBounds("quarterly", "2026-05-20");
    expect(b.start).toBe("2026-04-01");
    expect(b.end).toBe("2026-06-30");
    expect(b.key).toBe("2026-Q2");
    expect(b.label).toBe("Q2 2026");
  });

  test("first and last day of Q3 land in the same window", () => {
    expect(periodBounds("quarterly", "2026-07-01").key).toBe("2026-Q3");
    const b = periodBounds("quarterly", "2026-09-30");
    expect(b.start).toBe("2026-07-01");
    expect(b.end).toBe("2026-09-30");
  });

  test("Q4 ends Dec 31", () => {
    const b = periodBounds("quarterly", "2026-11-30");
    expect(b.start).toBe("2026-10-01");
    expect(b.end).toBe("2026-12-31");
    expect(b.key).toBe("2026-Q4");
  });
});

describe("periodBounds — semiannual", () => {
  test("first half runs Jan 1 to Jun 30", () => {
    expect(periodBounds("semiannual", "2026-03-01")).toEqual({
      start: "2026-01-01",
      end: "2026-06-30",
      key: "2026-H1",
      label: "Jan–Jun 2026",
    });
  });

  test("second half runs Jul 1 to Dec 31", () => {
    expect(periodBounds("semiannual", "2026-09-15")).toEqual({
      start: "2026-07-01",
      end: "2026-12-31",
      key: "2026-H2",
      label: "Jul–Dec 2026",
    });
  });

  test("Jun 30 and Jul 1 fall in different halves", () => {
    expect(periodBounds("semiannual", "2026-06-30").key).toBe("2026-H1");
    expect(periodBounds("semiannual", "2026-07-01").key).toBe("2026-H2");
  });
});

describe("periodBounds — annual", () => {
  test("annual is always the calendar year (no anniversary anchoring)", () => {
    expect(periodBounds("annual", "2026-08-19")).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
      key: "2026",
      label: "2026",
    });
  });
});

describe("daysBetween / addDays", () => {
  test("same day is zero, next day is one", () => {
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(0);
    expect(daysBetween("2026-01-01", "2026-01-02")).toBe(1);
    expect(daysBetween("2026-01-02", "2026-01-01")).toBe(-1);
  });

  test("spans month and year boundaries", () => {
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysBetween("2026-01-31", "2026-03-02")).toBe(30);
  });

  test("addDays rolls over months and years, both directions", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-03-15", 0)).toBe("2026-03-15");
  });

  test("addDays and daysBetween agree", () => {
    expect(daysBetween("2026-04-10", addDays("2026-04-10", 45))).toBe(45);
  });
});

describe("laDateOf", () => {
  test("converts a UTC timestamp to the Los Angeles calendar date", () => {
    // 02:00 UTC is still the previous evening in Los Angeles (UTC-8).
    expect(laDateOf("2026-01-01T02:00:00Z")).toBe("2025-12-31");
    expect(laDateOf("2026-06-15T20:00:00Z")).toBe("2026-06-15");
  });

  test("returns null for unparseable input", () => {
    expect(laDateOf("not a date")).toBe(null);
  });
});
