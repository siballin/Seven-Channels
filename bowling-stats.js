// Bowling stats: averages over time, by game, score ranges, and frame-by-frame
// detail (strikes, spares, opens, pins left) from games kept in the score tracker.
// Loaded after bowling.js and bowling-scorer.js; reuses their helpers.

let bowlingStatsFilters = { range: "all", league: "all", type: "all" };
const bowlingStatsRanges = [["all", "All time"], ["last10", "Last 10 sessions"], ["90", "Last 90 days"], ["year", "This year"]];
const bowlingStatsBuckets = [[0, 119, "Under 120"], [120, 139, "120–139"], [140, 159, "140–159"], [160, 179, "160–179"], [180, 199, "180–199"], [200, 219, "200–219"], [220, 239, "220–239"], [240, 300, "240+"]];
const bowlingStatsRolling = 5;

function bowlingStatsDaysAgo(days, today = bowlingToday()) {
  const date = new Date(`${today}T12:00:00`);
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Oldest first, so charts read left to right.
function bowlingStatsSessions(sessions, filters = bowlingStatsFilters, today = bowlingToday()) {
  let list = sessions.filter((session) => (filters.type === "all" || session.type === filters.type)
    && (filters.league === "all" || session.league?.id === filters.league));
  if (filters.range === "90") list = list.filter((session) => session.date >= bowlingStatsDaysAgo(90, today));
  if (filters.range === "year") list = list.filter((session) => session.date.slice(0, 4) === today.slice(0, 4));
  list = list.slice().sort((a, b) => a.date.localeCompare(b.date) || bowlingTime(a.createdAt) - bowlingTime(b.createdAt) || a.id.localeCompare(b.id));
  if (filters.range === "last10") list = list.filter((session) => bowlingScores(session).length).slice(-10);
  return list;
}

function bowlingStatsAverage(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

// Every number on the Stats tab comes from here, so it can be unit tested.
function bowlingStatsData(sessions) {
  const scores = sessions.flatMap(bowlingScores);
  const average = bowlingStatsAverage(scores);
  const spread = scores.length > 1 ? Math.sqrt(scores.reduce((sum, score) => sum + (score - average) ** 2, 0) / scores.length) : null;
  const series = sessions.map(bowlingSeriesSummary).filter((summary) => summary.complete).map((summary) => summary.total);
  const trend = [];
  for (const session of sessions) {
    const own = bowlingScores(session);
    if (!own.length) continue;
    const window = trend.slice(-(bowlingStatsRolling - 1)).flatMap((item) => item.scores).concat(own);
    trend.push({ session, scores: own, average: bowlingStatsAverage(own), rolling: bowlingStatsAverage(window) });
  }
  const byGame = [];
  for (const session of sessions) {
    session.games.forEach((game, index) => {
      if (game.score === null || index > 4) return;
      byGame[index] ||= { game: index + 1, scores: [] };
      byGame[index].scores.push(game.score);
    });
  }
  const buckets = bowlingStatsBuckets.map(([low, high, label]) => ({ label, count: scores.filter((score) => score >= low && score <= high).length }));
  return {
    sessions: sessions.length,
    games: scores.length,
    average,
    spread,
    high: scores.length ? Math.max(...scores) : null,
    low: scores.length ? Math.min(...scores) : null,
    highSeries: series.length ? Math.max(...series) : null,
    over200: scores.filter((score) => score >= 200).length,
    trend,
    byGame: byGame.filter(Boolean).map((item) => ({ game: item.game, count: item.scores.length, average: bowlingStatsAverage(item.scores) })),
    buckets,
    frames: bowlingStatsFrames(sessions)
  };
}

// Frame-by-frame numbers, only from complete tracked games.
function bowlingStatsFrames(sessions) {
  const base = bowlingFrameStats(sessions);
  const extra = { frames: 0, opens: 0, cleanGames: 0, doubleChances: 0, doubles: 0, pinLeft: Array(11).fill(0), pinChances: Array(11).fill(0), pinMade: Array(11).fill(0), trend: [] };
  for (const session of sessions) {
    let strikes = 0;
    let firstBalls = 0;
    let spares = 0;
    let chances = 0;
    for (const game of session.games) {
      if (!game.frames) continue;
      const replay = bowlingReplayFrames(game.frames);
      if (!replay.complete) continue;
      let clean = true;
      let lastWasStrike = false;
      replay.frames.forEach((frame) => {
        const [first, second] = frame.throws;
        // A frame is open unless its first ball strikes or its second ball spares (10th-frame bonus balls don't count).
        extra.frames += 1;
        const marked = first.mask === 0 || (second && second.mask === 0 && !second.fresh);
        if (!marked) {
          extra.opens += 1;
          clean = false;
        }
        for (const item of frame.throws) {
          if (item.fresh) {
            if (lastWasStrike) {
              extra.doubleChances += 1;
              if (item.mask === 0) extra.doubles += 1;
            }
            lastWasStrike = item.mask === 0;
            firstBalls += 1;
            if (item.mask === 0) strikes += 1;
            for (const pin of bowlingPinsOf(item.mask)) extra.pinLeft[pin] += 1;
          } else {
            lastWasStrike = false;
            chances += 1;
            if (item.mask === 0) spares += 1;
            for (const pin of bowlingPinsOf(item.before)) {
              extra.pinChances[pin] += 1;
              if (!(item.mask & bowlingPinBit(pin))) extra.pinMade[pin] += 1;
            }
          }
        }
      });
      if (clean) extra.cleanGames += 1;
    }
    if (firstBalls) extra.trend.push({ session, strike: strikes / firstBalls, spare: chances ? spares / chances : null, firstBalls, chances });
  }
  return { ...base, ...extra };
}

// ---------- By ball ----------

// Per-ball numbers. Throw-level stats (strikes, carry, spares, leaves) come from Score tracker games that
// recorded a ball; game averages also use League night's starting ball and ball changes for other games.
function bowlingStatsBalls(sessions, state = bowlingGetState()) {
  const rows = new Map();
  const names = {};
  const row = (id) => {
    if (!rows.has(id)) {
      rows.set(id, {
        id, games: 0, total: 0,
        firstBalls: 0, strikes: 0, firstPins: 0, pocketKnown: 0, pocketHits: 0, pocketStrikes: 0, splitsLeft: 0,
        leaves: new Map(),
        chances: 0, spares: 0, singles: 0, singlesMade: 0, tens: 0, tensMade: 0, sevens: 0, sevensMade: 0
      });
    }
    return rows.get(id);
  };
  for (const session of sessions) {
    let current = session.startBall?.id || "";
    if (session.startBall) names[current] ||= session.startBall.name;
    for (const game of session.games) {
      const replay = game.frames ? bowlingReplayFrames(game.frames) : null;
      const counts = new Map();
      if (replay?.complete && game.balls) {
        Object.assign(names, game.ballNames || {});
        replay.frames.forEach((frame, index) => frame.throws.forEach((item, slot) => {
          const id = game.balls[index]?.[slot];
          if (!id) return;
          const entry = row(id);
          if (item.fresh) {
            counts.set(id, (counts.get(id) || 0) + 1);
            entry.firstBalls += 1;
            entry.firstPins += item.knocked;
            if (item.mask === 0) entry.strikes += 1;
            else {
              const leave = entry.leaves.get(item.mask) || { mask: item.mask, times: 0 };
              leave.times += 1;
              entry.leaves.set(item.mask, leave);
              if (item.split) entry.splitsLeft += 1;
            }
            const pocket = game.pocket?.[index]?.[slot];
            if (pocket === 1 || pocket === 0) {
              entry.pocketKnown += 1;
              if (pocket === 1) {
                entry.pocketHits += 1;
                if (item.mask === 0) entry.pocketStrikes += 1;
              }
            }
          } else {
            const made = item.mask === 0;
            entry.chances += 1;
            if (made) entry.spares += 1;
            if (bowlingPinCount(item.before) === 1) {
              entry.singles += 1;
              if (made) entry.singlesMade += 1;
              if (item.before === bowlingPinBit(10)) { entry.tens += 1; if (made) entry.tensMade += 1; }
              if (item.before === bowlingPinBit(7)) { entry.sevens += 1; if (made) entry.sevensMade += 1; }
            }
          }
        }));
      }
      // The game counts toward the ball thrown most on first balls, or else the ball in use when it started.
      const tracked = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const owner = tracked || current;
      if (owner && game.score !== null) {
        const entry = row(owner);
        entry.games += 1;
        entry.total += game.score;
      }
      const switched = game.adjustments.filter((adjustment) => adjustment.ball).pop();
      if (switched) {
        current = switched.ball.id;
        names[current] ||= switched.ball.name;
      }
    }
  }
  return [...rows.values()]
    .map((entry) => ({
      ...entry,
      name: bowlingBallNameFor(entry.id, state, names),
      average: entry.games ? entry.total / entry.games : null,
      topLeaves: [...entry.leaves.values()].sort((a, b) => b.times - a.times || a.mask - b.mask).slice(0, 3)
    }))
    .sort((a, b) => b.games - a.games || b.firstBalls - a.firstBalls || b.chances - a.chances || a.name.localeCompare(b.name));
}

// ---------- Rendering ----------

function bowlingStatsSelect(id, label, options, value, key) {
  const select = element("select", "");
  select.id = id;
  for (const [optionValue, text] of options) {
    const option = element("option", "", text);
    option.value = optionValue;
    option.selected = optionValue === value;
    select.append(option);
  }
  select.addEventListener("change", () => {
    bowlingStatsFilters = { ...bowlingStatsFilters, [key]: select.value };
    bowlingRefresh(id);
  });
  return bowlingField(label, select);
}

function bowlingStatsMetrics(items) {
  const metrics = element("div", "bowling-metrics");
  for (const [label, value, note] of items) {
    const metric = element("div", "bowling-metric");
    metric.append(element("span", "", label), element("strong", "", value));
    if (note) metric.append(element("small", "", note));
    metrics.append(metric);
  }
  return metrics;
}

function bowlingStatsPanel(id, titleText, note) {
  const panel = element("section", "bowling-panel bowling-stats-panel");
  panel.setAttribute("aria-labelledby", id);
  const title = element("h3", "", titleText);
  title.id = id;
  panel.append(title);
  if (note) panel.append(element("p", "bowling-stats-note", note));
  return panel;
}

// A small line chart. `series` items: { name, key, className, line, dots }; rows: [{ label, short, values: {key: number|null} }].
function bowlingStatsLineChart({ rows, series, min, max, format, ariaLabel }) {
  const width = matchMedia("(max-width: 560px)").matches ? 360 : 640;
  const height = 200;
  const pad = { top: 16, right: 18, bottom: 28, left: 44 };
  const x = (index) => rows.length === 1 ? pad.left + (width - pad.left - pad.right) / 2 : pad.left + index * (width - pad.left - pad.right) / (rows.length - 1);
  const y = (value) => pad.top + (max - value) * (height - pad.top - pad.bottom) / (max - min);
  const ns = "http://www.w3.org/2000/svg";
  const node = (tag, attributes, text) => {
    const item = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) item.setAttribute(key, value);
    if (text !== undefined) item.textContent = text;
    return item;
  };
  const svg = node("svg", { viewBox: `0 0 ${width} ${height}`, class: "bowling-chart", role: "img", "aria-label": ariaLabel });
  for (const value of [min, (min + max) / 2, max]) {
    svg.append(
      node("line", { x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value), class: "bowling-chart-grid" }),
      node("text", { x: pad.left - 8, y: y(value) + 4, "text-anchor": "end", class: "bowling-chart-axis" }, format(value))
    );
  }
  for (const item of series) {
    const points = rows.map((row, index) => row.values[item.key] === null || row.values[item.key] === undefined ? null : `${x(index)},${y(row.values[item.key])}`);
    if (item.line && rows.length > 1) {
      // Break the line where a value is missing instead of bridging it.
      let run = [];
      for (const point of [...points, null]) {
        if (point) run.push(point);
        else {
          if (run.length > 1) svg.append(node("polyline", { points: run.join(" "), class: `bowling-stats-line ${item.className}` }));
          run = [];
        }
      }
    }
    if (item.dots) points.forEach((point, index) => {
      if (point) svg.append(node("circle", { cx: x(index), cy: y(rows[index].values[item.key]), r: 4, class: `bowling-stats-dot ${item.className}` }));
    });
  }
  const tooltip = element("div", "bowling-chart-tooltip");
  tooltip.hidden = true;
  rows.forEach((row, index) => {
    const label = `${row.label}: ${series.map((item) => `${item.name} ${row.values[item.key] === null || row.values[item.key] === undefined ? "—" : format(row.values[item.key], true)}`).join(" · ")}`;
    const left = rows.length === 1 ? pad.left : index === 0 ? pad.left : (x(index - 1) + x(index)) / 2;
    const right = rows.length === 1 ? width - pad.right : index === rows.length - 1 ? width - pad.right : (x(index) + x(index + 1)) / 2;
    const hit = node("rect", { x: left, y: pad.top, width: Math.max(1, right - left), height: height - pad.top - pad.bottom, class: "bowling-chart-hit", tabindex: "0", "aria-label": label });
    const anchor = Math.min(...series.map((item) => row.values[item.key]).filter((value) => value !== null && value !== undefined));
    const show = () => {
      tooltip.textContent = label;
      tooltip.hidden = false;
      tooltip.style.left = `${Math.min(80, Math.max(20, x(index) / width * 100))}%`;
      tooltip.style.top = `${y(Number.isFinite(anchor) ? anchor : max) / height * 100}%`;
    };
    const hide = () => { tooltip.hidden = true; };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", show);
    hit.addEventListener("blur", hide);
    svg.append(hit);
  });
  const labels = new Set([0, rows.length - 1]);
  rows.forEach((row, index) => {
    if (!labels.has(index)) return;
    svg.append(node("text", { x: x(index), y: height - 8, "text-anchor": rows.length === 1 ? "middle" : index === 0 ? "start" : "end", class: "bowling-chart-axis" }, row.short));
  });
  const legend = element("div", "bowling-stats-legend");
  for (const item of series) {
    const key = element("span", `bowling-stats-key ${item.className}${item.line ? " is-line" : ""}`);
    key.setAttribute("aria-hidden", "true");
    const entry = element("span", "");
    entry.append(key, item.name);
    legend.append(entry);
  }
  const plot = element("div", "bowling-chart-plot");
  plot.append(svg, tooltip);
  const details = element("details", "bowling-chart-data");
  details.append(element("summary", "", "Show data"));
  const table = element("table", "");
  const head = element("tr", "");
  ["Date", ...series.map((item) => item.name)].forEach((text) => head.append(element("th", "", text)));
  const thead = element("thead", "");
  thead.append(head);
  const tbody = element("tbody", "");
  for (const row of rows.slice().reverse()) {
    const line = element("tr", "");
    line.append(element("td", "", row.label));
    for (const item of series) line.append(element("td", "", row.values[item.key] === null || row.values[item.key] === undefined ? "—" : format(row.values[item.key], true)));
    tbody.append(line);
  }
  table.append(thead, tbody);
  details.append(table);
  const figure = element("figure", "bowling-trend");
  figure.append(legend, plot, details);
  return figure;
}

