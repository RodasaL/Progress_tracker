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
  it("calcula nível a partir dos pontos", () => {
    expect(getLevelFromPoints(0)).toBe(1);
    expect(getLevelFromPoints(LEVEL_STEP - 1)).toBe(1);
    expect(getLevelFromPoints(LEVEL_STEP)).toBe(2);
  });

  it("calcula progresso para próximo nível", () => {
    expect(getProgressToNextLevel(0)).toBe(0);
    expect(getProgressToNextLevel(60)).toBe(0.5);
    expect(getProgressToNextLevel(LEVEL_STEP)).toBe(0);
  });

  it("calcula delta diário com bónus e penalização ponderada", () => {
    expect(getDailyDelta({ donePoints: 60, totalPoints: 60 })).toBe(90);
    expect(getDailyDelta({ donePoints: 25, totalPoints: 60 })).toBe(4);
    expect(getDailyDelta({ donePoints: 0, totalPoints: 0 })).toBe(0);
  });

  it("calcula diferença de dias corretamente", () => {
    expect(daysBetween("2026-03-20", "2026-03-21")).toBe(1);
    expect(daysBetween("2026-03-20", "2026-03-25")).toBe(5);
  });

  it("nunca deixa pontos negativos", () => {
    expect(applyDelta(20, -50)).toBe(0);
    expect(applyDelta(20, 30)).toBe(50);
  });
});
