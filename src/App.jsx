import { useEffect, useMemo, useState } from "react";
import {
  LEVEL_STEP,
  applyDelta,
  getDailyDelta,
  getLevelFromPoints,
  getProgressToNextLevel
} from "./utils/progression";

const STORAGE_KEY = "progress-tracker-v1";
const STATE_API_URL = "/api/state";
const TIME_API_URL = "/api/time";
const DEFAULT_ACTIVITY_POINTS = 15;
const LEVELS_PER_SHIELD = 16;

const SHIELD_PALETTES = [
  { rim: "#533211", base: "#9a6628", shadow: "#6f4519", shine: "#f1d39a", gem: "#f4f6f8" },
  { rim: "#5c6d79", base: "#a7b9c4", shadow: "#748895", shine: "#e8f2f7", gem: "#f4f6f8" },
  { rim: "#745108", base: "#f0a334", shadow: "#b47412", shine: "#f8e0a7", gem: "#f4f6f8" },
  { rim: "#0d4f8f", base: "#3e98f2", shadow: "#1f70c9", shine: "#b6dcff", gem: "#f4f6f8" },
  { rim: "#9f2cb0", base: "#de6be8", shadow: "#c247cf", shine: "#f3b4f8", gem: "#f4f6f8" },
  { rim: "#bf2d1c", base: "#f76d5d", shadow: "#d94832", shine: "#ffb1a8", gem: "#f4f6f8" }
];

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CALENDAR_WEEK_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric"
});

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const defaultData = {
  activities: [
    { id: createId(), name: "Gym", points: 15, days: [1, 3, 5] },
    { id: createId(), name: "Study", points: 15, days: [1, 2, 3, 4, 5] },
    { id: createId(), name: "Flexibility", points: 15, days: [2, 4, 6] },
    { id: createId(), name: "Run", points: 15, days: [2, 4, 6] }
  ],
  checksByDate: {},
  history: [],
  points: 0,
  streak: 0,
  longestStreak: 0,
  lastCheckInDate: null
};

function getTodayKey(referenceDate = new Date()) {
  return referenceDate.toISOString().split("T")[0];
}

function getCurrentWeekday(referenceDate = new Date()) {
  const jsDay = referenceDate.getDay();
  return jsDay === 0 ? 7 : jsDay;
}

function getDateFromKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function toDateKey(year, monthIndex, day) {
  const paddedMonth = String(monthIndex + 1).padStart(2, "0");
  const paddedDay = String(day).padStart(2, "0");
  return `${year}-${paddedMonth}-${paddedDay}`;
}

function getCalendarTone(entry) {
  if (!entry) {
    return "empty";
  }

  if (entry.done === entry.total && entry.total > 0) {
    return "peak";
  }

  if (entry.delta > 10) {
    return "high";
  }

  if (entry.delta > 0) {
    return "mid";
  }

  return "low";
}