function bowlingStatsBars(rows, { label, value, text }) {
  const list = element("div", "bowling-stats-bars");
  const top = Math.max(1, ...rows.map(value));
  for (const row of rows) {
    const item = element("div", "bowling-stats-bar");
    const track = element("span", "bowling-stats-track");
    const fill = element("span", "bowling-stats-fill");
    fill.style.width = `${value(row) / top * 100}%`;
    track.append(fill);
    item.append(element("span", "bowling-stats-bar-label", label(row)), track, element("span", "bowling-stats-bar-value", text(row)));
    list.append(item);
  }
  return list;
}

function bowlingStatsPinMap(frames) {
  const wrap = element("div", "bowling-stats-pins");
  const deck = element("div", "bowling-deck bowling-stats-deck");
  deck.setAttribute("role", "img");
  const parts = [];
  for (const row of bowlingPinRows) {
    const line = element("div", "bowling-deck-row");
    for (const pin of row) {
      const share = frames.firstBalls ? frames.pinLeft[pin] / frames.firstBalls : 0;
      const pinNode = element("span", "bowling-stats-pin");
      pinNode.style.setProperty("--share", String(Math.min(1, share * 2.5)));
      pinNode.append(element("b", "", String(pin)), element("small", "", bowlingPercent(frames.pinLeft[pin], frames.firstBalls)));
      line.append(pinNode);
      parts.push(`pin ${pin} ${bowlingPercent(frames.pinLeft[pin], frames.firstBalls)}`);
    }
    deck.append(line);
  }
  deck.setAttribute("aria-label", `Share of first balls that left each pin standing: ${parts.join(", ")}`);
  const table = element("table", "bowling-leaves");
  table.append(element("caption", "", "Each pin"));
  const thead = element("thead", "");
  const headRow = element("tr", "");
  for (const text of ["Pin", "Left after first ball", "Picked up"]) {
    const cell = element("th", "", text);
    cell.scope = "col";
    headRow.append(cell);
  }
  thead.append(headRow);
  const tbody = element("tbody", "");
  const order = [...Array(10).keys()].map((index) => index + 1).sort((a, b) => frames.pinLeft[b] - frames.pinLeft[a] || a - b);
  for (const pin of order) {
    if (!frames.pinLeft[pin]) continue;
    const row = element("tr", "");
    const name = element("th", "", `${pin} pin`);
    name.scope = "row";
    row.append(name,
      element("td", "", `${frames.pinLeft[pin]} · ${bowlingPercent(frames.pinLeft[pin], frames.firstBalls)}`),
      element("td", "", frames.pinChances[pin] ? `${frames.pinMade[pin]} of ${frames.pinChances[pin]} · ${bowlingPercent(frames.pinMade[pin], frames.pinChances[pin])}` : "—"));
    tbody.append(row);
  }
  table.append(thead, tbody);
  wrap.append(deck, table);
  return wrap;
}

