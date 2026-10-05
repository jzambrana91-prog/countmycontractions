/**
 * Contraction timing math.
 *
 * Clinical definitions used here:
 * - Duration is the length of one contraction, from the moment it starts
 *   until it eases.
 * - Frequency is start-to-start: the time from the beginning of one
 *   contraction to the beginning of the next. This is the usual clinical
 *   measurement, not the rest gap.
 * - Rest is the gap from the end of one contraction to the start of the next.
 *
 * The 5-1-1, 4-1-1, and 3-1-1 patterns are teaching rules of thumb
 * (interval, duration, how long the pattern has lasted). They are not a
 * diagnosis. Comparisons use the nearest second, the same rounding as the
 * on-screen clock, so a contraction shown as 1 min 0 sec counts as one minute.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;

export const OVERLONG_SECONDS = 120;
export const CLUSTER_COUNT = 6;
export const CLUSTER_WINDOW_MS = 10 * MINUTE_MS;
export const HISTORY_LIMIT = 30;

export const RULES = {
  "5-1-1": {
    id: "5-1-1",
    intervalMin: 5,
    durationMin: 1,
    sustainMin: 60,
  },
  "4-1-1": {
    id: "4-1-1",
    intervalMin: 4,
    durationMin: 1,
    sustainMin: 60,
  },
  "3-1-1": {
    id: "3-1-1",
    intervalMin: 3,
    durationMin: 1,
    sustainMin: 60,
  },
};

export function getRule(id) {
  return RULES[id] ?? RULES["5-1-1"];
}

export function isValidInstant(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function isCompleted(contraction) {
  return (
    contraction != null &&
    isValidInstant(contraction.start) &&
    isValidInstant(contraction.end) &&
    contraction.end >= contraction.start
  );
}

/** Length of a completed contraction, in milliseconds. Null if it is open or invalid. */
export function durationMs(contraction) {
  if (!isCompleted(contraction)) return null;
  return contraction.end - contraction.start;
}

/** Start-to-start interval. Null if either start time is missing. */
export function frequencyMs(previous, current) {
  if (!previous || !current) return null;
  if (!isValidInstant(previous.start) || !isValidInstant(current.start)) return null;
  return current.start - previous.start;
}

/**
 * Rest interval, from the end of the previous contraction to the start of
 * the current one. Negative when the times overlap. Null if the previous
 * contraction has no end time.
 */
export function restMs(previous, current) {
  if (!isCompleted(previous) || !current || !isValidInstant(current.start)) return null;
  return current.start - previous.end;
}

export function sortContractions(contractions) {
  return [...(contractions ?? [])].sort((a, b) => {
    const byStart = a.start - b.start;
    if (byStart !== 0) return byStart;
    return String(a.id).localeCompare(String(b.id));
  });
}