function getDateRangeKeys(startKey, endKey) {
  const keys = [];
  const cursor = getDateFromKey(startKey);
  const endDate = getDateFromKey(endKey);

  while (cursor <= endDate) {
    keys.push(getTodayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return keys;
}

function rebuildProgressState(currentState, referenceDate, includeToday = false) {
  const closeUntil = new Date(referenceDate);
  closeUntil.setHours(12, 0, 0, 0);
  if (!includeToday) {
    closeUntil.setDate(closeUntil.getDate() - 1);
  }

  const closeUntilKey = getTodayKey(closeUntil);
  const trackedDateKeys = [
    ...Object.keys(currentState.checksByDate || {}),
    ...currentState.history.map((entry) => entry.date)
  ]
    .filter((dateKey) => dateKey <= closeUntilKey)
    .sort();

  if (trackedDateKeys.length === 0) {
    return currentState;
  }

  const rangeKeys = getDateRangeKeys(trackedDateKeys[0], closeUntilKey);
  const totalCount = currentState.activities.length;
  const totalPoints = currentState.activities.reduce(
    (sum, activity) => sum + normalizeActivityPoints(activity.points),
    0
  );

  let nextPoints = 0;
  let nextStreak = 0;
  let nextLongestStreak = 0;

  const chronologicalHistory = rangeKeys.map((dateKey) => {
    const dayChecks = currentState.checksByDate[dateKey] || {};
    const doneCount = currentState.activities.filter((activity) => dayChecks[activity.id]).length;
    const donePoints = currentState.activities.reduce((sum, activity) => {
      if (!dayChecks[activity.id]) {
        return sum;
      }

      return sum + normalizeActivityPoints(activity.points);
    }, 0);

    const delta = getDailyDelta({ donePoints, totalPoints });
    nextPoints = applyDelta(nextPoints, delta);

    const perfectDay = doneCount === totalCount && totalCount > 0;
    nextStreak = perfectDay ? nextStreak + 1 : 0;
    nextLongestStreak = Math.max(nextLongestStreak, nextStreak);

    return {
      date: dateKey,
      done: doneCount,
      total: totalCount,
      donePoints,
      totalPoints,
      delta,
      pointsAfter: nextPoints,
      missedPenalty: 0
    };
  });

  const nextHistory = chronologicalHistory.slice(-30).reverse();

  return {
    ...currentState,
    points: nextPoints,
    streak: nextStreak,
    longestStreak: nextLongestStreak,
    lastCheckInDate: closeUntilKey,
    history: nextHistory
  };
}

function hasProgressChanged(currentState, nextState) {
  if (currentState === nextState) {
    return false;
  }

  return (
    currentState.points !== nextState.points ||
    currentState.streak !== nextState.streak ||
    currentState.longestStreak !== nextState.longestStreak ||
    currentState.lastCheckInDate !== nextState.lastCheckInDate ||
    JSON.stringify(currentState.history) !== JSON.stringify(nextState.history)
  );
}

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultData;
    }
    const parsed = JSON.parse(raw);
    return {
      ...defaultData,
      ...parsed
    };
  } catch {
    return defaultData;
  }
}

async function readRemoteState() {
  const response = await fetch(STATE_API_URL, {
    method: "GET",
    headers: { "Content-Type": "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Failed to load remote state (${response.status})`);
  }

  const payload = await response.json();
  return payload?.state ?? null;
}

async function writeRemoteState(nextState) {
  const response = await fetch(STATE_API_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: nextState })
  });

  if (!response.ok) {
    throw new Error(`Failed to save remote state (${response.status})`);
  }
}