function bowlingStatsLeaves(frames) {
  const leaves = [...frames.leaves.values()].sort((a, b) => b.times - a.times || a.mask - b.mask).slice(0, 10);
  const table = element("table", "bowling-leaves");
  table.append(element("caption", "", "Most common leaves"));
  const thead = element("thead", "");
  const headRow = element("tr", "");
  for (const text of ["Leave", "Seen", "Converted"]) {
    const cell = element("th", "", text);
    cell.scope = "col";
    headRow.append(cell);
  }
  thead.append(headRow);
  const tbody = element("tbody", "");
  for (const leave of leaves) {
    const row = element("tr", "");
    const name = element("th", "", bowlingLeaveName(leave.mask));
    name.scope = "row";
    if (bowlingIsSplit(leave.mask)) name.append(element("span", "bowling-split-tag", "split"));
    row.append(name, element("td", "", String(leave.times)), element("td", "", `${leave.made} · ${bowlingPercent(leave.made, leave.times)}`));
    tbody.append(row);
  }
  table.append(thead, tbody);
  return table;
}

function createBowlingStatsView() {
  const state = bowlingGetState();
  if (bowlingStatsFilters.league !== "all" && !state.leagues.some((league) => league.id === bowlingStatsFilters.league)) bowlingStatsFilters.league = "all";
  const sessions = bowlingStatsSessions(state.sessions);
  const data = bowlingStatsData(sessions);
  const root = element("div", "bowling-stats");

  const head = element("section", "bowling-panel bowling-stats-head");
  head.setAttribute("aria-labelledby", "bowling-stats-title");
  const title = element("h3", "", "Stats");
  title.id = "bowling-stats-title";
  const filters = element("div", "bowling-stats-filters");
  filters.append(
    bowlingStatsSelect("bowling-stats-range", "Time", bowlingStatsRanges, bowlingStatsFilters.range, "range"),
    bowlingStatsSelect("bowling-stats-type", "Type", [["all", "All sessions"], ...bowlingSessionTypes], bowlingStatsFilters.type, "type")
  );
  if (state.leagues.length) {
    filters.append(bowlingStatsSelect("bowling-stats-league", "League", [["all", "All leagues"], ...state.leagues.map((league) => [league.id, league.name])], bowlingStatsFilters.league, "league"));
  }
  head.append(title, filters);
  root.append(head);

  if (!data.games) {
    const empty = element("p", "bowling-empty", state.sessions.length
      ? "No scored games match these filters."
      : "Log a session in League night or keep score in the Score tracker to see your stats.");
    head.append(empty);
    return root;
  }

  head.append(bowlingStatsMetrics([
    ["Average", bowlingFormatAverage(data.average), `${data.games} game${data.games === 1 ? "" : "s"} · ${data.sessions} session${data.sessions === 1 ? "" : "s"}`],
    ["High game", String(data.high), `Low ${data.low}`],
    ["High series", data.highSeries === null ? "—" : String(data.highSeries), "Three-game series"],
    ["200+ games", String(data.over200), bowlingPercent(data.over200, data.games)],
    ["Consistency", data.spread === null ? "—" : `±${Math.round(data.spread)}`, "Typical distance from your average"],
    ["Frame-by-frame", String(data.frames.games), data.frames.games ? "Games kept in the Score tracker" : "None yet"]
  ]));

  const trendPanel = bowlingStatsPanel("bowling-stats-trend", "Average over time", `Each night's average, and your average over the last ${bowlingStatsRolling} nights.`);
  if (data.trend.length < 2) {
    trendPanel.append(element("p", "bowling-empty", "Your trend appears after two nights with scores."));
  } else {
    const values = data.trend.flatMap((item) => [item.average, item.rolling]);
    const min = Math.max(0, Math.floor((Math.min(...values) - 10) / 20) * 20);
    const max = Math.min(300, Math.max(min + 40, Math.ceil((Math.max(...values) + 10) / 20) * 20));
    trendPanel.append(bowlingStatsLineChart({
      rows: data.trend.map((item) => ({
        label: bowlingFormatDate(item.session.date, { month: "short", day: "numeric", year: "numeric" }),
        short: bowlingFormatDate(item.session.date, { month: "short", day: "numeric" }),
        values: { night: item.average, rolling: item.rolling }
      })),
      series: [
        { name: "Night average", key: "night", className: "is-c1", dots: true },
        { name: `${bowlingStatsRolling}-night average`, key: "rolling", className: "is-c2", line: true }
      ],
      min, max,
      format: (value, precise) => precise ? bowlingFormatAverage(Math.round(value * 10) / 10) : String(Math.round(value)),
      ariaLabel: `Average over time across ${data.trend.length} nights, from ${bowlingFormatAverage(Math.round(data.trend[0].average * 10) / 10)} to ${bowlingFormatAverage(Math.round(data.trend[data.trend.length - 1].average * 10) / 10)}`
    }));
  }
  root.append(trendPanel);

  const grid = element("div", "bowling-stats-grid");
  const byGame = bowlingStatsPanel("bowling-stats-bygame", "Average by game", "Do you start slow or fade late?");
  byGame.append(bowlingStatsBars(data.byGame, {
    label: (row) => `Game ${row.game}`,
    value: (row) => row.average,
    text: (row) => `${bowlingFormatAverage(Math.round(row.average * 10) / 10)} · ${row.count} game${row.count === 1 ? "" : "s"}`
  }));
  const range = bowlingStatsPanel("bowling-stats-range-panel", "Score range", "How many games landed in each range.");
  range.append(bowlingStatsBars(data.buckets, { label: (row) => row.label, value: (row) => row.count, text: (row) => String(row.count) }));
  grid.append(byGame, range);
  root.append(grid);

  const frames = data.frames;
  const framePanel = bowlingStatsPanel("bowling-stats-frames", "Strikes, spares and pins left");
  if (!frames.games) {
    const empty = element("p", "bowling-empty", "These come from games you keep frame by frame. ");
    const link = element("a", "", "Open the Score tracker");
    link.href = "#bowling/scorer";
    empty.append(link);
    framePanel.append(empty);
    root.append(framePanel, createBowlingStatsByBall(sessions, state));
    return root;
  }
  framePanel.append(element("p", "bowling-stats-note", `From ${frames.games} game${frames.games === 1 ? "" : "s"} kept in the Score tracker.`));
  framePanel.append(bowlingStatsMetrics([
    ["Strikes", bowlingPercent(frames.strikes, frames.firstBalls), `${(frames.strikes / frames.games).toFixed(1)} per game`],
    ["Spares", bowlingPercent(frames.spares, frames.chances), `${frames.spares} of ${frames.chances} chances`],
    ["Open frames", (frames.opens / frames.games).toFixed(1), `Per game · ${frames.cleanGames} clean game${frames.cleanGames === 1 ? "" : "s"}`],
    ["Doubles", bowlingPercent(frames.doubles, frames.doubleChances), "Strikes right after a strike"],
    ["Single pins", bowlingPercent(frames.singlesMade, frames.singles), `${frames.singlesMade} of ${frames.singles}`],
    ["Splits", bowlingPercent(frames.splitsMade, frames.splits), `${frames.splitsMade} of ${frames.splits} converted`],
    ["First-ball avg", (frames.firstPins / frames.firstBalls).toFixed(1), "Pins per first ball"],
    ["Tracked average", bowlingFormatAverage(Math.round(frames.total / frames.games * 10) / 10), "Score tracker games only"]
  ]));
  if (frames.trend.length > 1) {
    const sub = element("h4", "bowling-stats-sub", "Strike and spare rate by night");
    framePanel.append(sub, bowlingStatsLineChart({
      rows: frames.trend.map((item) => ({
        label: bowlingFormatDate(item.session.date, { month: "short", day: "numeric", year: "numeric" }),
        short: bowlingFormatDate(item.session.date, { month: "short", day: "numeric" }),
        values: { strike: item.strike * 100, spare: item.spare === null ? null : item.spare * 100 }
      })),
      series: [
        { name: "Strikes", key: "strike", className: "is-c1", line: true, dots: true },
        { name: "Spares", key: "spare", className: "is-c2", line: true, dots: true }
      ],
      min: 0, max: 100,
      format: (value) => `${Math.round(value)}%`,
      ariaLabel: `Strike and spare percentage across ${frames.trend.length} nights`
    }));
  }
  const pinsHead = element("h4", "bowling-stats-sub", "Pins left after the first ball");
  const pinsNote = element("p", "bowling-stats-note", "Darker pins are left standing more often. Percent of first balls.");
  const pinGrid = element("div", "bowling-stats-pin-grid");
  pinGrid.append(bowlingStatsPinMap(frames));
  if (frames.leaves.size) pinGrid.append(bowlingStatsLeaves(frames));
  framePanel.append(pinsHead, pinsNote, pinGrid);
  root.append(framePanel, createBowlingStatsByBall(sessions, state));
  return root;
}

