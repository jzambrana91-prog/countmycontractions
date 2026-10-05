import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLUSTER_COUNT,
  CLUSTER_WINDOW_MS,
  HOUR_MS,
  MINUTE_MS,
  RULES,
  clearContractions,
  countStartingInWindow,
  createSession,
  decorateContractions,
  deleteContraction,
  durationMs,
  evaluateRule,
  formatClock,
  formatDuration,
  formatLogText,
  frequencyMs,
  overlongContraction,
  qualifyingRun,
  restMs,
  startContraction,
  stopContraction,
  summarizeLastHour,
  undo,
  updateContraction,
} from "../src/lib/contractions.js";

const FIVE = RULES["5-1-1"];
const FOUR = RULES["4-1-1"];
const THREE = RULES["3-1-1"];

function pattern(start, count, everyMin, durationSec) {
  return Array.from({ length: count }, (_, index) => {
    const contractionStart = start + index * everyMin * MINUTE_MS;
    return {
      id: `c${index}`,
      start: contractionStart,
      end: contractionStart + durationSec * 1000,
    };
  });
}

function withGaps(gapsMs, durationMsValue, start = 0) {
  const rows = [];
  let cursor = start;
  rows.push({ id: "c0", start: cursor, end: cursor + durationMsValue });
  gapsMs.forEach((gap, index) => {
    cursor += gap;
    rows.push({
      id: `c${index + 1}`,
      start: cursor,
      end: cursor + durationMsValue,
    });
  });
  return rows;
}

function justEnded(rows) {
  return rows[rows.length - 1].end;
}

describe("duration, frequency, and rest", () => {
  it("measures duration only for a completed contraction", () => {
    assert.equal(durationMs({ id: "a", start: 1_000, end: 61_000 }), 60_000);
    assert.equal(durationMs({ id: "a", start: 1_000, end: null }), null);
    assert.equal(durationMs({ id: "a", start: 5_000, end: 4_000 }), null);
  });

  it("measures frequency from start to start", () => {
    const previous = { id: "a", start: 0, end: 40_000 };
    const current = { id: "b", start: 5 * MINUTE_MS, end: 5 * MINUTE_MS + 50_000 };
    assert.equal(frequencyMs(previous, current), 5 * MINUTE_MS);
    assert.equal(frequencyMs(null, current), null);
  });

  it("measures rest from the previous end to the next start", () => {
    const previous = { id: "a", start: 0, end: 40_000 };
    const current = { id: "b", start: 5 * MINUTE_MS, end: 6 * MINUTE_MS };
    assert.equal(restMs(previous, current), 5 * MINUTE_MS - 40_000);
  });

  it("reports overlap when the next contraction starts before the previous one ends", () => {
    const previous = { id: "a", start: 0, end: 90_000 };
    const current = { id: "b", start: 60_000, end: 120_000 };
    assert.equal(restMs(previous, current), -30_000);
    assert.equal(frequencyMs(previous, current), 60_000);
  });

  it("leaves rest empty when the previous contraction is still open", () => {
    const rows = decorateContractions([
      { id: "b", start: 60_000, end: 90_000 },
      { id: "a", start: 0, end: null },
    ]);
    assert.equal(rows[0].id, "a");
    assert.equal(rows[1].frequencyMs, 60_000);
    assert.equal(rows[1].restMs, null);
    assert.equal(rows[0].frequencyMs, null);
  });
});

describe("formatting", () => {
  it("rounds duration to the nearest second", () => {
    assert.equal(formatDuration(0), "0 sec");
    assert.equal(formatDuration(59_499), "59 sec");
    assert.equal(formatDuration(59_500), "1 min 0 sec");
    assert.equal(formatDuration(90_000), "1 min 30 sec");
    assert.equal(formatDuration(3_600_000), "1 hr 0 min");
    assert.equal(formatDuration(null), "—");
    assert.equal(formatDuration(-1_000), "−1 sec");
  });

  it("formats clock time in the UTC test zone", () => {
    assert.equal(formatClock(Date.UTC(2026, 5, 15, 2, 14, 5)), "2:14:05 AM");
    assert.equal(formatClock(Number.NaN), "—");
  });
});