async function readRemoteTime() {
  const response = await fetch(TIME_API_URL, {
    method: "GET",
    headers: { "Content-Type": "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Failed to load server time (${response.status})`);
  }

  return response.json();
}

function normalizeActivityPoints(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_ACTIVITY_POINTS;
  }

  return Math.max(1, Math.min(100, Math.round(parsed)));
}

function getShieldTier(level) {
  const safeLevel = Math.max(1, Number(level) || 1);
  const rawTier = Math.floor((safeLevel - 1) / LEVELS_PER_SHIELD);
  return Math.min(rawTier, SHIELD_PALETTES.length - 1);
}

function LevelShield({ tier, level }) {
  const palette = SHIELD_PALETTES[tier] ?? SHIELD_PALETTES[0];
  const gradientId = `shieldGradient-${tier}`;

  return (
    <svg
      className="level-shield-svg"
      viewBox="0 0 100 120"
      role="img"
      aria-label={`Shield ${tier + 1} unlocked at level ${level}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="20%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%" stopColor={palette.shine} />
          <stop offset="52%" stopColor={palette.base} />
          <stop offset="100%" stopColor={palette.shadow} />
        </linearGradient>
      </defs>

      <path
        d="M50 6 C64 8 80 15 89 27 C95 35 96 46 95 59 C93 80 83 95 66 106 C60 110 55 113 50 116 C45 113 40 110 34 106 C17 95 7 80 5 59 C4 46 5 35 11 27 C20 15 36 8 50 6 Z"
        fill={palette.rim}
      />
      <path
        d="M50 12 C62 14 75 20 83 30 C88 36 89 45 88 57 C86 75 78 88 63 99 C58 103 54 106 50 108 C46 106 42 103 37 99 C22 88 14 75 12 57 C11 45 12 36 17 30 C25 20 38 14 50 12 Z"
        fill={`url(#${gradientId})`}
      />
      <path d="M23 34 C30 26 41 20 50 18 L50 108 C46 106 42 103 37 99 C22 88 14 75 12 57 C11 45 12 36 17 30 Z" fill="rgba(255,255,255,0.22)" />
      <path d="M77 35 C71 27 61 22 54 20 C61 24 67 31 69 39 C71 47 69 55 64 61 C71 58 76 52 78 45 C79 42 79 38 77 35 Z" fill="rgba(255,255,255,0.26)" />

      <path
        d="M50 38 L58 45 L55 56 L50 61 L45 56 L42 45 Z"
        fill={palette.gem}
        opacity="0.96"
      />
      <path d="M50 44 L54 48 L52 54 L50 57 L48 54 L46 48 Z" fill="rgba(180,198,210,0.82)" />
    </svg>
  );
}

export default function App() {
  const isDev = import.meta.env.DEV;
  const [state, setState] = useState(readStorage);
  const [newActivityName, setNewActivityName] = useState("");
  const [newActivityPoints, setNewActivityPoints] = useState(DEFAULT_ACTIVITY_POINTS);
  const [dailyFeedback, setDailyFeedback] = useState(null);
  const [devDayOffset, setDevDayOffset] = useState(0);
  const [devLevelInput, setDevLevelInput] = useState(1);
  const [serverTodayKey, setServerTodayKey] = useState(() => getTodayKey(new Date()));
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const initial = new Date();
    return new Date(initial.getFullYear(), initial.getMonth(), 1);
  });
  const [selectedCalendarDay, setSelectedCalendarDay] = useState(null);
  const [checklistDateKey, setChecklistDateKey] = useState(null);

  const simulatedDate = useMemo(() => {
    const reference = getDateFromKey(serverTodayKey);
    reference.setHours(12, 0, 0, 0);
    reference.setDate(reference.getDate() + devDayOffset);
    return reference;
  }, [devDayOffset, serverTodayKey]);

  const todayKey = getTodayKey(simulatedDate);
  const activeChecklistDateKey =
    checklistDateKey && checklistDateKey <= todayKey ? checklistDateKey : todayKey;
  const checklistDate = useMemo(() => getDateFromKey(activeChecklistDateKey), [activeChecklistDateKey]);
  const weekday = getCurrentWeekday(checklistDate);
  const checks = state.checksByDate[activeChecklistDateKey] || {};

  const donePointsToday = state.activities.reduce((sum, activity) => {
    if (!checks[activity.id]) {
      return sum;
    }

    return sum + normalizeActivityPoints(activity.points);
  }, 0);

  const totalPointsToday = state.activities.reduce(
    (sum, activity) => sum + normalizeActivityPoints(activity.points),
    0
  );

  const allDoneCount = state.activities.filter((activity) => checks[activity.id]).length;
  const totalActivities = state.activities.length;
  const level = getLevelFromPoints(state.points);
  const shieldTier = getShieldTier(level);
  const progressPct = Math.round(getProgressToNextLevel(state.points) * 100);
  const pointsIntoLevel = state.points % LEVEL_STEP;
  const pointsToNextLevel = Math.max(0, LEVEL_STEP - pointsIntoLevel);
  const normalizedProgress = Math.max(0, Math.min(100, progressPct));

  const circleRadius = 88;
  const circleCenter = 110;
  const circleCircumference = 2 * Math.PI * circleRadius;
  const circularStartAngle = -110;
  const circularArcDegrees = 300;
  const circularTrackLength = (circularArcDegrees / 360) * circleCircumference;
  const circularProgressLength = (normalizedProgress / 100) * circularTrackLength;

  const markerAngleDegrees = circularStartAngle + (normalizedProgress / 100) * circularArcDegrees;
  const markerAngleRadians = (markerAngleDegrees * Math.PI) / 180;
  const markerX = circleCenter + circleRadius * Math.cos(markerAngleRadians);
  const markerY = circleCenter + circleRadius * Math.sin(markerAngleRadians);
  const insights = useMemo(() => {
    if (state.history.length === 0) {
      return {
        successRate: 0,
        averageDelta: 0
      };
    }

    const successfulDays = state.history.filter((entry) => entry.done === entry.total).length;
    const successRate = Math.round((successfulDays / state.history.length) * 100);
    const averageDelta = Math.round(
      state.history.reduce((sum, entry) => sum + entry.delta, 0) / state.history.length
    );

    return {
      successRate,
      averageDelta
    };
  }, [state.history]);

  const historyByDate = useMemo(
    () => Object.fromEntries(state.history.map((entry) => [entry.date, entry])),
    [state.history]
  );

  const monthLabel = monthFormatter.format(calendarMonth);

  const calendarCells = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const monthIndex = calendarMonth.getMonth();
    const firstDay = new Date(year, monthIndex, 1);
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const firstWeekdayOffset = (firstDay.getDay() + 6) % 7;
    const totalCells = Math.ceil((firstWeekdayOffset + daysInMonth) / 7) * 7;

    return Array.from({ length: totalCells }, (_, index) => {
      const dayNumber = index - firstWeekdayOffset + 1;
      const inMonth = dayNumber >= 1 && dayNumber <= daysInMonth;

      if (!inMonth) {
        return {
          key: `empty-${year}-${monthIndex}-${index}`,
          inMonth: false
        };
      }

      const dateKey = toDateKey(year, monthIndex, dayNumber);
      const entry = historyByDate[dateKey] ?? null;
      const tone = getCalendarTone(entry);

      return {
        key: dateKey,
        inMonth: true,
        dateKey,
        dayNumber,
        entry,
        tone
      };
    });
  }, [calendarMonth, historyByDate]);

  function changeCalendarMonth(offset) {
    setCalendarMonth((current) => {
      const next = new Date(current.getFullYear(), current.getMonth() + offset, 1);
      return next;
    });
    setSelectedCalendarDay(null);
  }

  function selectCalendarDay(dateKey) {
    const nextDateKey = selectedCalendarDay === dateKey ? null : dateKey;
    setSelectedCalendarDay(nextDateKey);
    setChecklistDateKey(nextDateKey && nextDateKey <= todayKey ? nextDateKey : null);
  }

  useEffect(() => {
    let cancelled = false;

    async function syncServerClock() {
      try {
        const remoteTime = await readRemoteTime();
        if (cancelled || !remoteTime?.today) {
          return;
        }

        setServerTodayKey(remoteTime.today);
      } catch {
        if (!cancelled) {
          setServerTodayKey(getTodayKey(new Date()));
        }
      }
    }

    syncServerClock();
    const intervalId = window.setInterval(syncServerClock, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!isDev) {
      return;
    }

    setDevLevelInput(level);
  }, [isDev, level]);

  useEffect(() => {
    let cancelled = false;

    async function syncInitialState() {
      try {
        const remoteState = await readRemoteState();
        if (!remoteState || cancelled) {
          return;
        }

        const nextState = {
          ...defaultData,
          ...remoteState
        };

        setState(nextState);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      } catch {
        // Keep local storage state when API is unavailable.
      }
    }

    syncInitialState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nextState = rebuildProgressState(state, simulatedDate);
    if (hasProgressChanged(state, nextState)) {
      persist(nextState);
    }
  }, [simulatedDate, state]);

  function persist(nextState) {
    setState(nextState);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));

    writeRemoteState(nextState).catch(() => {
      // Keep working offline/local if backend is not reachable.
    });
  }

  function toggleCheck(activityId) {
    const currentChecks = state.checksByDate[activeChecklistDateKey] || {};
    const nextChecks = {
      ...currentChecks,
      [activityId]: !currentChecks[activityId]
    };

    const draftState = {
      ...state,
      checksByDate: {
        ...state.checksByDate,
        [activeChecklistDateKey]: nextChecks
      }
    };

    const targetDayIsClosed = Boolean(historyByDate[activeChecklistDateKey]);
    const shouldRebuild = activeChecklistDateKey < todayKey || targetDayIsClosed;
    const nextState = shouldRebuild
      ? rebuildProgressState(draftState, simulatedDate, activeChecklistDateKey === todayKey)
      : draftState;

    persist(nextState);
  }

  function addActivity(event) {
    event.preventDefault();

    const trimmed = newActivityName.trim();
    if (!trimmed) {
      return;
    }

    const nextState = {
      ...state,
      activities: [
        ...state.activities,
        {
          id: createId(),
          name: trimmed,
          points: normalizeActivityPoints(newActivityPoints),
          days: [1, 2, 3, 4, 5]
        }
      ]
    };

    persist(nextState);
    setNewActivityName("");
    setNewActivityPoints(DEFAULT_ACTIVITY_POINTS);
  }

  function removeActivity(activityId) {
    const nextActivities = state.activities.filter((activity) => activity.id !== activityId);
    const nextChecksByDate = Object.fromEntries(
      Object.entries(state.checksByDate).map(([date, dayChecks]) => {
        const { [activityId]: _removed, ...rest } = dayChecks;
        return [date, rest];
      })
    );

    persist({
      ...state,
      activities: nextActivities,
      checksByDate: nextChecksByDate
    });
  }

  function toggleRoutineDay(activityId, day) {
    const nextActivities = state.activities.map((activity) => {
      if (activity.id !== activityId) {
        return activity;
      }

      const exists = activity.days.includes(day);
      const nextDays = exists
        ? activity.days.filter((dayItem) => dayItem !== day)
        : [...activity.days, day].sort((a, b) => a - b);

      return {
        ...activity,
        days: nextDays
      };
    });

    persist({
      ...state,
      activities: nextActivities
    });
  }

  function updateActivityPoints(activityId, nextPointsInput) {
    const nextPoints = normalizeActivityPoints(nextPointsInput);

    const nextActivities = state.activities.map((activity) => {
      if (activity.id !== activityId) {
        return activity;
      }

      return {
        ...activity,
        points: nextPoints
      };
    });

    persist({
      ...state,
      activities: nextActivities
    });
  }

  function setLevelForDev(nextLevelInput) {
    if (!isDev) {
      return;
    }

    const safeLevel = Math.max(1, Math.min(999, Math.round(Number(nextLevelInput) || 1)));
    const nextPoints = (safeLevel - 1) * LEVEL_STEP;

    persist({
      ...state,
      points: nextPoints
    });

    setDevLevelInput(safeLevel);
  }

  function finishDay() {
    if (activeChecklistDateKey > todayKey) {
      return;
    }

    const includeToday = activeChecklistDateKey === todayKey;
    const nextState = rebuildProgressState(state, simulatedDate, includeToday);
    if (!hasProgressChanged(state, nextState)) {
      return;
    }

    persist(nextState);

    const entry = nextState.history.find((historyEntry) => historyEntry.date === activeChecklistDateKey);
    if (!entry) {
      return;
    }

    setDailyFeedback({
      date: activeChecklistDateKey,
      message:
        entry.delta >= 0
          ? `Great job! You earned ${entry.delta} points for this day.`
          : `You lost ${Math.abs(entry.delta)} points for this day.`
    });
  }

  return (
    <div className="app-shell">
      <header className="hero card">
        <div className="hero-top">
          <div>
            <p className="eyebrow">Progress Tracker</p>
            <h1>Your routine, gamified</h1>
            <p className="muted">
              Check off daily activities, earn points, and level up.
            </p>
          </div>

          <div className="circular-progress-card" aria-label="Level progress">
            <div className="circular-progress-widget">
              <svg
                className="circular-progress-svg"
                viewBox="0 0 220 220"
                role="img"
                aria-label={`Level ${level} with ${normalizedProgress}% toward the next level`}
              >
                <defs>
                  <linearGradient id="levelGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#4368f4" />
                    <stop offset="100%" stopColor="#57e6ba" />
                  </linearGradient>
                </defs>

                <circle
                  className="circular-progress-track"
                  cx={circleCenter}
                  cy={circleCenter}
                  r={circleRadius}
                  strokeDasharray={`${circularTrackLength} ${circleCircumference}`}
                  style={{ transform: `rotate(${circularStartAngle}deg)` }}
                />
                <circle
                  className="circular-progress-value"
                  cx={circleCenter}
                  cy={circleCenter}
                  r={circleRadius}
                  strokeDasharray={`${circularProgressLength} ${circleCircumference}`}
                  style={{ transform: `rotate(${circularStartAngle}deg)` }}
                />

                <circle className="circular-progress-knob-shadow" cx={markerX} cy={markerY} r="13" />
                <circle className="circular-progress-knob" cx={markerX} cy={markerY} r="11" />
              </svg>

              <div className="circular-progress-center-card" aria-hidden="true">
                <div className="level-shield-wrap">
                  <LevelShield tier={shieldTier} level={level} />
                </div>
              </div>
            </div>

            <p className="circular-progress-footnote">
              Level {level} · {pointsToNextLevel} points to level up
            </p>
          </div>
        </div>

        <div className="stats-grid">
          <article>
            <span>Points</span>
            <strong>{state.points}</strong>
          </article>
          <article>
            <span>Level</span>
            <strong>{level}</strong>
          </article>
          <article>
            <span>Streak</span>
            <strong>{state.streak}</strong>
          </article>
          <article>
            <span>Best streak</span>
            <strong>{state.longestStreak}</strong>
          </article>
        </div>
        <div>
          <div className="progress-row">
            <span>Progress to level {level + 1}</span>
            <span>{progressPct}%</span>
          </div>
          <div className="progress-track">
            <div style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      </header>

      <main className="content-grid">
        <section className="card">
          <h2>Today's checklist</h2>
          <p className="muted">
            {activeChecklistDateKey}
            {activeChecklistDateKey < todayKey ? " · Editing past day" : ""}
          </p>

          {isDev && (
            <div className="dev-tools">
              <div className="dev-time-controls">
                <span>Simulation (dev): day {devDayOffset >= 0 ? `+${devDayOffset}` : devDayOffset}</span>
                <div>
                  <button type="button" className="secondary" onClick={() => setDevDayOffset((value) => value - 1)}>
                    -1 day
                  </button>
                  <button type="button" className="secondary" onClick={() => setDevDayOffset(0)}>
                    Today
                  </button>
                  <button type="button" className="secondary" onClick={() => setDevDayOffset((value) => value + 1)}>
                    +1 day
                  </button>
                </div>
              </div>

              <div className="dev-level-controls">
                <span>Level (dev)</span>
                <div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setLevelForDev(Math.max(1, level - 1))}
                  >
                    -1 level
                  </button>
                  <input
                    type="number"
                    min="1"
                    max="999"
                    step="1"
                    value={devLevelInput}
                    onChange={(event) => setDevLevelInput(event.target.value)}
                    onBlur={(event) => setLevelForDev(event.target.value)}
                    aria-label="Development level"
                  />
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setLevelForDev(level + 1)}
                  >
                    +1 level
                  </button>
                  <button type="button" className="secondary" onClick={() => setLevelForDev(devLevelInput)}>
                    Apply
                  </button>
                </div>
              </div>
            </div>
          )}

          {state.activities.length === 0 ? (
            <p className="muted">Add activities to get started.</p>
          ) : (
            <ul className="activity-list">
              {state.activities.map((activity) => {
                const isChecked = Boolean(checks[activity.id]);
                const plannedToday = activity.days.includes(weekday);

                return (
                  <li key={activity.id} className={isChecked ? "checked" : ""}>
                    <label>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleCheck(activity.id)}
                      />
                      <div>
                        <strong>{activity.name}</strong>
                        <small>{plannedToday ? "Planned for today" : "Optional today"}</small>
                      </div>
                    </label>
                    <span>+{activity.points}</span>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="summary-row">
            <span>
              Done: {allDoneCount}/{totalActivities} · Points: {donePointsToday}/{totalPointsToday}
            </span>
            <button type="button" onClick={finishDay}>
              {activeChecklistDateKey === todayKey ? "Complete day now" : "Save day edits"}
            </button>
          </div>

          {dailyFeedback?.date === activeChecklistDateKey && <p className="feedback">{dailyFeedback.message}</p>}
        </section>

        <section className="card">
          <h2>Organize routine</h2>
          <p className="muted">Choose which days each activity should appear.</p>

          <form className="add-form" onSubmit={addActivity}>
            <input
              type="text"
              placeholder="New activity (e.g. Meditation)"
              value={newActivityName}
              onChange={(event) => setNewActivityName(event.target.value)}
            />
            <input
              type="number"
              min="1"
              max="100"
              step="1"
              value={newActivityPoints}
              onChange={(event) => setNewActivityPoints(event.target.value)}
              aria-label="Points for new activity"
              title="Task points"
            />
            <button type="submit">Add</button>
          </form>

          <div className="routine-list">
            {state.activities.map((activity) => (
              <article key={activity.id}>
                <div className="routine-head">
                  <strong>{activity.name}</strong>
                  <div className="routine-meta">
                    <label className="activity-points-editor">
                      <span>Pts</span>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        step="1"
                        value={normalizeActivityPoints(activity.points)}
                        onChange={(event) => updateActivityPoints(activity.id, event.target.value)}
                        onBlur={(event) => updateActivityPoints(activity.id, event.target.value)}
                        aria-label={`Points for activity ${activity.name}`}
                      />
                    </label>
                    <button type="button" className="remove" onClick={() => removeActivity(activity.id)}>
                      Remove
                    </button>
                  </div>
                </div>
                <div className="day-chips">
                  {WEEK_DAYS.map((label, index) => {
                    const day = index + 1;
                    const active = activity.days.includes(day);

                    return (
                      <button
                        key={`${activity.id}-${day}`}
                        type="button"
                        className={active ? "chip active" : "chip"}
                        onClick={() => toggleRoutineDay(activity.id, day)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Progress summary</h2>
          <div className="stats-grid compact">
            <article>
              <span>Success rate</span>
              <strong>{insights.successRate}%</strong>
            </article>
            <article>
              <span>Daily average</span>
              <strong>{insights.averageDelta}</strong>
            </article>
          </div>

          <div className="calendar-wrap" aria-label="Monthly progress calendar">
            <div className="calendar-head">
              <button
                type="button"
                className="secondary calendar-nav"
                onClick={() => changeCalendarMonth(-1)}
                aria-label="Previous month"
              >
                {"<"}
              </button>
              <h3>{monthLabel}</h3>
              <button
                type="button"
                className="secondary calendar-nav"
                onClick={() => changeCalendarMonth(1)}
                aria-label="Next month"
              >
                {">"}
              </button>
            </div>

            <div className="calendar-weekdays" aria-hidden="true">
              {CALENDAR_WEEK_DAYS.map((weekday) => (
                <span key={weekday}>{weekday}</span>
              ))}
            </div>

            <div className="calendar-grid">
              {calendarCells.map((cell) => {
                if (!cell.inMonth) {
                  return <div key={cell.key} className="calendar-day calendar-day-empty" aria-hidden="true" />;
                }

                const classes = ["calendar-day", `calendar-day-${cell.tone}`];
                if (cell.dateKey === todayKey) {
                  classes.push("calendar-day-today");
                }
                if (cell.dateKey === selectedCalendarDay) {
                  classes.push("calendar-day-selected");
                }

                return (
                  <button
                    key={cell.key}
                    type="button"
                    className={classes.join(" ")}
                    title={cell.dateKey}
                    onClick={() => selectCalendarDay(cell.dateKey)}
                  >
                    <strong>{cell.dayNumber}</strong>
                  </button>
                );
              })}
            </div>

            {selectedCalendarDay && historyByDate[selectedCalendarDay] && (
              <div className="calendar-day-details">
                <div className="details-content">
                  <span className="details-date">{selectedCalendarDay}</span>
                  <span className="details-delta">
                    {historyByDate[selectedCalendarDay].delta >= 0 ? "+" : ""}
                    {historyByDate[selectedCalendarDay].delta} pts
                  </span>
                </div>
              </div>
            )}

            {state.history.length === 0 && (
              <p className="muted calendar-empty-note">No check-ins yet for the selected month.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
