// Frame-by-frame game tracker for the Bowling channel (#bowling/scorer).
// Each throw is stored as a 10-bit mask of the pins still standing after it (bit 0 = pin 1),
// so a frame is a list of masks and a game is a list of up to ten frames.

const bowlingFullRack = 0x3ff;
const bowlingLiveKey = "seven-channels.bowling-live.v1";
// Pin deck as seen from the approach: back row first.
const bowlingPinRows = [[7, 8, 9, 10], [4, 5, 6], [2, 3], [1]];
const bowlingPinSpots = { 1: [0, 0], 2: [-1, 1], 3: [1, 1], 4: [-2, 2], 5: [0, 2], 6: [2, 2], 7: [-3, 3], 8: [-1, 3], 9: [1, 3], 10: [3, 3] };

let bowlingLive = null;
let bowlingLiveSelection = 0;
let bowlingLiveStatus = { text: "", error: false };
let bowlingLiveConfirmReset = false;
let bowlingLiveTarget = null;

function bowlingPinBit(pin) {
  return 1 << (pin - 1);
}

function bowlingPinCount(mask) {
  let count = 0;
  for (let value = mask; value; value >>= 1) count += value & 1;
  return count;
}

function bowlingPinsOf(mask) {
  const pins = [];
  for (let pin = 1; pin <= 10; pin++) if (mask & bowlingPinBit(pin)) pins.push(pin);
  return pins;
}

function bowlingPinsTouch(a, b) {
  const [ax, ay] = bowlingPinSpots[a];
  const [bx, by] = bowlingPinSpots[b];
  const rows = Math.abs(ay - by);
  const across = Math.abs(ax - bx);
  // Side by side, diagonal neighbours, or directly behind (a sleeper such as 2-8 isn't a split).
  return (rows === 0 && across === 2) || (rows === 1 && across === 1) || (rows === 2 && across === 0);
}

// A split: headpin down, two or more pins standing, and a gap between some of them.
function bowlingIsSplit(mask) {
  const pins = bowlingPinsOf(mask);
  if (pins.length < 2 || mask & 1) return false;
  const reached = new Set([pins[0]]);
  const queue = [pins[0]];
  while (queue.length) {
    const pin = queue.shift();
    for (const other of pins) {
      if (!reached.has(other) && bowlingPinsTouch(pin, other)) {
        reached.add(other);
        queue.push(other);
      }
    }
  }
  return reached.size < pins.length;
}

function bowlingLeaveName(mask) {
  return bowlingPinsOf(mask).join("-");
}

// Replays a game, dropping anything after the first impossible throw, and scores it.
function bowlingReplayFrames(input) {
  const frames = [];
  const rolls = [];
  let next = { frame: 0, ball: 0, before: bowlingFullRack, fresh: true };
  const list = Array.isArray(input) ? input.slice(0, 10) : [];
  for (let index = 0; index < list.length; index++) {
    const tenth = index === 9;
    const throws = [];
    let before = bowlingFullRack;
    let fresh = true;
    let complete = false;
    let broken = false;
    for (const mask of Array.isArray(list[index]) ? list[index] : []) {
      if (complete || !Number.isInteger(mask) || mask < 0 || mask > bowlingFullRack || (mask & ~before)) {
        broken = !complete;
        break;
      }
      const knocked = bowlingPinCount(before) - bowlingPinCount(mask);
      throws.push({ mask, before, fresh, knocked, split: fresh && bowlingIsSplit(mask) });
      rolls.push(knocked);
      if (mask === 0 || !fresh) {
        before = bowlingFullRack;
        fresh = true;
      } else {
        before = mask;
        fresh = false;
      }
      complete = tenth
        ? throws.length === 3 || (throws.length === 2 && throws[0].mask !== 0 && throws[1].mask !== 0)
        : throws[0].mask === 0 || throws.length === 2;
    }
    if (!throws.length) break;
    frames.push({ throws, complete, rollStart: rolls.length - throws.length });
    next = complete ? { frame: index + 1, ball: 0, before: bowlingFullRack, fresh: true } : { frame: index, ball: throws.length, before, fresh };
    if (broken || !complete) break;
  }
  let running = 0;
  let known = true;
  for (const [index, frame] of frames.entries()) {
    let score = null;
    if (frame.complete) {
      const own = frame.throws.reduce((sum, item) => sum + item.knocked, 0);
      const bonus = index === 9 ? 0 : frame.throws[0].mask === 0 ? 2 : frame.throws[1].mask === 0 ? 1 : 0;
      const extra = rolls.slice(frame.rollStart + frame.throws.length, frame.rollStart + frame.throws.length + bonus);
      if (extra.length === bonus) score = own + extra.reduce((sum, value) => sum + value, 0);
    }
    known = known && score !== null;
    frame.cumulative = known ? (running += score) : null;
  }
  const complete = frames.length === 10 && frames[9].complete;
  return {
    frames,
    complete,
    total: complete ? frames[9].cumulative : null,
    running: frames.reduce((value, frame) => frame.cumulative ?? value, 0),
    next: complete ? null : next,
    data: frames.map((frame) => frame.throws.map((item) => item.mask))
  };
}

