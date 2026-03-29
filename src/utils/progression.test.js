import { describe, expect, it } from "vitest";
import {
  LEVEL_STEP,
  applyDelta,
  daysBetween,
  getDailyDelta,
  getLevelFromPoints,
  getProgressToNextLevel
} from "./progression";

describe("progression", () => {
  it("calculates level from points", () => {
    expect(getLevelFromPoints(0)).toBe(1);
    expect(getLevelFromPoints(LEVEL_STEP - 1)).toBe(1);
    expect(getLevelFromPoints(LEVEL_STEP)).toBe(2);
  });

  it("calculates progress toward next level", () => {
    expect(getProgressToNextLevel(0)).toBe(0);
    expect(getProgressToNextLevel(60)).toBe(0.5);
    expect(getProgressToNextLevel(LEVEL_STEP)).toBe(0);
  });

  it("calculates daily delta with bonus and weighted penalty", () => {
    expect(getDailyDelta({ donePoints: 60, totalPoints: 60 })).toBe(90);
    expect(getDailyDelta({ donePoints: 25, totalPoints: 60 })).toBe(4);
    expect(getDailyDelta({ donePoints: 0, totalPoints: 0 })).toBe(0);
  });

  it("calculates day difference correctly", () => {
    expect(daysBetween("2026-03-20", "2026-03-21")).toBe(1);
    expect(daysBetween("2026-03-20", "2026-03-25")).toBe(5);
  });

  it("never allows negative points", () => {
    expect(applyDelta(20, -50)).toBe(0);
    expect(applyDelta(20, 30)).toBe(50);
  });
});
