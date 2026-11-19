// Betting analytics for the Betting channel: bankroll over time, results by sport and bet type, streaks.
// Pure calculations (bettingStats) are separate from rendering so they can be unit tested.
// Loaded as a classic script before the main app script; element() comes from the app at call time.

const bettingSports = ["NBA", "NFL", "MLB", "NHL", "College football", "College basketball", "Soccer", "Golf", "Tennis", "UFC / boxing", "Other"];
const bettingSportWords = [
  ["NBA", /\b(nba|lakers|celtics|warriors|knicks|nets|bucks|heat|nuggets|suns|76ers|sixers|mavericks|mavs|clippers|bulls|cavaliers|cavs|thunder|timberwolves|wolves|pelicans|kings|grizzlies|hawks|hornets|magic|pacers|pistons|raptors|rockets|spurs|jazz|wizards|blazers)\b/i],
  ["NFL", /\b(nfl|chiefs|eagles|cowboys|49ers|niners|bills|ravens|bengals|packers|steelers|patriots|jets|giants|commanders|bears|lions|vikings|saints|buccaneers|bucs|falcons|panthers|seahawks|rams|cardinals|chargers|raiders|broncos|texans|colts|jaguars|titans|dolphins|browns|super bowl|touchdown|td)\b/i],
  ["MLB", /\b(mlb|yankees|dodgers|red sox|mets|cubs|astros|braves|phillies|padres|mariners|orioles|guardians|blue jays|twins|rangers|brewers|world series|home run|strikeouts)\b/i],
  ["NHL", /\b(nhl|bruins|maple leafs|canadiens|oilers|avalanche|penguins|capitals|blackhawks|flyers|lightning|stanley cup|puck ?line)\b/i],
  ["College football", /\b(ncaaf|cfb|college football|cfp)\b/i],
  ["College basketball", /\b(ncaab|cbb|college basketball|march madness|final four)\b/i],
  ["Soccer", /\b(soccer|premier league|epl|mls|champions league|la liga|serie a|bundesliga|world cup)\b/i],
  ["Golf", /\b(pga|golf|masters|ryder cup)\b/i],
  ["Tennis", /\b(atp|wta|tennis|wimbledon|us open)\b/i],
  ["UFC / boxing", /\b(ufc|mma|boxing|fight night)\b/i],
];

// The sport a bet is on: what you picked, else an NBA game link, else words in the description.
function bettingSportOf(entry) {
  if (bettingSports.includes(entry.sport)) return entry.sport;
  if (entry.game?.id) return "NBA";
  const text = [entry.title, entry.note, entry.prop?.player, ...(entry.legs || []).map((leg) => leg.pick || leg.player || "")].filter(Boolean).join(" ");
  return bettingSportWords.find(([, pattern]) => pattern.test(text))?.[0] || "Other";
}

// The day a bet was placed: the date you entered, else the linked game's date, else when it was last saved.
function bettingDateOf(entry) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(entry.placedOn || "")) return entry.placedOn;
  if (/^\d{4}-\d{2}-\d{2}$/.test(entry.game?.date || "")) return entry.game.date;
  const saved = Date.parse(entry.updatedAt || "");
  return Number.isFinite(saved) ? new Date(saved).toISOString().slice(0, 10) : "";
}

function bettingProfit(entry) {
  const stake = Number(entry.stake);
  const odds = Number(entry.odds);
  if (entry.status === "won") return odds > 0 ? stake * odds / 100 : stake * 100 / Math.abs(odds);
  if (entry.status === "lost") return -stake;
  return 0;
}

function bettingGroup(bets) {
  const wins = bets.filter((bet) => bet.status === "won").length;
  const losses = bets.filter((bet) => bet.status === "lost").length;
  const pushes = bets.filter((bet) => bet.status === "push").length;
  const decided = bets.filter((bet) => bet.status !== "push");
  const staked = decided.reduce((sum, bet) => sum + Number(bet.stake), 0);
  const net = bets.reduce((sum, bet) => sum + bettingProfit(bet), 0);
  return { bets: bets.length, wins, losses, pushes, net, staked, winRate: wins + losses ? wins / (wins + losses) * 100 : null, roi: staked ? net / staked * 100 : null };
}