// Highest score still possible if every remaining throw strikes.
function bowlingMaxPossible(frames) {
  const masks = bowlingReplayFrames(frames).data;
  let guard = 0;
  for (;;) {
    const replay = bowlingReplayFrames(masks);
    if (replay.complete || guard++ > 30) return replay.total ?? replay.running;
    const { frame } = replay.next;
    if (!masks[frame]) masks[frame] = [];
    masks[frame].push(0);
  }
}

function bowlingNormalizeFrames(value) {
  if (!Array.isArray(value) || !value.length) return null;
  const replay = bowlingReplayFrames(value);
  return replay.complete ? replay.data : null;
}

function bowlingThrowMark(item) {
  if (item.mask === 0) return item.fresh ? "X" : "/";
  return item.knocked === 0 ? "-" : String(item.knocked);
}

// ---------- Live game (kept on this device until it's saved to a session) ----------

function bowlingLoadLive() {
  if (bowlingLive) return bowlingLive;
  let frames = [];
  try {
    const saved = JSON.parse(localStorage.getItem(bowlingLiveKey) || "null");
    if (saved && Array.isArray(saved.frames)) frames = bowlingReplayFrames(saved.frames).data;
  } catch (error) {
    console.error("Could not read the game in progress.", error);
  }
  bowlingLive = { frames };
  return bowlingLive;
}

function bowlingStoreLive() {
  try {
    if (bowlingLive.frames.length) localStorage.setItem(bowlingLiveKey, JSON.stringify({ frames: bowlingLive.frames, updatedAt: new Date().toISOString() }));
    else localStorage.removeItem(bowlingLiveKey);
  } catch (error) {
    console.error("Could not save the game in progress.", error);
  }
}

function bowlingRecordThrow(standing) {
  const live = bowlingLoadLive();
  const replay = bowlingReplayFrames(live.frames);
  if (!replay.next) return;
  const { frame, before } = replay.next;
  const frames = replay.data;
  if (!frames[frame]) frames[frame] = [];
  frames[frame].push(standing & before);
  live.frames = bowlingReplayFrames(frames).data;
  bowlingLiveSelection = 0;
  bowlingLiveStatus = { text: "", error: false };
  bowlingLiveConfirmReset = false;
  bowlingStoreLive();
}

function bowlingUndoThrow() {
  const live = bowlingLoadLive();
  const frames = bowlingReplayFrames(live.frames).data;
  if (!frames.length) return;
  frames[frames.length - 1].pop();
  if (!frames[frames.length - 1].length) frames.pop();
  live.frames = frames;
  bowlingLiveSelection = 0;
  bowlingLiveStatus = { text: "", error: false };
  bowlingStoreLive();
}

function bowlingResetLive() {
  bowlingLoadLive().frames = [];
  bowlingLiveSelection = 0;
  bowlingLiveConfirmReset = false;
  bowlingStoreLive();
}

// ---------- Scoresheet ----------