describe("last-hour summary", () => {
  const now = 10 * HOUR_MS;

  it("returns an empty summary when nothing is logged", () => {
    assert.deepEqual(summarizeLastHour([], now), {
      count: 0,
      avgDurationMs: null,
      avgFrequencyMs: null,
    });
  });

  it("includes a contraction that started exactly an hour ago and drops the one just outside", () => {
    const rows = [
      { id: "old", start: now - HOUR_MS - 1, end: now - HOUR_MS },
      { id: "edge", start: now - HOUR_MS, end: now - HOUR_MS + 60_000 },
      { id: "mid", start: now - 30 * MINUTE_MS, end: now - 29 * MINUTE_MS },
    ];
    const summary = summarizeLastHour(rows, now);
    assert.equal(summary.count, 2);
    assert.equal(summary.avgDurationMs, 60_000);
  });

  it("counts an in-progress contraction without averaging its unfinished length", () => {
    const rows = [
      { id: "done", start: now - 10 * MINUTE_MS, end: now - 9 * MINUTE_MS },
      { id: "open", start: now - 2 * MINUTE_MS, end: null },
    ];
    const summary = summarizeLastHour(rows, now);
    assert.equal(summary.count, 2);
    assert.equal(summary.avgDurationMs, MINUTE_MS);
    assert.equal(summary.avgFrequencyMs, 8 * MINUTE_MS);
  });

  it("uses the gap from a contraction that started before the hour", () => {
    const rows = [
      { id: "before", start: now - 70 * MINUTE_MS, end: now - 69 * MINUTE_MS },
      { id: "inside", start: now - 50 * MINUTE_MS, end: now - 49 * MINUTE_MS },
    ];
    const summary = summarizeLastHour(rows, now);
    assert.equal(summary.count, 1);
    assert.equal(summary.avgFrequencyMs, 20 * MINUTE_MS);
  });

  it("ignores an end time that falls before the start", () => {
    const summary = summarizeLastHour(
      [{ id: "bad", start: now - 5 * MINUTE_MS, end: now - 6 * MINUTE_MS }],
      now,
    );
    assert.equal(summary.count, 1);
    assert.equal(summary.avgDurationMs, null);
  });

  it("does not average a future-dated contraction into the hour", () => {
    const summary = summarizeLastHour(
      [{ id: "future", start: now + MINUTE_MS, end: now + 2 * MINUTE_MS }],
      now,
    );
    assert.equal(summary.count, 0);
  });
});