// Settled bets (won, lost or push) with valid odds and stake, in the order they were placed.
function bettingStats(entries, { type = "all", sport = "all", startingBankroll = 0, unitSize = 1 } = {}) {
  const settled = entries
    .filter((entry) => entry.channel === "betting" && ["won", "lost", "push"].includes(entry.status))
    .filter((entry) => Number.isInteger(Number(entry.odds)) && Number(entry.odds) !== 0 && Number(entry.stake) > 0)
    .map((entry) => ({ ...entry, sportName: bettingSportOf(entry), date: bettingDateOf(entry), type: ["prop", "parlay"].includes(entry.betType) ? entry.betType : "straight" }))
    .filter((entry) => (type === "all" || entry.type === type) && (sport === "all" || entry.sportName === sport))
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || String(a.id).localeCompare(String(b.id)));
  let running = 0;
  const timeline = settled.map((bet) => {
    running += bettingProfit(bet);
    return { date: bet.date, title: bet.title, status: bet.status, profit: bettingProfit(bet), units: running, bankroll: startingBankroll + running * unitSize };
  });
  const by = (key, order) => {
    const groups = new Map();
    for (const bet of settled) groups.set(bet[key], [...(groups.get(bet[key]) || []), bet]);
    return [...groups.entries()].map(([name, bets]) => ({ name, ...bettingGroup(bets) }))
      .sort((a, b) => order ? order.indexOf(a.name) - order.indexOf(b.name) : b.bets - a.bets);
  };
  // Streaks count wins and losses in a row; pushes don't break or extend them.
  let current = { kind: "", length: 0 };
  let longestWin = 0;
  let longestLoss = 0;
  for (const bet of settled) {
    if (bet.status === "push") continue;
    current = current.kind === bet.status ? { kind: bet.status, length: current.length + 1 } : { kind: bet.status, length: 1 };
    if (bet.status === "won") longestWin = Math.max(longestWin, current.length);
    else longestLoss = Math.max(longestLoss, current.length);
  }
  const ranked = [...settled].sort((a, b) => bettingProfit(b) - bettingProfit(a));
  const peak = timeline.reduce((best, point) => Math.max(best, point.units), 0);
  const low = timeline.reduce((worst, point) => Math.min(worst, point.units), 0);
  return {
    ...bettingGroup(settled),
    timeline,
    bySport: by("sportName", bettingSports),
    byType: by("type", ["straight", "prop", "parlay"]),
    streak: current,
    longestWin,
    longestLoss,
    best: ranked[0] && bettingProfit(ranked[0]) > 0 ? { title: ranked[0].title, profit: bettingProfit(ranked[0]) } : null,
    worst: ranked.length && bettingProfit(ranked[ranked.length - 1]) < 0 ? { title: ranked[ranked.length - 1].title, profit: bettingProfit(ranked[ranked.length - 1]) } : null,
    peakUnits: peak,
    lowUnits: low,
    bankroll: startingBankroll + running * unitSize,
    sports: [...new Set(settled.map((bet) => bet.sportName))],
  };
}

// ---------- Rendering ----------