function createBowlingScoresheet(frames, { current = -1, label = "Scoresheet" } = {}) {
  const replay = bowlingReplayFrames(frames);
  const sheet = element("ol", "bowling-sheet");
  sheet.setAttribute("aria-label", label);
  for (let index = 0; index < 10; index++) {
    const frame = replay.frames[index];
    const cell = element("li", `bowling-sheet-frame${index === 9 ? " is-tenth" : ""}${index === current ? " is-current" : ""}`);
    const marks = element("div", "bowling-sheet-marks");
    const slots = index === 9 ? 3 : 2;
    const spoken = [];
    for (let slot = 0; slot < slots; slot++) {
      const item = frame?.throws[slot];
      // A strike in frames 1-9 is written in the second box, as on a real sheet.
      const shown = index < 9 && frame?.throws[0]?.mask === 0 ? (slot === 1 ? frame.throws[0] : null) : item;
      const box = element("span", `bowling-sheet-mark${shown?.split ? " is-split" : ""}`, shown ? bowlingThrowMark(shown) : "");
      box.setAttribute("aria-hidden", "true");
      marks.append(box);
    }
    for (const item of frame?.throws || []) {
      const mark = bowlingThrowMark(item);
      spoken.push(mark === "X" ? "strike" : mark === "/" ? "spare" : mark === "-" ? "miss" : `${mark}${item.split ? " split" : ""}`);
    }
    const total = element("span", "bowling-sheet-total", frame?.cumulative == null ? "" : String(frame.cumulative));
    total.setAttribute("aria-hidden", "true");
    const head = element("span", "bowling-sheet-number", String(index + 1));
    head.setAttribute("aria-hidden", "true");
    cell.append(head, marks, total);
    const sr = element("span", "bowling-sr", `Frame ${index + 1}: ${spoken.length ? spoken.join(", ") : "not bowled"}${frame?.cumulative == null ? "" : `, total ${frame.cumulative}`}`);
    cell.append(sr);
    sheet.append(cell);
  }
  return sheet;
}

// ---------- Tracker panel ----------

function bowlingLiveSummary(replay) {
  if (!replay.next) return `Final score ${replay.total}`;
  const { frame, ball, before, fresh } = replay.next;
  const standing = bowlingPinCount(before);
  const where = `Frame ${frame + 1}, ball ${ball + 1}`;
  if (fresh) return `${where} · full rack`;
  return `${where} · ${standing} pin${standing === 1 ? "" : "s"} left (${bowlingLeaveName(before)}${bowlingIsSplit(before) ? " split" : ""})`;
}

function createBowlingPinDeck(next) {
  const deck = element("div", "bowling-deck");
  deck.setAttribute("role", "group");
  deck.setAttribute("aria-label", "Pins left standing. Number keys 1 to 9 and 0 for the 10 pin.");
  for (const row of bowlingPinRows) {
    const line = element("div", "bowling-deck-row");
    for (const pin of row) {
      const bit = bowlingPinBit(pin);
      const available = Boolean(next.before & bit);
      const standing = Boolean(bowlingLiveSelection & bit);
      const button = element("button", `bowling-pin${standing ? " is-standing" : ""}${available ? "" : " is-down"}`, String(pin));
      button.type = "button";
      button.id = `bowling-pin-${pin}`;
      button.disabled = !available;
      button.setAttribute("aria-pressed", String(standing));
      button.setAttribute("aria-label", available ? `Pin ${pin}${standing ? ", standing" : ""}` : `Pin ${pin}, already down`);
      button.addEventListener("click", () => {
        bowlingLiveSelection ^= bit;
        bowlingRefresh(button.id);
      });
      line.append(button);
    }
    deck.append(line);
  }
  return deck;
}

function bowlingRecordLabel(next) {
  const standing = bowlingLiveSelection & next.before;
  if (!standing) return next.fresh ? "Strike" : "Spare";
  const knocked = bowlingPinCount(next.before) - bowlingPinCount(standing);
  const leave = `${bowlingLeaveName(standing)}${next.fresh && bowlingIsSplit(standing) ? " split" : ""}`;
  return `${knocked} pin${knocked === 1 ? "" : "s"}, leave ${leave}`;
}