describe("5-1-1, 4-1-1, and 3-1-1 detection", () => {
  it("matches 5-1-1 when every gap is 5 minutes, each lasts 1 minute, across a full hour", () => {
    const rows = pattern(0, 13, 5, 60);
    const result = evaluateRule(rows, FIVE, justEnded(rows));
    assert.equal(result.matches, true);
    assert.equal(result.runCount, 13);
    assert.equal(result.spanMs, 60 * MINUTE_MS);
  });

  it("does not match when the pattern spans 59 minutes", () => {
    const gaps = Array.from({ length: 11 }, () => 5 * MINUTE_MS).concat(4 * MINUTE_MS);
    const rows = withGaps(gaps, 60_000);
    const result = evaluateRule(rows, FIVE, justEnded(rows));
    assert.equal(result.spanMs, 59 * MINUTE_MS);
    assert.equal(result.matches, false);
  });

  it("treats a displayed minute as one minute, and one millisecond under the rounding cutoff as short", () => {
    const longEnough = withGaps(Array(12).fill(5 * MINUTE_MS), 59_500);
    const tooShort = withGaps(Array(12).fill(5 * MINUTE_MS), 59_499);
    assert.equal(evaluateRule(longEnough, FIVE, justEnded(longEnough)).matches, true);
    assert.equal(evaluateRule(tooShort, FIVE, justEnded(tooShort)).matches, false);
  });

  it("rejects a single gap that rounds to longer than 5 minutes", () => {
    const gaps = Array(12).fill(5 * MINUTE_MS);
    gaps[4] = 5 * MINUTE_MS + 500;
    const rows = withGaps(gaps, 60_000);
    const result = evaluateRule(rows, FIVE, justEnded(rows));
    assert.equal(result.matches, false);
    assert.ok(result.runCount < 13);
  });

  it("keeps a gap that still rounds down to 5 minutes", () => {
    const gaps = Array(12).fill(5 * MINUTE_MS);
    gaps[4] = 5 * MINUTE_MS + 499;
    const rows = withGaps(gaps, 60_000);
    assert.equal(evaluateRule(rows, FIVE, justEnded(rows)).matches, true);
  });

  it("accepts a closer pattern for 5-1-1 and withholds it from a stricter rule", () => {
    const everyFour = pattern(0, 16, 4, 70);
    const ended = justEnded(everyFour);
    assert.equal(evaluateRule(everyFour, FIVE, ended).matches, true);
    assert.equal(evaluateRule(everyFour, FOUR, ended).matches, true);
    assert.equal(evaluateRule(everyFour, THREE, ended).matches, false);

    const everyThree = pattern(0, 21, 3, 65);
    const endedThree = justEnded(everyThree);
    assert.equal(evaluateRule(everyThree, THREE, endedThree).matches, true);
    assert.equal(evaluateRule(everyThree, FIVE, endedThree).matches, true);
  });

  it("does not let short contractions satisfy 4-1-1 just because they are close together", () => {
    const rows = pattern(0, 16, 4, 45);
    assert.equal(evaluateRule(rows, FOUR, justEnded(rows)).matches, false);
  });

  it("resets the streak after a long gap", () => {
    const early = pattern(0, 13, 5, 60);
    const laterStart = early[early.length - 1].start + 40 * MINUTE_MS;
    const later = pattern(laterStart, 4, 5, 60).map((row, index) => ({
      ...row,
      id: `later-${index}`,
    }));
    const result = evaluateRule([...early, ...later], FIVE, justEnded(later));
    assert.equal(result.matches, false);
    assert.equal(result.runCount, 4);
  });

  it("turns the pattern off once the grace period after the last start has passed", () => {
    const rows = pattern(0, 13, 5, 60);
    const lastStart = rows[rows.length - 1].start;
    assert.equal(evaluateRule(rows, FIVE, lastStart + 1.5 * 5 * MINUTE_MS).matches, true);
    assert.equal(evaluateRule(rows, FIVE, lastStart + 1.5 * 5 * MINUTE_MS + 1).matches, false);
  });

  it("keeps an otherwise lapsed pattern active while a new contraction is in progress", () => {
    const rows = pattern(0, 13, 5, 60);
    const last = rows[rows.length - 1];
    const open = { id: "open", start: last.start + 10 * MINUTE_MS, end: null };
    const now = open.start + 30_000;
    assert.equal(evaluateRule(rows, FIVE, now).matches, false);
    assert.equal(evaluateRule([...rows, open], FIVE, now).matches, true);
  });

  it("ignores an in-progress contraction when deciding length", () => {
    const open = [{ id: "only", start: 0, end: null }];
    assert.deepEqual(qualifyingRun(open, FIVE), []);
    assert.equal(evaluateRule(open, FIVE, 60_000).matches, false);
  });

  it("does not match a single completed contraction", () => {
    const rows = [{ id: "only", start: 0, end: 70_000 }];
    assert.equal(evaluateRule(rows, FIVE, 70_000).matches, false);
  });

  it("stops the streak at a short contraction in the middle", () => {
    const rows = pattern(0, 13, 5, 60);
    rows[3] = { ...rows[3], end: rows[3].start + 30_000 };
    const result = evaluateRule(rows, FIVE, justEnded(rows));
    assert.equal(result.matches, false);
    assert.equal(result.runCount, 9);
  });

  it("sorts out-of-order entries before judging the pattern", () => {
    const rows = pattern(0, 13, 5, 60).reverse();
    assert.equal(evaluateRule(rows, FIVE, justEnded(pattern(0, 13, 5, 60))).matches, true);
  });
});

