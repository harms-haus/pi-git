import { describe, it, expect } from "vitest";
import { formatCounts, STATUS_ICONS } from "../constants";

describe("formatCounts", () => {
  it("returns both insertions and deletions when both are positive", () => {
    expect(formatCounts(5, 3)).toEqual(["+5", "-3"]);
  });

  it("returns only insertions when deletions are zero", () => {
    expect(formatCounts(10, 0)).toEqual(["+10"]);
  });

  it("returns only deletions when insertions are zero", () => {
    expect(formatCounts(0, 7)).toEqual(["-7"]);
  });

  it("returns empty array when both are zero", () => {
    expect(formatCounts(0, 0)).toEqual([]);
  });

  it("returns empty array for negative counts", () => {
    expect(formatCounts(-1, -1)).toEqual([]);
  });

  it("returns only insertions when deletions are negative", () => {
    expect(formatCounts(5, -1)).toEqual(["+5"]);
  });

  it("returns only deletions when insertions are negative", () => {
    expect(formatCounts(-1, 5)).toEqual(["-5"]);
  });

  it("handles large numbers", () => {
    expect(formatCounts(1000, 500)).toEqual(["+1000", "-500"]);
  });

  it("handles 1 insertion and 0 deletions", () => {
    expect(formatCounts(1, 0)).toEqual(["+1"]);
  });

  it("handles 0 insertions and 1 deletion", () => {
    expect(formatCounts(0, 1)).toEqual(["-1"]);
  });
});

describe("STATUS_ICONS", () => {
  it("maps A to +", () => {
    expect(STATUS_ICONS["A"]).toBe("+");
  });

  it("maps M to ~", () => {
    expect(STATUS_ICONS["M"]).toBe("~");
  });

  it("maps D to -", () => {
    expect(STATUS_ICONS["D"]).toBe("-");
  });

  it("has exactly 3 entries", () => {
    expect(Object.keys(STATUS_ICONS)).toHaveLength(3);
  });
});