// Link from the League night dashboard; it names the frame when a game is in progress.
function createBowlingScorerLink() {
  const replay = bowlingReplayFrames(bowlingLoadLive().frames);
  const inProgress = replay.data.length && replay.next;
  const link = element("a", "bowling-head-link", inProgress ? `Resume game · frame ${replay.next.frame + 1}` : replay.complete ? "Save tracked game" : "Score a game");
  link.href = "#bowling/scorer";
  return link;
}

function bowlingSaveTargets(state) {
  const today = bowlingToday();
  const options = [["new", `New session · ${bowlingFormatDate(today, { weekday: "short", month: "short", day: "numeric" })}`]];
  for (const session of state.sessions.slice(0, 8)) {
    const room = session.games.some((game) => game.score === null && !game.frames) || session.games.length < bowlingMaxGames;
    if (!room) continue;
    options.push([session.id, `${bowlingFormatDate(session.date, { weekday: "short", month: "short", day: "numeric" })} · ${bowlingTypeLabel(session.type)} · ${session.games.length} game${session.games.length === 1 ? "" : "s"}`]);
  }
  return options;
}

function bowlingSaveLiveGame() {
  const replay = bowlingReplayFrames(bowlingLoadLive().frames);
  if (!replay.complete) return;
  const state = bowlingGetState();
  const target = bowlingLiveTarget && bowlingLiveTarget !== "new" ? state.sessions.find((session) => session.id === bowlingLiveTarget) : null;
  let message = "";
  const saved = bowlingCommit((next, now) => {
    const game = { id: bowlingId("game"), score: replay.total, adjustments: [], frames: replay.data };
    if (target) {
      const session = next.sessions.find((item) => item.id === target.id);
      const slot = session.games.findIndex((item) => item.score === null && !item.frames);
      if (slot >= 0) session.games[slot] = { ...session.games[slot], score: replay.total, frames: replay.data };
      else session.games.push(game);
      session.updatedAt = now;
      message = `Saved as game ${slot >= 0 ? slot + 1 : session.games.length} of your ${bowlingFormatDate(session.date, { weekday: "long", month: "short", day: "numeric" })} session.`;
    } else {
      next.sessions.push({ id: bowlingId("session"), date: bowlingToday(), type: "league", center: "", startBall: null, notes: "", games: [game], createdAt: now, updatedAt: now });
      message = "Saved as a new session for today.";
    }
  });
  bowlingResetLive();
  bowlingLiveTarget = null;
  bowlingLiveStatus = saved ? { text: message, error: false, link: target ? "View it in League night" : "Add the center, balls and notes in League night" } : { text: "Saved for this visit only; browser storage is unavailable.", error: true };
  bowlingRefresh("bowling-live-status");
}