describe("safety prompts", () => {
  const now = 1_000_000_000;

  it("flags a contraction that has gone past two minutes", () => {
    assert.equal(
      overlongContraction([{ id: "a", start: now - 120_000, end: null }], now),
      null,
    );
    const flagged = overlongContraction([{ id: "a", start: now - 120_500, end: null }], now);
    assert.equal(flagged?.id, "a");
    assert.equal(flagged?.inProgress, true);
  });

  it("drops the two-minute note 10 minutes after that contraction ended", () => {
    const row = { id: "a", start: now - 20 * MINUTE_MS, end: now - CLUSTER_WINDOW_MS - 1 };
    assert.equal(overlongContraction([row], now), null);
    const recent = { id: "a", start: now - 13 * MINUTE_MS, end: now - 9 * MINUTE_MS };
    assert.ok(overlongContraction([recent], now));
  });

  it("counts six contractions whose starts fall inside ten minutes", () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      id: `c${index}`,
      start: now - CLUSTER_WINDOW_MS + index * MINUTE_MS,
      end: now - CLUSTER_WINDOW_MS + index * MINUTE_MS + 30_000,
    }));
    assert.equal(countStartingInWindow(rows, now, CLUSTER_WINDOW_MS), CLUSTER_COUNT);
    rows[0] = { ...rows[0], start: now - CLUSTER_WINDOW_MS - 1 };
    assert.equal(countStartingInWindow(rows, now, CLUSTER_WINDOW_MS), 5);
  });
});