export function decorateContractions(contractions) {
  const sorted = sortContractions(contractions);
  return sorted.map((contraction, index) => {
    const previous = index > 0 ? sorted[index - 1] : null;
    return {
      ...contraction,
      durationMs: durationMs(contraction),
      frequencyMs: previous ? frequencyMs(previous, contraction) : null,
      restMs: previous ? restMs(previous, contraction) : null,
    };
  });
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Summary for contractions that started within the last hour (inclusive).
 * An in-progress contraction counts toward the total but not the average
 * duration. Average frequency uses each start-to-start gap that ends on a
 * contraction inside the hour, even if the previous one started earlier.
 */
export function summarizeLastHour(contractions, now) {
  const sorted = sortContractions(contractions).filter((contraction) =>
    isValidInstant(contraction.start),
  );
  const inWindow = (contraction) =>
    contraction.start <= now && now - contraction.start <= HOUR_MS;
  const recent = sorted.filter(inWindow);
  const durations = recent.map(durationMs).filter((value) => value != null);
  const frequencies = [];

  for (let index = 1; index < sorted.length; index += 1) {
    if (!inWindow(sorted[index])) continue;
    const gap = frequencyMs(sorted[index - 1], sorted[index]);
    if (gap != null && gap >= 0) frequencies.push(gap);
  }

  return {
    count: recent.length,
    avgDurationMs: average(durations),
    avgFrequencyMs: average(frequencies),
  };
}

export function countStartingInWindow(contractions, now, windowMs) {
  return sortContractions(contractions).filter(
    (contraction) =>
      isValidInstant(contraction.start) &&
      contraction.start <= now &&
      now - contraction.start <= windowMs,
  ).length;
}

function roundedSeconds(milliseconds) {
  return Math.round(milliseconds / 1000);
}

function meetsDuration(contraction, rule) {
  const duration = durationMs(contraction);
  if (duration == null) return false;
  return roundedSeconds(duration) >= rule.durationMin * 60;
}

function meetsFrequency(gap, rule) {
  if (gap == null || gap < 0) return false;
  return roundedSeconds(gap) <= rule.intervalMin * 60;
}

/**
 * The current streak of completed contractions that each lasted long enough
 * and are close enough together. The streak stops walking backward at the
 * first contraction or gap that misses the rule.
 */
export function qualifyingRun(contractions, rule) {
  const completed = sortContractions(contractions).filter(isCompleted);
  if (completed.length === 0) return [];

  const last = completed[completed.length - 1];
  if (!meetsDuration(last, rule)) return [];

  const run = [last];
  for (let index = completed.length - 2; index >= 0; index -= 1) {
    const current = completed[index];
    const next = completed[index + 1];
    if (!meetsDuration(current, rule)) break;
    if (!meetsFrequency(frequencyMs(current, next), rule)) break;
    run.unshift(current);
  }
  return run;
}

/**
 * A rule matches when the trailing streak spans the sustained period and the
 * pattern is still underway. "Still underway" means a contraction is in
 * progress, or the last completed contraction in the streak started within
 * 1.5 times the rule interval (a short grace so the banner does not drop
 * while the next contraction is due).
 */
export function evaluateRule(contractions, rule, now) {
  const run = qualifyingRun(contractions, rule);
  if (run.length < 2) {
    return { matches: false, runCount: run.length, spanMs: 0, active: false };
  }

  const first = run[0];
  const last = run[run.length - 1];
  const spanMs = last.start - first.start;
  const sustained = roundedSeconds(spanMs) >= rule.sustainMin * 60;
  const intervalMs = rule.intervalMin * MINUTE_MS;
  const inProgress = sortContractions(contractions).some(
    (contraction) =>
      contraction.end == null &&
      isValidInstant(contraction.start) &&
      contraction.start >= last.start,
  );
  const active =
    inProgress ||
    (isValidInstant(now) && now >= last.start && now - last.start <= intervalMs * 1.5);

  return {
    matches: sustained && active,
    runCount: run.length,
    spanMs,
    active,
  };
}

/**
 * The latest contraction, if it has lasted more than 2 minutes and is still
 * relevant (in progress, or it ended within the last 10 minutes).
 */
export function overlongContraction(contractions, now) {
  const sorted = sortContractions(contractions).filter((contraction) =>
    isValidInstant(contraction.start),
  );
  if (sorted.length === 0 || !isValidInstant(now)) return null;

  const last = sorted[sorted.length - 1];
  if (last.end != null && now - last.end > CLUSTER_WINDOW_MS) return null;
  const end = last.end == null ? now : last.end;
  const duration = end - last.start;
  if (roundedSeconds(duration) <= OVERLONG_SECONDS) return null;

  return {
    id: last.id,
    durationMs: duration,
    inProgress: last.end == null,
  };
}

export function ruleMatchMessage(rule) {
  return `This log matches ${rule.id}. Recent contractions are about every ${rule.intervalMin} minutes or closer, each lasting at least 1 minute, and that pattern spans at least an hour. Consider contacting your provider or birth unit. This is a timing observation, not a diagnosis.`;
}

export function createId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneContraction(contraction) {
  return {
    id: contraction.id,
    start: contraction.start,
    end: contraction.end == null ? null : contraction.end,
  };
}

export function createSession(contractions = []) {
  return {
    contractions: contractions.map(cloneContraction),
    past: [],
  };
}

function commit(session, contractions) {
  const past = [...session.past, session.contractions.map(cloneContraction)];
  return {
    contractions,
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
  };
}

export function startContraction(session, now, id) {
  if (!isValidInstant(now)) return session;
  if (session.contractions.some((contraction) => contraction.end == null)) return session;
  return commit(session, [
    ...session.contractions.map(cloneContraction),
    { id, start: now, end: null },
  ]);
}

export function stopContraction(session, now) {
  if (!isValidInstant(now)) return session;
  const open = session.contractions
    .map((contraction, index) => ({ contraction, index }))
    .filter(({ contraction }) => contraction.end == null)
    .sort((a, b) => b.contraction.start - a.contraction.start)[0];
  if (!open) return session;

  const next = session.contractions.map(cloneContraction);
  next[open.index] = { ...next[open.index], end: now };
  return commit(session, next);
}

export function updateContraction(session, id, patch) {
  const index = session.contractions.findIndex((contraction) => contraction.id === id);
  if (index === -1) return session;

  const current = session.contractions[index];
  const start = patch.start === undefined ? current.start : patch.start;
  const end = patch.end === undefined ? current.end : patch.end;
  if (start === current.start && end === current.end) return session;
  if (!isValidInstant(start)) return session;
  if (end != null && !isValidInstant(end)) return session;

  const next = session.contractions.map(cloneContraction);
  next[index] = { id, start, end: end == null ? null : end };
  return commit(session, next);
}

export function deleteContraction(session, id) {
  if (!session.contractions.some((contraction) => contraction.id === id)) return session;
  return commit(
    session,
    session.contractions.filter((contraction) => contraction.id !== id).map(cloneContraction),
  );
}

export function clearContractions(session) {
  if (session.contractions.length === 0) return session;
  return commit(session, []);
}

export function undo(session) {
  if (session.past.length === 0) return session;
  const past = session.past.slice();
  const previous = past.pop();
  return {
    contractions: previous.map(cloneContraction),
    past,
  };
}

export function formatDuration(milliseconds) {
  if (milliseconds == null || !Number.isFinite(milliseconds)) return "—";
  const negative = milliseconds < 0;
  const totalSeconds = Math.round(Math.abs(milliseconds) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  let body;
  if (hours > 0) body = `${hours} hr ${minutes} min`;
  else if (minutes > 0) body = `${minutes} min ${seconds} sec`;
  else body = `${seconds} sec`;
  return negative ? `−${body}` : body;
}

export function formatClock(timestamp) {
  if (!isValidInstant(timestamp)) return "—";
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatLogText({ contractions, rule, now }) {
  const rows = decorateContractions(contractions);
  const summary = summarizeLastHour(contractions, now);
  const evaluation = evaluateRule(contractions, rule, now);
  const lines = [
    "Contraction log — Count My Contractions",
    `Recorded ${new Date(now).toLocaleString("en-US", { timeZone: "UTC" })} UTC`,
    `Pattern being watched: ${rule.id} (about every ${rule.intervalMin} min, lasting at least 1 min, for 1 hour)`,
    "",
  ];

  if (rows.length === 0) {
    lines.push("No contractions logged.");
  } else {
    rows.forEach((row, index) => {
      const length = row.end == null ? "in progress" : formatDuration(row.durationMs);
      const apart =
        row.frequencyMs == null
          ? "first in this log"
          : `${formatDuration(row.frequencyMs)} start to start`;
      let rest = "—";
      if (row.restMs != null) rest = row.restMs < 0 ? "overlap" : formatDuration(row.restMs);
      lines.push(`${index + 1}. ${formatClock(row.start)} — ${length} — ${apart} — rest ${rest}`);
    });
  }

  const countLabel = summary.count === 1 ? "contraction" : "contractions";
  lines.push("");
  lines.push(
    `Last hour: ${summary.count} ${countLabel}, average duration ${formatDuration(summary.avgDurationMs)}, average frequency ${formatDuration(summary.avgFrequencyMs)} (start to start).`,
  );
  lines.push(
    evaluation.matches
      ? `The logged pattern matches ${rule.id}. This is a timing observation, not a diagnosis. Contact your provider or birth unit for guidance.`
      : `The logged pattern does not currently match ${rule.id}.`,
  );
  lines.push("Timing aid only, not medical advice. Follow your own provider's instructions.");
  return lines.join("\n");
}