function createBowlingTracker(state) {
  const panel = element("section", "bowling-panel bowling-tracker");
  panel.setAttribute("aria-labelledby", "bowling-tracker-title");
  const head = element("div", "bowling-panel-head");
  const title = element("h3", "", "Game tracker");
  title.id = "bowling-tracker-title";
  title.tabIndex = -1;
  const replay = bowlingReplayFrames(bowlingLoadLive().frames);
  const score = element("div", "bowling-tracker-score");
  score.append(
    element("strong", "", String(replay.complete ? replay.total : replay.running)),
    element("span", "", replay.complete ? "Final" : `Max possible ${bowlingMaxPossible(replay.data)}`)
  );
  const heading = element("div", "bowling-tracker-heading");
  const back = element("a", "bowling-head-link", "League night dashboard");
  back.href = "#bowling";
  heading.append(title, back);
  head.append(heading, score);
  panel.append(head, createBowlingScoresheet(replay.data, { current: replay.next?.frame ?? -1, label: "Current game" }));

  const status = element("p", `bowling-status bowling-live-status${bowlingLiveStatus.error ? " error" : ""}`, bowlingLiveStatus.text);
  status.id = "bowling-live-status";
  status.tabIndex = -1;
  status.setAttribute("role", "status");
  if (bowlingLiveStatus.link) {
    const view = element("a", "", bowlingLiveStatus.link);
    view.href = "#bowling";
    status.append(" ", view);
  }

  if (replay.next) {
    const next = replay.next;
    const where = element("p", "bowling-tracker-where", bowlingLiveSummary(replay));
    where.id = "bowling-tracker-where";
    const hint = element("p", "bowling-tracker-hint", next.fresh
      ? "Tap the pins still standing, then record the throw. No pins selected means a strike."
      : "Tap the pins still standing after this ball. No pins selected means a spare.");
    const actions = element("div", "bowling-tracker-actions");
    const record = element("button", "bowling-record", bowlingRecordLabel(next));
    record.type = "button";
    record.id = "bowling-record";
    record.addEventListener("click", () => {
      bowlingRecordThrow(bowlingLiveSelection);
      bowlingRefresh(bowlingReplayFrames(bowlingLoadLive().frames).complete ? "bowling-save-target" : "bowling-record");
    });
    const miss = element("button", "secondary", next.fresh ? "Gutter" : "Missed");
    miss.type = "button";
    miss.id = "bowling-miss";
    miss.setAttribute("aria-label", next.fresh ? "Gutter ball: all ten pins standing" : "Missed: no pins knocked down");
    miss.addEventListener("click", () => {
      bowlingRecordThrow(next.before);
      bowlingRefresh("bowling-record");
    });
    actions.append(record, miss);
    panel.append(where, hint, createBowlingPinDeck(next), actions);
    panel.addEventListener("keydown", (event) => {
      if (event.target.closest("select, input, textarea") || event.ctrlKey || event.metaKey || event.altKey) return;
      if (/^[0-9]$/.test(event.key)) {
        const pin = event.key === "0" ? 10 : Number(event.key);
        if (!(next.before & bowlingPinBit(pin))) return;
        event.preventDefault();
        bowlingLiveSelection ^= bowlingPinBit(pin);
        bowlingRefresh(`bowling-pin-${pin}`);
      }
    });
  } else {
    const save = element("div", "bowling-tracker-save");
    const options = bowlingSaveTargets(state);
    if (!options.some(([value]) => value === bowlingLiveTarget)) {
      bowlingLiveTarget = state.sessions.find((session) => session.date === bowlingToday() && options.some(([value]) => value === session.id))?.id || "new";
    }
    const select = bowlingSelect("bowling-save-target", options, bowlingLiveTarget);
    select.addEventListener("change", () => { bowlingLiveTarget = select.value; });
    const button = element("button", "", "Save game");
    button.type = "button";
    button.id = "bowling-save-game";
    button.addEventListener("click", bowlingSaveLiveGame);
    save.append(bowlingField("Save to", select), button);
    panel.append(element("p", "bowling-tracker-where", `Game over: ${replay.total}.`), save);
  }

  const tools = element("div", "bowling-tracker-tools");
  const undo = element("button", "secondary", "Undo last throw");
  undo.type = "button";
  undo.id = "bowling-undo";
  undo.disabled = !replay.data.length;
  undo.addEventListener("click", () => {
    bowlingUndoThrow();
    bowlingRefresh("bowling-undo");
  });
  const reset = element("button", "secondary bowling-delete", bowlingLiveConfirmReset ? "Confirm new game" : "New game");
  reset.type = "button";
  reset.id = "bowling-reset";
  reset.disabled = !replay.data.length;
  reset.addEventListener("click", () => {
    if (!bowlingLiveConfirmReset) {
      bowlingLiveConfirmReset = true;
      bowlingRefresh(reset.id);
      return;
    }
    bowlingResetLive();
    bowlingLiveStatus = { text: "Started a new game.", error: false };
    bowlingRefresh("bowling-record");
  });
  reset.addEventListener("blur", () => {
    setTimeout(() => {
      if (!reset.isConnected || !bowlingLiveConfirmReset) return;
      bowlingLiveConfirmReset = false;
      reset.textContent = "New game";
    }, 0);
  });
  tools.append(undo, reset);
  panel.append(tools, status);
  return panel;
}

// ---------- Stats from saved frame-by-frame games ----------

