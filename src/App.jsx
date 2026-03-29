import { useEffect, useMemo, useState } from "react";
import {
  LEVEL_STEP,
  applyDelta,
  daysBetween,
  getDailyDelta,
  getLevelFromPoints,
  getProgressToNextLevel
} from "./utils/progression";

const STORAGE_KEY = "progress-tracker-v1";
const STATE_API_URL = "/api/state";
const SKIP_DAY_PENALTY = 10;
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

const defaultData = {
  activities: [
    { id: crypto.randomUUID(), name: "Gym", points: 15, days: [1, 3, 5] },
    { id: crypto.randomUUID(), name: "Study", points: 15, days: [1, 2, 3, 4, 5] },
    { id: crypto.randomUUID(), name: "Flexibility", points: 15, days: [2, 4, 6] },
    { id: crypto.randomUUID(), name: "Run", points: 15, days: [2, 4, 6] }
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

  const simulatedDate = useMemo(() => {
    const reference = new Date();
    reference.setHours(12, 0, 0, 0);
    reference.setDate(reference.getDate() + devDayOffset);
    return reference;
  }, [devDayOffset]);

  const todayKey = getTodayKey(simulatedDate);
  const weekday = getCurrentWeekday(simulatedDate);
  const checks = state.checksByDate[todayKey] || {};

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
  const alreadyCheckedInToday = state.history.some((entry) => entry.date === todayKey);

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

  function persist(nextState) {
    setState(nextState);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));

    writeRemoteState(nextState).catch(() => {
      // Keep working offline/local if backend is not reachable.
    });
  }

  function toggleCheck(activityId) {
    if (alreadyCheckedInToday) {
      return;
    }

    const currentChecks = state.checksByDate[todayKey] || {};
    const nextChecks = {
      ...currentChecks,
      [activityId]: !currentChecks[activityId]
    };

    const nextState = {
      ...state,
      checksByDate: {
        ...state.checksByDate,
        [todayKey]: nextChecks
      }
    };

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
          id: crypto.randomUUID(),
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
    if (alreadyCheckedInToday) {
      return;
    }

    const doneCount = state.activities.filter((activity) => checks[activity.id]).length;
    const totalCount = state.activities.length;
    const donePoints = state.activities.reduce((sum, activity) => {
      if (!checks[activity.id]) {
        return sum;
      }

      return sum + normalizeActivityPoints(activity.points);
    }, 0);
    const totalPoints = state.activities.reduce(
      (sum, activity) => sum + normalizeActivityPoints(activity.points),
      0
    );
    const baseDelta = getDailyDelta({ donePoints, totalPoints });

    let missedDaysPenalty = 0;
    if (state.lastCheckInDate) {
      const passedDays = daysBetween(state.lastCheckInDate, todayKey);
      const skippedDays = Math.max(0, passedDays - 1);
      missedDaysPenalty = skippedDays * SKIP_DAY_PENALTY;
    }

    const totalDelta = baseDelta - missedDaysPenalty;
    const nextPoints = applyDelta(state.points, totalDelta);
    const perfectDay = doneCount === totalCount && totalCount > 0;
    const nextStreak = perfectDay && missedDaysPenalty === 0 ? state.streak + 1 : 0;

    const nextState = {
      ...state,
      points: nextPoints,
      streak: nextStreak,
      longestStreak: Math.max(state.longestStreak, nextStreak),
      lastCheckInDate: todayKey,
      history: [
        {
          date: todayKey,
          done: doneCount,
          total: totalCount,
          donePoints,
          totalPoints,
          delta: totalDelta,
          pointsAfter: nextPoints,
          missedPenalty: missedDaysPenalty
        },
        ...state.history
      ].slice(0, 30)
    };

    persist(nextState);
    setDailyFeedback({
      date: todayKey,
      message:
        totalDelta >= 0
          ? `Great job! You earned ${totalDelta} points today.`
          : `You lost ${Math.abs(totalDelta)} points today. You'll recover tomorrow.`
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
          <p className="muted">{todayKey}</p>

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
                        disabled={alreadyCheckedInToday}
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
              Done today: {allDoneCount}/{totalActivities} · Points: {donePointsToday}/{totalPointsToday}
            </span>
            <button type="button" onClick={finishDay} disabled={alreadyCheckedInToday}>
              {alreadyCheckedInToday ? "Day completed" : "Complete day"}
            </button>
          </div>

          {dailyFeedback?.date === todayKey && <p className="feedback">{dailyFeedback.message}</p>}
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

          <div className="history-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Done</th>
                  <th>Delta</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {state.history.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="muted">
                      No check-ins yet.
                    </td>
                  </tr>
                ) : (
                  state.history.map((entry) => (
                    <tr key={entry.date}>
                      <td>{entry.date}</td>
                      <td>
                        {entry.done}/{entry.total}
                      </td>
                      <td className={entry.delta >= 0 ? "positive" : "negative"}>
                        {entry.delta >= 0 ? `+${entry.delta}` : entry.delta}
                      </td>
                      <td>{entry.pointsAfter}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