function bowlingStatsTable(caption, headers, rows) {
  const wrap = element("div", "bowling-stats-table");
  const table = element("table", "bowling-leaves");
  table.append(element("caption", "", caption));
  const thead = element("thead", "");
  const headRow = element("tr", "");
  for (const text of headers) {
    const cell = element("th", "", text);
    cell.scope = "col";
    headRow.append(cell);
  }
  thead.append(headRow);
  const tbody = element("tbody", "");
  for (const cells of rows) {
    const line = element("tr", "");
    cells.forEach((value, index) => {
      const cell = element(index ? "td" : "th", "", "");
      if (!index) cell.scope = "row";
      cell.append(value);
      line.append(cell);
    });
    tbody.append(line);
  }
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

function bowlingStatsRate(made, chances) {
  return chances ? `${bowlingPercent(made, chances)} · ${made}/${chances}` : "—";
}

function createBowlingStatsByBall(sessions, state) {
  const panel = bowlingStatsPanel("bowling-stats-balls", "By ball", "Strikes, carry and spares come from Score tracker games with a ball picked. Averages also count League night games by the ball you started with or switched to.");
  const balls = bowlingStatsBalls(sessions, state);
  if (!balls.length) {
    const empty = element("p", "bowling-empty", "Pick a strike ball in the Score tracker, or a starting ball when you log a session, to compare your balls. ");
    const link = element("a", "", "Open the Score tracker");
    link.href = "#bowling/scorer";
    empty.append(link);
    panel.append(empty);
    return panel;
  }
  const nameCell = (ball, note) => {
    const span = element("span", "bowling-stats-ball", ball.name);
    if (note) span.append(element("small", "", ` ${note}`));
    return span;
  };
  const strikeBalls = balls.filter((ball) => ball.games || ball.firstBalls);
  if (strikeBalls.length) {
    panel.append(bowlingStatsTable("Scoring and first balls", ["Ball", "Games", "Average", "Strikes", "First ball", "Carry", "Most common leaves"], strikeBalls.map((ball) => [
      nameCell(ball, ball.games < 5 ? "few games" : ""),
      String(ball.games),
      ball.average === null ? "—" : bowlingFormatAverage(Math.round(ball.average * 10) / 10),
      bowlingStatsRate(ball.strikes, ball.firstBalls),
      ball.firstBalls ? `${(ball.firstPins / ball.firstBalls).toFixed(1)} pins` : "—",
      ball.pocketHits ? bowlingStatsRate(ball.pocketStrikes, ball.pocketHits) : ball.firstBalls ? "Not enough data" : "—",
      ball.topLeaves.length ? ball.topLeaves.map((leave) => `${bowlingLeaveName(leave.mask)} (${leave.times})`).join(", ") : "—"
    ])));
  }
  const spareBalls = balls.filter((ball) => ball.chances);
  if (spareBalls.length) {
    panel.append(bowlingStatsTable("Spare shooting", ["Ball", "Spares", "Single pins", "10 pin", "7 pin"], spareBalls.map((ball) => [
      nameCell(ball, ball.chances < 10 ? "few chances" : ""),
      bowlingStatsRate(ball.spares, ball.chances),
      bowlingStatsRate(ball.singlesMade, ball.singles),
      bowlingStatsRate(ball.tensMade, ball.tens),
      bowlingStatsRate(ball.sevensMade, ball.sevens)
    ])));
  }
  panel.append(element("p", "bowling-stats-note", "Carry is strikes out of first balls you marked as pocket hits. “Few games” (under 5) and “few chances” (under 10 spare shots) mark numbers that can still swing a lot."));
  return panel;
}

// One-line summary for an arsenal ball card.
function bowlingBallSummary(ballId, state = bowlingGetState()) {
  const ball = bowlingStatsBalls(state.sessions, state).find((entry) => entry.id === ballId);
  if (!ball || (!ball.games && !ball.firstBalls && !ball.chances)) return "";
  return [
    ball.games ? `Average ${bowlingFormatAverage(Math.round(ball.average * 10) / 10)} in ${ball.games} game${ball.games === 1 ? "" : "s"}` : "",
    ball.firstBalls ? `${bowlingPercent(ball.strikes, ball.firstBalls)} strikes` : "",
    ball.pocketHits ? `${bowlingPercent(ball.pocketStrikes, ball.pocketHits)} carry` : "",
    ball.chances ? `${bowlingPercent(ball.spares, ball.chances)} spares` : ""
  ].filter(Boolean).join(" · ");
}
