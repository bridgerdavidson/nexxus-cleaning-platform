import { describe, expect, it } from "vitest";
import {
  deriveCleaners,
  matchesCleanerSearch,
  sortCleaners,
  type CleanersCleaner,
} from "./deriveCleaners";

const cleaner = (over: Partial<CleanersCleaner> = {}): CleanersCleaner => ({
  first_name: "Jane",
  last_name: "Smith",
  email: "jane@example.com",
  phone: "555-0100",
  created_at: "2026-06-01T00:00:00Z",
  deactivated_at: null,
  upcoming_this_week: 2,
  cleaner_earnings: 100,
  ...over,
});

describe("matchesCleanerSearch", () => {
  it("empty query matches everything", () => {
    expect(matchesCleanerSearch(cleaner(), "")).toBe(true);
    expect(matchesCleanerSearch(cleaner(), "   ")).toBe(true);
  });

  it("matches name, email, and phone (case-insensitive)", () => {
    expect(matchesCleanerSearch(cleaner(), "jane")).toBe(true);
    expect(matchesCleanerSearch(cleaner(), "SMITH")).toBe(true);
    expect(matchesCleanerSearch(cleaner(), "example.com")).toBe(true);
    expect(matchesCleanerSearch(cleaner(), "555")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(matchesCleanerSearch(cleaner(), "zzz")).toBe(false);
  });

  it("tolerates a missing name/phone (matches on email only)", () => {
    const noName = cleaner({ first_name: null, last_name: null, phone: null, email: "user@host.test" });
    expect(matchesCleanerSearch(noName, "jane")).toBe(false);
    expect(matchesCleanerSearch(noName, "host.test")).toBe(true);
  });
});

describe("sortCleaners", () => {
  const a = cleaner({ first_name: "Aaron", last_name: "Lee", created_at: "2026-01-01T00:00:00Z", upcoming_this_week: 1, cleaner_earnings: 50 });
  const b = cleaner({ first_name: "Beth", last_name: "Ng", created_at: "2026-03-01T00:00:00Z", upcoming_this_week: 5, cleaner_earnings: 300 });
  const c = cleaner({ first_name: "Cara", last_name: "Oh", created_at: "2026-02-01T00:00:00Z", upcoming_this_week: 3, cleaner_earnings: 150 });

  it("name = A to Z by full name", () => {
    expect(sortCleaners([c, a, b], "name").map((x) => x.first_name)).toEqual(["Aaron", "Beth", "Cara"]);
  });

  it("load = most jobs this week first", () => {
    expect(sortCleaners([a, b, c], "load").map((x) => x.first_name)).toEqual(["Beth", "Cara", "Aaron"]);
  });

  it("earnings = highest earnings first", () => {
    expect(sortCleaners([a, b, c], "earnings").map((x) => x.first_name)).toEqual(["Beth", "Cara", "Aaron"]);
  });

  it("recent = newest created_at first", () => {
    expect(sortCleaners([a, b, c], "recent").map((x) => x.first_name)).toEqual(["Beth", "Cara", "Aaron"]);
  });

  it("does not mutate the input array", () => {
    const input = [a, b, c];
    sortCleaners(input, "earnings");
    expect(input.map((x) => x.first_name)).toEqual(["Aaron", "Beth", "Cara"]);
  });
});

describe("deriveCleaners", () => {
  const jane = cleaner({ first_name: "Jane", last_name: "Smith", cleaner_earnings: 100, created_at: "2026-02-01T00:00:00Z" });
  const aaron = cleaner({
    first_name: "Aaron",
    last_name: "Lee",
    email: "aaron@acme.test",
    phone: "555-0200",
    cleaner_earnings: 500,
    created_at: "2026-05-01T00:00:00Z",
  });
  const benched = cleaner({ first_name: "Ben", last_name: "Ched", email: "ben@x.test", deactivated_at: "2026-06-10T00:00:00Z" });

  it("hides benched cleaners by default", () => {
    const out = deriveCleaners([jane, aaron, benched], { search: "", sort: "name" });
    expect(out.map((x) => x.first_name)).toEqual(["Aaron", "Jane"]);
  });

  it("includes benched cleaners when showBenched is true", () => {
    const out = deriveCleaners([jane, aaron, benched], { search: "", sort: "name", showBenched: true });
    expect(out.map((x) => x.first_name)).toEqual(["Aaron", "Ben", "Jane"]);
  });

  it("filters by search then sorts", () => {
    const out = deriveCleaners([jane, aaron], { search: "acme", sort: "name" });
    expect(out).toHaveLength(1);
    expect(out[0].first_name).toBe("Aaron");
  });

  it("returns all active when the search is empty, sorted by earnings", () => {
    const out = deriveCleaners([jane, aaron], { search: "", sort: "earnings" });
    expect(out.map((x) => x.first_name)).toEqual(["Aaron", "Jane"]);
  });
});