function bettingSvgChart(points, { label, format, includeZero = true }) {
  const ns = "http://www.w3.org/2000/svg";
  // Drawn at roughly the size it's shown, so the axis text stays a readable size.
  const width = matchMedia("(max-width: 560px)").matches ? 380 : 1000;
  const height = width < 500 ? 220 : 260;
  const pad = { top: 16, right: 14, bottom: 26, left: 56 };
  const values = [...(includeZero ? [0] : []), ...points.map((point) => point.value)];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;
  const x = (index) => points.length === 1 ? pad.left + (width - pad.left - pad.right) / 2 : pad.left + index * (width - pad.left - pad.right) / (points.length - 1);
  const y = (value) => pad.top + (max - value) * (height - pad.top - pad.bottom) / (max - min);
  const node = (tag, attrs, text) => {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const svg = node("svg", { viewBox: `0 0 ${width} ${height}`, class: "betting-chart", role: "img", "aria-label": label });
  for (const value of [max - span * 0.08, (max + min) / 2, min + span * 0.08]) {
    svg.append(node("line", { x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value), class: "betting-grid" }),
      node("text", { x: pad.left - 8, y: y(value) + 4, "text-anchor": "end", class: "betting-axis" }, format(value)));
  }
  if (min < 0 && max > 0) svg.append(node("line", { x1: pad.left, x2: width - pad.right, y1: y(0), y2: y(0), class: "betting-zero" }));
  if (points.length > 1) {
    const path = points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ");
    const area = `${x(0)},${y(Math.max(min, Math.min(max, 0)))} ${path} ${x(points.length - 1)},${y(Math.max(min, Math.min(max, 0)))}`;
    svg.append(node("polygon", { points: area, class: "betting-area" }), node("polyline", { points: path, class: "betting-line" }));
  }
  points.forEach((point, index) => {
    const dot = node("circle", { cx: x(index), cy: y(point.value), r: points.length > 40 ? 2 : 3.5, class: `betting-dot is-${point.status}` });
    dot.append(node("title", {}, point.tip));
    svg.append(dot);
  });
  if (points.length) {
    svg.append(node("text", { x: pad.left, y: height - 6, class: "betting-axis" }, points[0].date || ""),
      node("text", { x: width - pad.right, y: height - 6, "text-anchor": "end", class: "betting-axis" }, points[points.length - 1].date || ""));
  }
  return svg;
}

