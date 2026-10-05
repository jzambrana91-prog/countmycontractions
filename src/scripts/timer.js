import {
  CLUSTER_COUNT,
  CLUSTER_WINDOW_MS,
  clearContractions,
  countStartingInWindow,
  createId,
  createSession,
  decorateContractions,
  deleteContraction,
  evaluateRule,
  formatClock,
  formatDuration,
  formatLogText,
  getRule,
  overlongContraction,
  ruleMatchMessage,
  startContraction,
  stopContraction,
  summarizeLastHour,
  undo,
  updateContraction,
} from "../lib/contractions.js";

const storageKey = "cmc-session-v1";
const ruleKey = "cmc-rule";

const toggleButton = document.querySelector("[data-timer-toggle]");
if (toggleButton instanceof HTMLButtonElement) {
  const liveTime = document.getElementById("live-time");
  const log = document.getElementById("log");
  const empty = document.getElementById("log-empty");
  const ruleBanner = document.getElementById("rule-banner");
  const cautionBanner = document.getElementById("caution-banner");
  const announce = document.getElementById("announce");
  const status = document.getElementById("action-status");
  const undoButton = document.getElementById("undo");
  const copyButton = document.getElementById("copy-log");
  const printButton = document.getElementById("print-log");
  const clearButton = document.getElementById("clear-log");
  const clearDialog = document.getElementById("clear-dialog");
  const storageNote = document.getElementById("storage-note");
  const printBody = document.getElementById("print-body");
  const printSummary = document.getElementById("print-summary");
  const printWhen = document.getElementById("print-when");
  const fallback = document.getElementById("copy-fallback");

  let session = createSession();
  let ruleId = "5-1-1";
  let wasMatching = false;
  let wakeLock = null;
  let lastAnnounce = "";

  const loadSession = function () {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return createSession();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.contractions)) return createSession();
      const contractions = parsed.contractions
        .filter((row) => row && typeof row.id === "string" && Number.isFinite(row.start))
        .map((row) => ({
          id: row.id,
          start: row.start,
          end: Number.isFinite(row.end) ? row.end : null,
        }));
      const past = Array.isArray(parsed.past)
        ? parsed.past
            .filter((snapshot) => Array.isArray(snapshot))
            .map((snapshot) =>
              snapshot
                .filter((row) => row && typeof row.id === "string" && Number.isFinite(row.start))
                .map((row) => ({
                  id: row.id,
                  start: row.start,
                  end: Number.isFinite(row.end) ? row.end : null,
                })),
            )
        : [];
      return { contractions, past };
    } catch {
      return createSession();
    }
  }

  const loadRule = function () {
    try {
      const stored = localStorage.getItem(ruleKey);
      return getRule(stored).id;
    } catch {
      return "5-1-1";
    }
  }

  const persist = function () {
    try {
      localStorage.setItem(storageKey, JSON.stringify(session));
      localStorage.setItem(ruleKey, ruleId);
      if (storageNote) storageNote.hidden = true;
    } catch {
      if (storageNote) storageNote.hidden = false;
    }
  }

  const say = function (message) {
    if (!announce || message === lastAnnounce) return;
    lastAnnounce = message;
    announce.textContent = "";
    window.setTimeout(() => {
      announce.textContent = message;
    }, 30);
  }

  const setStatus = function (message) {
    if (status) status.textContent = message;
  }

  const isTiming = function () {
    return session.contractions.some((row) => row.end == null);
  }

  const openContraction = function () {
    return session.contractions
      .filter((row) => row.end == null)
      .sort((a, b) => b.start - a.start)[0];
  }

  const setWakeLock = async function (shouldHold) {
    if (!("wakeLock" in navigator)) return;
    if (shouldHold) {
      if (wakeLock) return;
      try {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
          wakeLock = null;
        });
      } catch {
        wakeLock = null;
      }
      return;
    }
    if (!wakeLock) return;
    const current = wakeLock;
    wakeLock = null;
    try {
      await current.release();
    } catch {
      /* The lock may already have been released. */
    }
  }

  const formatRest = function (value) {
    if (value == null) return "—";
    if (value < 0) return "Overlap";
    return formatDuration(value);
  }

  const toLocalInput = function (timestamp) {
    const date = new Date(timestamp);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  const fromLocalInput = function (value) {
    if (!value) return null;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }

  const renderLive = function (now) {
    const open = openContraction();
    const timing = Boolean(open);
    toggleButton.dataset.state = timing ? "timing" : "idle";
    toggleButton.textContent = timing ? "Stop" : "Start";
    toggleButton.setAttribute("aria-label", timing ? "Stop contraction" : "Start contraction");
    if (liveTime) {
      liveTime.textContent = timing ? formatDuration(now - open.start) : "Ready";
    }
  }

  const renderSummary = function (now) {
    const summary = summarizeLastHour(session.contractions, now);
    const count = document.getElementById("stat-count");
    const duration = document.getElementById("stat-duration");
    const frequency = document.getElementById("stat-frequency");
    if (count) count.textContent = String(summary.count);
    if (duration) duration.textContent = formatDuration(summary.avgDurationMs);
    if (frequency) frequency.textContent = formatDuration(summary.avgFrequencyMs);
  }

  const renderBanners = function (now) {
    const rule = getRule(ruleId);
    const evaluation = evaluateRule(session.contractions, rule, now);
    if (ruleBanner) {
      const message = evaluation.matches ? ruleMatchMessage(rule) : "";
      if (ruleBanner.textContent !== message) ruleBanner.textContent = message;
      ruleBanner.hidden = !evaluation.matches;
    }
    if (evaluation.matches && !wasMatching) {
      say(ruleMatchMessage(rule));
    }
    wasMatching = evaluation.matches;

    const notes = [];
    const long = overlongContraction(session.contractions, now);
    if (long) {
      notes.push(
        "The latest contraction has lasted more than 2 minutes. Contact your provider or birth unit, as the safety note describes. This is not a diagnosis.",
      );
    }
    if (countStartingInWindow(session.contractions, now, CLUSTER_WINDOW_MS) >= CLUSTER_COUNT) {
      notes.push(
        "Six or more contractions have started in the last 10 minutes. Contact your provider or birth unit rather than waiting for a 5-1-1 pattern.",
      );
    }
    if (cautionBanner) {
      const message = notes.join(" ");
      if (cautionBanner.textContent !== message) cautionBanner.textContent = message;
      cautionBanner.hidden = notes.length === 0;
    }
  }

  const renderOpenDurations = function (now) {
    if (!log) return;
    log.querySelectorAll("[data-open-duration]").forEach((node) => {
      const id = node.getAttribute("data-open-duration");
      const row = session.contractions.find((item) => item.id === id);
      if (!row || row.end != null) return;
      node.textContent = formatDuration(now - row.start);
    });
  }

  const renderPrint = function (now) {
    if (!printBody || !printSummary || !printWhen) return;
    const rows = decorateContractions(session.contractions);
    const summary = summarizeLastHour(session.contractions, now);
    const rule = getRule(ruleId);
    const evaluation = evaluateRule(session.contractions, rule, now);
    printWhen.textContent = new Date(now).toLocaleString();
    printBody.replaceChildren();
    rows.forEach((row, index) => {
      const tr = document.createElement("tr");
      const cells = [
        String(index + 1),
        formatClock(row.start),
        row.end == null ? "In progress" : formatClock(row.end),
        row.end == null ? "In progress" : formatDuration(row.durationMs),
        row.frequencyMs == null ? "—" : formatDuration(row.frequencyMs),
        formatRest(row.restMs),
      ];
      cells.forEach((value) => {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      });
      printBody.append(tr);
    });
    printSummary.textContent = `${summary.count} in the last hour. Average length ${formatDuration(summary.avgDurationMs)}. Average time apart ${formatDuration(summary.avgFrequencyMs)}, start to start. ${
      evaluation.matches ? `The log matches ${rule.id}.` : `The log does not currently match ${rule.id}.`
    } Timing aid, not medical advice.`;
  }

  const renderList = function () {
    if (!log || !empty) return;
    const rows = decorateContractions(session.contractions).map((row, index) => ({
      ...row,
      number: index + 1,
    }));
    empty.hidden = rows.length !== 0;
    log.replaceChildren();
    rows
      .slice()
      .reverse()
      .forEach((row) => {
        log.append(buildEntry(row));
      });
  }

  const buildEntry = function (row) {
    const item = document.createElement("li");
    item.className = "entry";
    item.dataset.id = row.id;

    const view = document.createElement("div");
    view.className = "entry-view";

    const head = document.createElement("div");
    head.className = "entry-head";
    const number = document.createElement("span");
    number.className = "entry-num";
    number.textContent = `Contraction ${row.number}`;
    const time = document.createElement("span");
    time.className = "entry-time";
    time.textContent = formatClock(row.start);
    head.append(number, time);

    const stats = document.createElement("dl");
    stats.className = "entry-stats";
    stats.append(
      statPair("Length", row.end == null ? formatDuration(Date.now() - row.start) : formatDuration(row.durationMs), row.end == null ? row.id : null),
      statPair("Apart", row.frequencyMs == null ? "—" : formatDuration(row.frequencyMs)),
      statPair("Rest", formatRest(row.restMs)),
    );

    const actions = document.createElement("div");
    actions.className = "entry-actions";
    actions.append(
      actionButton("Edit", `Edit contraction ${row.number}`, "edit"),
      actionButton("Delete", `Delete contraction ${row.number}`, "delete"),
    );
    view.append(head, stats, actions);

    const form = document.createElement("form");
    form.className = "entry-edit";
    form.hidden = true;
    form.append(
      field("Start", "start", toLocalInput(row.start)),
      field("End", "end", row.end == null ? "" : toLocalInput(row.end)),
    );
    const error = document.createElement("p");
    error.className = "edit-error";
    error.hidden = true;
    const formActions = document.createElement("div");
    formActions.className = "entry-actions";
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "button";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ghost";
    cancel.dataset.action = "cancel";
    cancel.textContent = "Cancel";
    formActions.append(save, cancel);
    form.append(error, formActions);

    item.append(view, form);
    return item;
  }

  const statPair = function (label, value, openId) {
    const wrap = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    if (openId) description.dataset.openDuration = openId;
    wrap.append(term, description);
    return wrap;
  }

  const actionButton = function (label, ariaLabel, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost";
    button.dataset.action = action;
    button.textContent = label;
    button.setAttribute("aria-label", ariaLabel);
    return button;
  }

  const field = function (label, name, value) {
    const wrap = document.createElement("label");
    wrap.textContent = label;
    const input = document.createElement("input");
    input.type = "datetime-local";
    input.name = name;
    input.step = "1";
    input.required = name === "start";
    input.value = value;
    wrap.append(input);
    return wrap;
  }

  const render = function (now = Date.now()) {
    renderLive(now);
    renderSummary(now);
    renderBanners(now);
    renderList();
    renderPrint(now);
    if (undoButton instanceof HTMLButtonElement) undoButton.disabled = session.past.length === 0;
    document.querySelectorAll('input[name="rule"]').forEach((input) => {
      if (input instanceof HTMLInputElement) input.checked = input.value === ruleId;
    });
    const ruleHelp = document.getElementById("rule-help");
    const rule = getRule(ruleId);
    if (ruleHelp) {
      ruleHelp.textContent = `${rule.id} means about every ${rule.intervalMin} minutes, lasting at least 1 minute, for 1 hour. Apart is measured start to start.`;
    }
    setWakeLock(isTiming());
  }

  const commit = function (next, message) {
    if (next === session) return;
    session = next;
    persist();
    render();
    if (message) {
      setStatus(message);
      say(message);
    }
  }

  toggleButton.addEventListener("click", () => {
    if (isTiming()) {
      const open = openContraction();
      const next = stopContraction(session, Date.now());
      const saved = next.contractions.find((row) => row.id === open?.id);
      const length = saved?.end != null && open ? formatDuration(saved.end - saved.start) : "";
      commit(next, length ? `Contraction stopped at ${length}.` : "Contraction stopped.");
      return;
    }
    commit(startContraction(session, Date.now(), createId()), "Contraction started.");
  });

  document.querySelectorAll('input[name="rule"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!(input instanceof HTMLInputElement) || !input.checked) return;
      ruleId = getRule(input.value).id;
      wasMatching = false;
      persist();
      render();
    });
  });

  undoButton?.addEventListener("click", () => {
    commit(undo(session), "Last action undone.");
  });

  copyButton?.addEventListener("click", async () => {
    const text = formatLogText({
      contractions: session.contractions,
      rule: getRule(ruleId),
      now: Date.now(),
    });
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied. You can paste it into a message to your provider.");
      say("Contraction log copied.");
      if (fallback) fallback.hidden = true;
    } catch {
      if (fallback instanceof HTMLTextAreaElement) {
        fallback.hidden = false;
        fallback.value = text;
        fallback.focus();
        fallback.select();
      }
      setStatus("Clipboard access was unavailable. The log text is selected below so you can copy it.");
    }
  });

  printButton?.addEventListener("click", () => {
    renderPrint(Date.now());
    window.print();
  });

  clearButton?.addEventListener("click", () => {
    if (clearDialog instanceof HTMLDialogElement) clearDialog.showModal();
  });

  document.getElementById("clear-cancel")?.addEventListener("click", () => {
    if (clearDialog instanceof HTMLDialogElement) clearDialog.close();
  });

  document.getElementById("clear-confirm")?.addEventListener("click", () => {
    if (clearDialog instanceof HTMLDialogElement) clearDialog.close();
    commit(clearContractions(session), "Session cleared. Undo is available.");
  });

  log?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("[data-action]");
    const item = target.closest(".entry");
    if (!(button instanceof HTMLButtonElement) || !(item instanceof HTMLElement)) return;
    const id = item.dataset.id;
    if (!id) return;
    if (button.dataset.action === "delete") {
      commit(deleteContraction(session, id), "Contraction deleted. Undo is available.");
      return;
    }
    if (button.dataset.action === "edit") {
      const view = item.querySelector(".entry-view");
      const form = item.querySelector(".entry-edit");
      if (view instanceof HTMLElement) view.hidden = true;
      if (form instanceof HTMLElement) {
        form.hidden = false;
        form.querySelector("input")?.focus();
      }
    }
    if (button.dataset.action === "cancel") {
      const view = item.querySelector(".entry-view");
      const form = item.querySelector(".entry-edit");
      if (view instanceof HTMLElement) view.hidden = false;
      if (form instanceof HTMLElement) form.hidden = true;
    }
  });

  log?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const item = form.closest(".entry");
    if (!(item instanceof HTMLElement) || !item.dataset.id) return;
    const data = new FormData(form);
    const start = fromLocalInput(String(data.get("start") ?? ""));
    const endRaw = String(data.get("end") ?? "");
    const end = endRaw ? fromLocalInput(endRaw) : null;
    const error = form.querySelector(".edit-error");
    const showError = (message) => {
      if (error instanceof HTMLElement) {
        error.hidden = false;
        error.textContent = message;
      }
    };
    if (start == null) {
      showError("Enter a start time.");
      return;
    }
    if (endRaw && end == null) {
      showError("Enter a valid end time.");
      return;
    }
    if (end != null && end < start) {
      showError("The end time is before the start time.");
      return;
    }
    const anotherOpen = session.contractions.some((row) => row.end == null && row.id !== item.dataset.id);
    if (end == null && anotherOpen) {
      showError("Stop the contraction already in progress before leaving this one open.");
      return;
    }
    commit(updateContraction(session, item.dataset.id, { start, end }), "Contraction updated.");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && isTiming()) setWakeLock(true);
  });

  window.addEventListener("beforeprint", () => renderPrint(Date.now()));

  session = loadSession();
  ruleId = loadRule();
  persist();
  render();
  window.setInterval(() => {
    const now = Date.now();
    renderLive(now);
    renderSummary(now);
    renderBanners(now);
    renderOpenDurations(now);
  }, 250);
}