describe("edits, deletes, and undo", () => {
  it("does not mutate the contractions handed to a new session", () => {
    const original = [{ id: "a", start: 0, end: 1_000 }];
    const session = startContraction(createSession(original), 5_000, "b");
    assert.equal(original.length, 1);
    assert.equal(session.contractions.length, 2);
    assert.equal(session.contractions[0].end, 1_000);
  });

  it("undoes a stop back to an open contraction, then undoes the start", () => {
    let session = createSession();
    session = startContraction(session, 1_000, "a");
    session = stopContraction(session, 61_000);
    assert.equal(session.contractions[0].end, 61_000);

    session = undo(session);
    assert.equal(session.contractions[0].end, null);

    session = undo(session);
    assert.equal(session.contractions.length, 0);
    assert.equal(undo(session), session);
  });

  it("ignores a second start or stop when nothing would change", () => {
    let session = startContraction(createSession(), 1_000, "a");
    assert.equal(startContraction(session, 2_000, "b"), session);
    session = stopContraction(session, 2_000);
    assert.equal(stopContraction(session, 3_000), session);
  });

  it("breaks and restores a matched pattern when a duration is edited", () => {
    const rows = pattern(0, 13, 5, 60);
    let session = createSession(rows);
    const now = justEnded(rows);
    assert.equal(evaluateRule(session.contractions, FIVE, now).matches, true);

    session = updateContraction(session, "c6", { end: rows[6].start + 20_000 });
    assert.equal(evaluateRule(session.contractions, FIVE, now).matches, false);

    session = undo(session);
    assert.equal(session.contractions[6].end, rows[6].end);
    assert.equal(evaluateRule(session.contractions, FIVE, now).matches, true);
  });

  it("changes frequency when a middle contraction is deleted, then restores it", () => {
    const rows = pattern(0, 13, 5, 60);
    let session = createSession(rows);
    const now = justEnded(rows);
    session = deleteContraction(session, "c6");

    const decorated = decorateContractions(session.contractions);
    const bridged = decorated.find((row) => row.id === "c7");
    assert.equal(bridged.frequencyMs, 10 * MINUTE_MS);
    assert.equal(evaluateRule(session.contractions, FIVE, now).matches, false);

    session = undo(session);
    assert.equal(session.contractions.length, 13);
    assert.equal(evaluateRule(session.contractions, FIVE, now).matches, true);
  });

  it("leaves an unknown edit or delete untouched", () => {
    const session = createSession([{ id: "a", start: 0, end: 1_000 }]);
    assert.equal(updateContraction(session, "missing", { end: 2_000 }), session);
    assert.equal(deleteContraction(session, "missing"), session);
    assert.equal(updateContraction(session, "a", { end: 1_000 }), session);
  });

  it("rejects an edit with an invalid time and keeps the prior history", () => {
    const session = createSession([{ id: "a", start: 0, end: 1_000 }]);
    assert.equal(updateContraction(session, "a", { start: Number.NaN }), session);
  });

  it("clears the session and undoes the clear", () => {
    let session = createSession(pattern(0, 3, 5, 60));
    session = clearContractions(session);
    assert.equal(session.contractions.length, 0);
    session = undo(session);
    assert.equal(session.contractions.length, 3);
  });

  it("does not record history when clearing an empty session", () => {
    const session = createSession();
    assert.equal(clearContractions(session), session);
  });

  it("keeps earlier snapshots stable after later edits", () => {
    let session = createSession([{ id: "a", start: 0, end: 1_000 }]);
    session = updateContraction(session, "a", { end: 5_000 });
    session = updateContraction(session, "a", { end: 9_000 });
    const once = undo(session);
    assert.equal(once.contractions[0].end, 5_000);
    const twice = undo(once);
    assert.equal(twice.contractions[0].end, 1_000);
  });

  it("drops history older than the limit", () => {
    let session = createSession([{ id: "a", start: 0, end: 1_000 }]);
    for (let end = 2_000; end <= 32_000; end += 1_000) {
      session = updateContraction(session, "a", { end });
    }
    assert.equal(session.past.length, 30);
    let steps = 0;
    while (session.past.length > 0) {
      session = undo(session);
      steps += 1;
    }
    assert.equal(steps, 30);
    assert.equal(session.contractions[0].end, 2_000);
  });

  it("stops the open contraction with the latest start", () => {
    const session = createSession([
      { id: "early", start: 0, end: null },
      { id: "late", start: 10_000, end: null },
    ]);
    const stopped = stopContraction(session, 12_000);
    assert.equal(stopped.contractions.find((row) => row.id === "late").end, 12_000);
    assert.equal(stopped.contractions.find((row) => row.id === "early").end, null);
  });
});

describe("copy text", () => {
  it("describes an empty log without calling it a matched pattern", () => {
    const text = formatLogText({
      contractions: [],
      rule: FIVE,
      now: Date.UTC(2026, 0, 2, 15, 4, 5),
    });
    assert.match(text, /No contractions logged/);
    assert.match(text, /does not currently match 5-1-1/);
    assert.match(text, /not medical advice/);
    assert.match(text, /start to start/);
  });

  it("includes start-to-start spacing, rest, and a match note", () => {
    const rows = pattern(Date.UTC(2026, 0, 2, 8, 0, 0), 13, 5, 60);
    const text = formatLogText({
      contractions: rows,
      rule: FIVE,
      now: justEnded(rows),
    });
    assert.match(text, /1 min 0 sec — 5 min 0 sec start to start — rest 4 min 0 sec/);
    assert.match(text, /The logged pattern matches 5-1-1/);
    assert.match(text, /not a diagnosis/);
    assert.match(text, /Last hour: 12 contractions/);
  });

  it("labels an open contraction as in progress", () => {
    const text = formatLogText({
      contractions: [{ id: "a", start: Date.UTC(2026, 0, 2, 8, 0, 0), end: null }],
      rule: FOUR,
      now: Date.UTC(2026, 0, 2, 8, 1, 0),
    });
    assert.match(text, /in progress/);
    assert.match(text, /first in this log/);
    assert.match(text, /4-1-1/);
  });
});