function bettingTable(caption, rows, unitText) {
  const wrap = element("div", "betting-table");
  const table = element("table", "");
  table.append(element("caption", "", caption));
  const head = element("tr", "");
  for (const text of ["", "Bets", "Record", "Win rate", "Net", "ROI"]) {
    const cell = element("th", "", text);
    cell.scope = "col";
    head.append(cell);
  }
  const thead = element("thead", "");
  thead.append(head);
  const tbody = element("tbody", "");
  for (const row of rows) {
    const line = element("tr", "");
    const name = element("th", "", row.label || row.name);
    name.scope = "row";
    line.append(name, element("td", "", String(row.bets)), element("td", "", `${row.wins}-${row.losses}${row.pushes ? `-${row.pushes}` : ""}`),
      element("td", "", row.winRate === null ? "—" : `${row.winRate.toFixed(1)}%`),
      element("td", row.net > 0 ? "positive" : row.net < 0 ? "negative" : "", unitText(row.net)),
      element("td", row.roi > 0 ? "positive" : row.roi < 0 ? "negative" : "", row.roi === null ? "—" : `${row.roi > 0 ? "+" : row.roi < 0 ? "−" : ""}${Math.abs(row.roi).toFixed(1)}%`));
    tbody.append(line);
  }
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

// Charts, ROI by sport and bet type, streaks and bankroll, for the settled bets matching the filters.
function createBettingAnalytics({ entries, unitSize, bankrollSetting, type, onBankroll }) {
  const section = element("section", "betting-analytics");
  section.setAttribute("aria-labelledby", "betting-analytics-title");
  const title = element("h3", "", "Results over time");
  title.id = "betting-analytics-title";
  const controls = element("div", "betting-controls");
  const sportField = element("div", "field");
  const sportLabel = element("label", "", "Sport");
  sportLabel.htmlFor = "betting-sport-filter";
  const sportSelect = element("select", "");
  sportSelect.id = "betting-sport-filter";
  const bankrollForm = element("form", "betting-bankroll-form");
  bankrollForm.noValidate = true;
  const bankrollField = element("div", "field");
  const bankrollLabel = element("label", "", "Starting bankroll ($)");
  bankrollLabel.htmlFor = "betting-bankroll";
  const bankrollInput = element("input", "");
  bankrollInput.id = "betting-bankroll";
  bankrollInput.type = "number";
  bankrollInput.min = "0";
  bankrollInput.step = "0.01";
  bankrollInput.placeholder = "Optional, e.g. 500";
  if (bankrollSetting.value) bankrollInput.value = bankrollSetting.value.toFixed(2);
  const bankrollSave = element("button", "secondary", "Save");
  bankrollSave.type = "submit";
  bankrollField.append(bankrollLabel, bankrollInput);
  bankrollForm.append(bankrollField, bankrollSave);
  bankrollForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = bankrollInput.value === "" ? 0 : Math.round(Number(bankrollInput.value) * 100) / 100;
    if (!Number.isFinite(value) || value < 0 || value > 1e9) {
      bankrollInput.setAttribute("aria-invalid", "true");
      return;
    }
    bankrollInput.removeAttribute("aria-invalid");
    onBankroll(value);
  });
  sportField.append(sportLabel, sportSelect);
  controls.append(sportField, bankrollForm);
  const body = element("div", "betting-analytics-body");
  section.append(title, controls, body);
  const units = (value) => `${value < 0 ? "−" : value > 0 ? "+" : ""}${Math.abs(value).toFixed(2)}u`;
  const dollars = (value) => `${value < 0 ? "−" : ""}${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.abs(value))}`;
  const all = bettingStats(entries, { type });
  sportSelect.append(new Option("All sports", "all"), ...all.sports.map((name) => new Option(name, name)));

  const render = () => {
    const stats = bettingStats(entries, { type, sport: sportSelect.value, startingBankroll: bankrollSetting.value, unitSize });
    body.replaceChildren();
    if (!stats.bets) {
      body.append(element("p", "bet-dashboard-note", "Settle a few bets (won, lost or push) to see your results over time."));
      return;
    }
    const hasBankroll = bankrollSetting.value > 0;
    const metrics = element("div", "bet-metrics betting-metrics");
    const metric = (label, value, note, cls = "") => {
      const item = element("div", "bet-metric");
      item.append(element("span", "", label), element("strong", cls, value));
      if (note) item.append(element("small", "", note));
      metrics.append(item);
    };
    metric(hasBankroll ? "Bankroll" : "Net", hasBankroll ? dollars(stats.bankroll) : units(stats.net),
      hasBankroll ? `Started at ${dollars(bankrollSetting.value)} · ${units(stats.net)}` : `${dollars(stats.net * unitSize)} at your unit size`,
      stats.net > 0 ? "positive" : stats.net < 0 ? "negative" : "");
    metric("Record", `${stats.wins}-${stats.losses}${stats.pushes ? `-${stats.pushes}` : ""}`, stats.winRate === null ? "" : `${stats.winRate.toFixed(1)}% wins`);
    metric("Current streak", stats.streak.length ? `${stats.streak.length} ${stats.streak.kind === "won" ? "W" : "L"}` : "—", `Longest: ${stats.longestWin} W · ${stats.longestLoss} L`);
    metric("Peak / low", `${units(stats.peakUnits)} / ${units(stats.lowUnits)}`, "Best and worst running total");
    body.append(metrics);
    const points = stats.timeline.map((point) => ({
      value: hasBankroll ? point.bankroll : point.units, date: point.date, status: point.status,
      tip: `${point.date || "No date"} · ${point.title} · ${point.status} ${units(point.profit)} → ${hasBankroll ? dollars(point.bankroll) : units(point.units)}`,
    }));
    const figure = element("figure", "betting-figure");
    figure.append(element("figcaption", "", hasBankroll ? "Bankroll after each settled bet" : "Running profit (units) after each settled bet"),
      bettingSvgChart(points, { label: `${hasBankroll ? "Bankroll" : "Running profit"} over ${points.length} settled bets, ending at ${hasBankroll ? dollars(stats.bankroll) : units(stats.net)}`,
        format: (value) => hasBankroll ? `$${Math.round(value)}` : `${value > 0 ? "+" : ""}${value.toFixed(1)}u`, includeZero: !hasBankroll }));
    body.append(figure);
    const tables = element("div", "betting-tables");
    tables.append(bettingTable("By sport", stats.bySport, units),
      bettingTable("By bet type", stats.byType.map((row) => ({ ...row, label: { straight: "Straight", prop: "Player props", parlay: "Parlays" }[row.name] })), units));
    body.append(tables);
    const extremes = [stats.best ? `Best: ${stats.best.title} (${units(stats.best.profit)})` : "", stats.worst ? `Worst: ${stats.worst.title} (${units(stats.worst.profit)})` : ""].filter(Boolean);
    if (extremes.length) body.append(element("p", "bet-dashboard-note", extremes.join(" · ")));
    body.append(element("p", "bet-dashboard-note", "Bets are dated by the date you entered, the linked game, or when they were last saved. Sports come from your choice, a linked NBA game, or words in the description."));
  };
  sportSelect.addEventListener("change", render);
  render();
  return section;
}