function bowlingFrameStats(sessions) {
  const stats = { games: 0, total: 0, firstBalls: 0, firstPins: 0, strikes: 0, chances: 0, spares: 0, singles: 0, singlesMade: 0, splits: 0, splitsMade: 0, leaves: new Map() };
  for (const session of sessions) {
    for (const game of session.games) {
      if (!game.frames) continue;
      const replay = bowlingReplayFrames(game.frames);
      if (!replay.complete) continue;
      stats.games += 1;
      stats.total += replay.total;
      for (const frame of replay.frames) {
        for (const item of frame.throws) {
          if (item.fresh) {
            stats.firstBalls += 1;
            stats.firstPins += item.knocked;
            if (item.mask === 0) stats.strikes += 1;
            continue;
          }
          const made = item.mask === 0;
          stats.chances += 1;
          if (made) stats.spares += 1;
          if (bowlingPinCount(item.before) === 1) {
            stats.singles += 1;
            if (made) stats.singlesMade += 1;
          }
          if (bowlingIsSplit(item.before)) {
            stats.splits += 1;
            if (made) stats.splitsMade += 1;
          }
          const leave = stats.leaves.get(item.before) || { mask: item.before, times: 0, made: 0 };
          leave.times += 1;
          if (made) leave.made += 1;
          stats.leaves.set(item.before, leave);
        }
      }
    }
  }
  return stats;
}

function bowlingPercent(part, whole) {
  return whole ? `${Math.round((part / whole) * 100)}%` : "—";
}

function createBowlingFrameStats(state) {
  const panel = element("section", "bowling-panel bowling-frame-stats");
  panel.setAttribute("aria-labelledby", "bowling-frame-stats-title");
  const title = element("h3", "", "Spares and leaves");
  title.id = "bowling-frame-stats-title";
  panel.append(title);
  const stats = bowlingFrameStats(state.sessions);
  if (!stats.games) {
    panel.append(element("p", "bowling-empty", "Finish and save a tracked game to see your strike rate, spare conversion and the leaves you see most."));
    return panel;
  }
  const metrics = element("div", "bowling-metrics");
  for (const [label, value, note] of [
    ["Strikes", bowlingPercent(stats.strikes, stats.firstBalls), `${stats.strikes} of ${stats.firstBalls} first balls`],
    ["Spares", bowlingPercent(stats.spares, stats.chances), `${stats.spares} of ${stats.chances} chances`],
    ["Single pins", bowlingPercent(stats.singlesMade, stats.singles), `${stats.singlesMade} of ${stats.singles}`],
    ["Splits", bowlingPercent(stats.splitsMade, stats.splits), `${stats.splitsMade} of ${stats.splits} converted`],
    ["First-ball avg", stats.firstBalls ? (stats.firstPins / stats.firstBalls).toFixed(1) : "—", "Pins per first ball"],
    ["Tracked games", String(stats.games), `Average ${bowlingFormatAverage(stats.total / stats.games)}`]
  ]) {
    const metric = element("div", "bowling-metric");
    metric.append(element("span", "", label), element("strong", "", value), element("small", "", note));
    metrics.append(metric);
  }
  panel.append(metrics);
  const leaves = [...stats.leaves.values()].sort((a, b) => b.times - a.times || a.mask - b.mask).slice(0, 10);
  if (leaves.length) {
    const table = element("table", "bowling-leaves");
    const caption = element("caption", "", "Most common leaves");
    const head = element("thead", "");
    const headRow = element("tr", "");
    for (const text of ["Leave", "Seen", "Converted"]) {
      const cell = element("th", "", text);
      cell.scope = "col";
      headRow.append(cell);
    }
    head.append(headRow);
    const body = element("tbody", "");
    for (const leave of leaves) {
      const row = element("tr", "");
      const name = element("th", "", bowlingLeaveName(leave.mask));
      name.scope = "row";
      if (bowlingIsSplit(leave.mask)) name.append(element("span", "bowling-split-tag", "split"));
      row.append(name, element("td", "", String(leave.times)), element("td", "", `${leave.made} · ${bowlingPercent(leave.made, leave.times)}`));
      body.append(row);
    }
    table.append(caption, head, body);
    panel.append(table);
  }
  return panel;
}

function createBowlingScorerView() {
  const state = bowlingGetState();
  const layout = element("div", "bowling-scorer");
  layout.append(createBowlingTracker(state), createBowlingFrameStats(state));
  return layout;
}
