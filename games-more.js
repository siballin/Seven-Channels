// Video Games, part two: game pages, Discover (free games on every store, Game Pass, showcases), your top 10,
// "what should I play next?", play sessions with play-time stats, price alerts and clip ideas for Creator Studio.
// Loaded after games-hub.js and uses its helpers (gamesDetails, gamesCover, gamesCheckPrice…) and the app's
// element(), entries and saveEntries() at call time. Sessions, price alerts and top-10 ranks are saved on each
// game entry, so they sync with the rest of your games.

const gamesPriceAlertsKey = "seven-channels.games-price-alerts.v1";
const gamesTopLimit = 10;
// Moods for the picker, matched against IGDB genres.
const gamesMoods = [
  ["any", "Any mood", []],
  ["action", "Action", ["Shooter", "Fighting", "Hack and slash/Beat 'em up", "Platform", "Arcade"]],
  ["story", "A good story", ["Role-playing (RPG)", "Adventure", "Visual Novel", "Point-and-click"]],
  ["chill", "Something chill", ["Simulator", "Puzzle", "Sport", "Racing", "Music", "Card & Board Game"]],
  ["strategy", "Strategy", ["Strategy", "Turn-based strategy (TBS)", "Real Time Strategy (RTS)", "Tactical", "MOBA"]],
  ["short", "Quick and indie", ["Indie", "Puzzle", "Arcade", "Platform"]],
];
const gamesTimeOptions = [["any", "Any length"], ["short", "Under 10 hours"], ["mid", "10–30 hours"], ["long", "30+ hours"]];
let gamesPickerState = { time: "any", mood: "any", platform: "any", skip: [] };
let gamesOpenTool = null; // `${entryId}:session` | `${entryId}:alert`
let gamesToolMessage = null; // { id, text }

// ---------- Shared helpers ----------

function gamesMoney(value) {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { style: "currency", currency: "USD" }) : "";
}

function gamesUpdateEntry(id, change) {
  entries = entries.map((entry) => entry.id === id ? { ...entry, ...(typeof change === "function" ? change(entry) : change) } : entry);
  return saveEntries();
}

function gamesNewId() {
  return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function gamesAddEntry({ title, status = "next", game = null, platform = "", note = "" }) {
  const key = gamesSearchKey(title);
  const existing = gamesEntries().find((entry) => (game?.id && entry.game?.id === game.id) || gamesSearchKey(entry.title) === key);
  if (existing) return existing;
  const entry = { id: gamesNewId(), created: new Date().toLocaleDateString(), channel: "games", title: title.slice(0, 100), note: note.slice(0, 180), status,
    platform: platform.slice(0, 40), hours: null, rating: null, started: status === "now" ? gamesToday() : "", finished: "", game };
  entries = [entry, ...entries];
  saveEntries();
  return entry;
}

function gamesEntryFor(id, title) {
  const key = gamesSearchKey(title || "");
  return gamesEntries().find((entry) => (id && String(entry.game?.id) === String(id)) || (key && gamesSearchKey(entry.title) === key)) || null;
}

function gamesGameHref(entry) {
  return entry?.game?.id ? `#games/game/${entry.game.id}` : "";
}

function gamesSessions(entry) {
  return Array.isArray(entry?.sessions) ? entry.sessions.filter((session) => /^\d{4}-\d{2}-\d{2}$/.test(session?.date || "") && Number.isFinite(session.minutes)) : [];
}

function gamesDayString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function gamesHoursText(minutes) {
  if (!minutes) return "0h";
  const hours = minutes / 60;
  return hours < 10 ? `${Math.round(hours * 10) / 10}h` : `${Math.round(hours)}h`;
}

function gamesStatusLine(text, error = false) {
  const line = element("p", `games-status${error ? " error" : ""}`, text);
  line.setAttribute("role", "status");
  return line;
}

// ---------- Play sessions and stats ----------

// Totals for the play-time panel and Year in review: per day, this week (Mon–Sun), streak, per game.
function gamesPlayStats(list, today = gamesToday()) {
  const byDay = new Map();
  const byGame = new Map();
  for (const entry of list) {
    for (const session of gamesSessions(entry)) {
      byDay.set(session.date, (byDay.get(session.date) || 0) + session.minutes);
      const game = byGame.get(entry.id) || { id: entry.id, title: entry.title, minutes: 0, month: 0, year: 0 };
      game.minutes += session.minutes;
      if (session.date.slice(0, 7) === today.slice(0, 7)) game.month += session.minutes;
      if (session.date.slice(0, 4) === today.slice(0, 4)) game.year += session.minutes;
      byGame.set(entry.id, game);
    }
  }
  const [year, month, day] = today.split("-").map(Number);
  const now = new Date(year, month - 1, day);
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  let week = 0;
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    week += byDay.get(gamesDayString(date)) || 0;
  }
  // Streak: consecutive days with play, ending today (or yesterday, so it doesn't reset before you play today).
  let streak = 0;
  const cursor = new Date(now);
  if (!byDay.get(gamesDayString(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (byDay.get(gamesDayString(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  // Last 8 weeks, oldest first.
  const weeks = [];
  for (let w = 7; w >= 0; w--) {
    const start = new Date(monday);
    start.setDate(monday.getDate() - w * 7);
    let minutes = 0;
    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      minutes += byDay.get(gamesDayString(date)) || 0;
    }
    weeks.push({ start: gamesDayString(start), minutes });
  }
  const games = [...byGame.values()];
  return {
    week, streak, weeks,
    total: games.reduce((sum, game) => sum + game.minutes, 0),
    sessions: list.reduce((sum, entry) => sum + gamesSessions(entry).length, 0),
    topMonth: games.filter((game) => game.month).sort((a, b) => b.month - a.month)[0] || null,
    topYear: games.filter((game) => game.year).sort((a, b) => b.year - a.year).slice(0, 3),
    yearMinutes: games.reduce((sum, game) => sum + game.year, 0),
  };
}

function gamesPlayPanel(list) {
  const stats = gamesPlayStats(list);
  const panel = element("section", "games-panel games-play");
  panel.setAttribute("aria-labelledby", "games-play-title");
  const title = element("h3", "", "Play time");
  title.id = "games-play-title";
  panel.append(title);
  if (!stats.sessions) {
    panel.append(element("p", "games-empty", "Use Log session on a game you’re playing to track your hours, streaks and weekly play time."));
    return panel;
  }
  const grid = element("div", "games-metrics");
  for (const [label, value, note] of [
    ["This week", gamesHoursText(stats.week), "Monday to Sunday"],
    ["Streak", `${stats.streak} day${stats.streak === 1 ? "" : "s"}`, stats.streak ? "Days in a row with play" : "Play today to start one"],
    ["Most played this month", stats.topMonth ? stats.topMonth.title : "—", stats.topMonth ? gamesHoursText(stats.topMonth.month) : ""],
    ["Logged in all", gamesHoursText(stats.total), `${stats.sessions} session${stats.sessions === 1 ? "" : "s"}`],
  ]) {
    const metric = element("div", "games-metric");
    metric.append(element("span", "", label), element("strong", "", value));
    if (note) metric.append(element("small", "", note));
    grid.append(metric);
  }
  const max = Math.max(...stats.weeks.map((week) => week.minutes), 1);
  const chart = element("div", "games-week-chart");
  chart.setAttribute("role", "img");
  chart.setAttribute("aria-label", `Hours played per week, last 8 weeks: ${stats.weeks.map((week) => gamesHoursText(week.minutes)).join(", ")}`);
  for (const week of stats.weeks) {
    const bar = element("span", "games-week-bar");
    bar.style.setProperty("--h", `${Math.max(3, (week.minutes / max) * 100)}%`);
    bar.title = `Week of ${gamesFormatDate(week.start, { month: "short", day: "numeric" })}: ${gamesHoursText(week.minutes)}`;
    const label = element("small", "", gamesFormatDate(week.start, { month: "numeric", day: "numeric" }));
    const column = element("span", "games-week-col");
    column.append(element("span", "games-week-value", week.minutes ? gamesHoursText(week.minutes) : ""), bar, label);
    chart.append(column);
  }
  panel.append(grid, chart);
  return panel;
}

function gamesSessionForm(entry) {
  const form = element("form", "games-tool");
  form.setAttribute("aria-label", `Log a session of ${entry.title}`);
  const date = gamesInput(`games-session-date-${entry.id}`, gamesToday(), { type: "date", max: gamesToday() });
  const minutes = gamesInput(`games-session-minutes-${entry.id}`, "60", { type: "number", min: "5", max: "1440", step: "5", inputMode: "numeric" });
  const quick = element("div", "games-quick");
  for (const value of [30, 60, 90, 120, 180]) {
    const button = element("button", "secondary", value < 60 ? `${value}m` : `${value / 60}h`);
    button.type = "button";
    button.addEventListener("click", () => { minutes.value = String(value); });
    quick.append(button);
  }
  const note = gamesInput(`games-session-note-${entry.id}`, "", { maxLength: 120, placeholder: "Optional: where you got to" });
  const save = element("button", "", "Save session");
  save.type = "submit";
  const cancel = element("button", "secondary", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => { gamesOpenTool = null; gamesRefresh(); });
  const row = element("div", "games-tool-row");
  row.append(gamesField("Date", date), gamesField("Minutes", minutes));
  const actions = element("div", "games-tool-actions");
  actions.append(save, cancel);
  form.append(row, quick, gamesField("Note", note), actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = Number(minutes.value);
    if (!Number.isFinite(value) || value < 1 || value > 1440 || !/^\d{4}-\d{2}-\d{2}$/.test(date.value)) {
      minutes.setCustomValidity("Enter 1 to 1,440 minutes.");
      minutes.reportValidity();
      return;
    }
    const session = { id: gamesNewId(), date: date.value, minutes: Math.round(value), note: note.value.trim().slice(0, 120) };
    gamesUpdateEntry(entry.id, (current) => ({
      sessions: [...gamesSessions(current), session].sort((a, b) => a.date.localeCompare(b.date)).slice(-500),
      hours: Math.round(((Number.isFinite(current.hours) ? current.hours : 0) + value / 60) * 10) / 10,
      started: current.started || date.value,
    }));
    gamesOpenTool = null;
    gamesToolMessage = { id: entry.id, text: `Logged ${gamesHoursText(value)} of ${entry.title}.` };
    gamesRefresh();
  });
  return form;
}

// ---------- Price alerts ----------

function gamesReadAlertChecks() {
  try {
    const value = JSON.parse(localStorage.getItem(gamesPriceAlertsKey) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function gamesWriteAlertChecks(value) {
  try { localStorage.setItem(gamesPriceAlertsKey, JSON.stringify(value)); } catch { /* optional */ }
}

function gamesAlertForm(entry) {
  const form = element("form", "games-tool");
  form.setAttribute("aria-label", `Price alert for ${entry.title}`);
  const target = gamesInput(`games-alert-${entry.id}`, entry.priceAlert?.target ?? "", { type: "number", min: "0", max: "500", step: "0.01", inputMode: "decimal", placeholder: "e.g. 19.99" });
  const save = element("button", "", entry.priceAlert ? "Update alert" : "Set alert");
  save.type = "submit";
  const actions = element("div", "games-tool-actions");
  actions.append(save);
  if (entry.priceAlert) {
    const remove = element("button", "secondary", "Remove alert");
    remove.type = "button";
    remove.addEventListener("click", () => {
      gamesUpdateEntry(entry.id, { priceAlert: null });
      gamesOpenTool = null;
      gamesToolMessage = { id: entry.id, text: "Price alert removed." };
      gamesRefresh();
    });
    actions.append(remove);
  }
  const cancel = element("button", "secondary", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => { gamesOpenTool = null; gamesRefresh(); });
  actions.append(cancel);
  form.append(gamesField("Alert me when the best PC price is at or under ($)", target), actions,
    element("small", "games-muted", "Checked against CheapShark’s PC store prices while Seven Channels is open, about twice a day. Turn on notifications in the Guide’s This week panel to get alerts."));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = Number(target.value);
    if (target.value === "" || !Number.isFinite(value) || value < 0 || value > 500) {
      target.setCustomValidity("Enter a price from $0 to $500.");
      target.reportValidity();
      return;
    }
    gamesUpdateEntry(entry.id, { priceAlert: { target: Math.round(value * 100) / 100 } });
    const checks = gamesReadAlertChecks();
    delete checks[entry.id];
    gamesWriteAlertChecks(checks);
    gamesOpenTool = null;
    gamesToolMessage = { id: entry.id, text: `You’ll get an alert when ${entry.title} is ${gamesMoney(value)} or less.` };
    gamesRefresh();
  });
  return form;
}

// Checks backlog/playing games with a price alert (each at most every 12 hours). Returns notification alerts.
async function gamesPriceAlertCheck({ force = false } = {}) {
  const checks = gamesReadAlertChecks();
  const alerts = [];
  const due = gamesEntries().filter((entry) => entry.status !== "done" && Number.isFinite(entry.priceAlert?.target))
    .filter((entry) => force || Date.now() - (checks[entry.id]?.checkedAt || 0) > 12 * 3600000).slice(0, 8);
  for (const entry of due) {
    try {
      gamesPriceCache.delete(gamesSearchKey(entry.game?.name || entry.title));
      const result = await gamesCheckPrice(entry.game?.name || entry.title);
      checks[entry.id] = { checkedAt: Date.now(), price: result.found ? result.price : null, store: result.store || "", url: result.dealUrl || "" };
      if (result.found && result.price <= entry.priceAlert.target) {
        alerts.push({ key: `deal:${entry.id}:${result.price}`, title: `Price drop: ${entry.title}`,
          body: `${result.price === 0 ? "Free" : gamesMoney(result.price)}${result.store ? ` at ${result.store}` : ""} (your alert: ${gamesMoney(entry.priceAlert.target)})`,
          href: result.dealUrl || gamesGameHref(entry) || "#games" });
      }
    } catch (error) {
      console.warn(`Price alert check failed for ${entry.title}.`, error);
    }
  }
  gamesWriteAlertChecks(checks);
  return alerts;
}

function gamesAlertLine(entry) {
  if (!Number.isFinite(entry.priceAlert?.target)) return null;
  const last = gamesReadAlertChecks()[entry.id];
  const line = element("p", "games-alert-line", `🔔 Alert at ${gamesMoney(entry.priceAlert.target)}`);
  if (last && Number.isFinite(last.price)) {
    const hit = last.price <= entry.priceAlert.target;
    line.append(element("span", hit ? "games-alert-hit" : "games-muted", ` · last seen ${last.price === 0 ? "free" : gamesMoney(last.price)}${hit ? " — at or under your price!" : ""}`));
  }
  return line;
}

// ---------- Creator Studio ----------

function gamesClipIdea(entry) {
  if (typeof creatorUpsert !== "function") return "Creator Studio isn’t available.";
  const id = `idea-game-${entry.id}`.slice(0, 80);
  const existing = typeof creatorGetState === "function" ? creatorGetState().ideas.find((idea) => idea.id === id) : null;
  if (existing) return `${entry.title} is already in your Creator Studio ideas.`;
  const saved = creatorUpsert("ideas", {
    id, title: `${entry.title}: clips and highlights`, category: "Gaming", platform: "short", priority: "medium", status: "Idea",
    description: `Clip ideas from ${entry.title}${entry.platform ? ` (${entry.platform})` : ""}: best moments, funny fails, first impressions, tips, a review once you finish.`,
    release: { label: entry.title, href: gamesGameHref(entry) || "#games", source: "Video Games" },
  });
  return saved === false ? "Creator Studio couldn’t save this idea." : `Added “${entry.title}: clips and highlights” to your Creator Studio ideas.`;
}

// ---------- Extra controls on game cards (called from gamesCard) ----------

function gamesCardExtras(entry, body, actions) {
  const title = body.querySelector("h4");
  const href = gamesGameHref(entry);
  if (title && href) {
    const link = element("a", "games-title-link", entry.title);
    link.href = href;
    title.replaceChildren(link);
  }
  const sessions = gamesSessions(entry);
  if (sessions.length) {
    const minutes = sessions.reduce((sum, session) => sum + session.minutes, 0);
    const last = sessions[sessions.length - 1];
    body.insertBefore(element("p", "games-muted games-session-line", `${sessions.length} session${sessions.length === 1 ? "" : "s"} · ${gamesHoursText(minutes)} logged · last ${gamesFormatDate(last.date, { month: "short", day: "numeric" })}`), actions);
  }
  if (Number.isInteger(entry.topRank)) title?.prepend(element("span", "games-top-badge", `#${entry.topRank}`));
  const alertLine = gamesAlertLine(entry);
  if (alertLine && entry.status !== "done") body.insertBefore(alertLine, actions);
  const add = (label, tool, aria) => {
    const button = element("button", "secondary", label);
    button.type = "button";
    button.setAttribute("aria-label", aria);
    button.setAttribute("aria-expanded", String(gamesOpenTool === `${entry.id}:${tool}`));
    button.addEventListener("click", () => {
      gamesOpenTool = gamesOpenTool === `${entry.id}:${tool}` ? null : `${entry.id}:${tool}`;
      gamesToolMessage = null;
      gamesRefresh(`games-${tool}-${entry.id}`);
    });
    button.id = `games-${tool}-${entry.id}`;
    actions.insertBefore(button, actions.lastChild);
  };
  if (entry.status === "now") add("Log session", "session", `Log a play session of ${entry.title}`);
  if (entry.status !== "done") add(entry.priceAlert ? "Edit alert" : "Price alert", "alert", `Price alert for ${entry.title}`);
  if (entry.status === "now") {
    const clip = element("button", "secondary", "Clip ideas");
    clip.type = "button";
    clip.setAttribute("aria-label", `Add clip ideas for ${entry.title} to Creator Studio`);
    clip.addEventListener("click", () => {
      gamesToolMessage = { id: entry.id, text: gamesClipIdea(entry), link: "#creator" };
      gamesRefresh();
    });
    actions.insertBefore(clip, actions.lastChild);
  }
  if (gamesOpenTool === `${entry.id}:session`) body.append(gamesSessionForm(entry));
  if (gamesOpenTool === `${entry.id}:alert`) body.append(gamesAlertForm(entry));
  if (gamesToolMessage?.id === entry.id) {
    const message = gamesStatusLine(gamesToolMessage.text);
    if (gamesToolMessage.link) {
      const link = element("a", "", " Open Creator Studio");
      link.href = gamesToolMessage.link;
      message.append(link);
    }
    body.append(message);
  }
}

// ---------- What should I play next? ----------

function gamesPickNext(list, state = gamesPickerState) {
  const mood = gamesMoods.find(([id]) => id === state.mood) || gamesMoods[0];
  const candidates = list.filter((entry) => entry.status === "next").filter((entry) => {
    const main = entry.game?.timeToBeat?.main;
    if (state.time === "short" && !(main && main < 10)) return false;
    if (state.time === "mid" && !(main && main >= 10 && main <= 30)) return false;
    if (state.time === "long" && !(main && main > 30)) return false;
    if (state.platform !== "any" && entry.platform !== state.platform) return false;
    if (mood[2].length && !(entry.game?.genres || []).some((genre) => mood[2].includes(genre))) return false;
    return true;
  });
  if (!candidates.length) return { pick: null, count: 0 };
  // Best first: critic score, then how long it's waited (older backlog entries come later in the list).
  const scored = candidates.map((entry, index) => ({ entry, score: (entry.game?.criticScore ?? 70) + index * 0.5 + (entry.game ? 0 : -5) }))
    .sort((a, b) => b.score - a.score);
  const fresh = scored.filter((item) => !state.skip.includes(item.entry.id));
  const pool = (fresh.length ? fresh : scored).slice(0, 3);
  return { pick: pool[Math.floor(Math.random() * pool.length)].entry, count: candidates.length };
}

function gamesPickReason(entry) {
  const parts = [];
  if (Number.isFinite(entry.game?.criticScore)) parts.push(`critics gave it ${entry.game.criticScore}`);
  if (entry.game?.timeToBeat?.main) parts.push(`about ${Math.round(entry.game.timeToBeat.main)}h to beat`);
  if (entry.platform) parts.push(`on your ${entry.platform}`);
  if (entry.game?.genres?.length) parts.push(entry.game.genres.slice(0, 2).join(" / ").toLowerCase());
  return parts.length ? `${parts.join(", ")}.`.replace(/^./, (c) => c.toUpperCase()) : "It’s been waiting in your backlog.";
}

function gamesPicker(list) {
  const backlog = list.filter((entry) => entry.status === "next");
  if (!backlog.length) return null;
  const panel = element("section", "games-panel games-picker");
  panel.setAttribute("aria-labelledby", "games-picker-title");
  const title = element("h3", "", "What should I play next?");
  title.id = "games-picker-title";
  const controls = element("div", "games-picker-controls");
  const select = (id, label, options, key) => {
    const control = document.createElement("select");
    control.id = id;
    options.forEach(([value, text]) => control.append(new Option(text, value, false, gamesPickerState[key] === value)));
    control.addEventListener("change", () => {
      gamesPickerState = { ...gamesPickerState, [key]: control.value, skip: [] };
      render();
    });
    return gamesField(label, control);
  };
  const platforms = [...new Set(backlog.map((entry) => entry.platform).filter(Boolean))].sort();
  controls.append(select("games-pick-time", "Time", gamesTimeOptions, "time"), select("games-pick-mood", "Mood", gamesMoods.map(([id, label]) => [id, label]), "mood"));
  if (platforms.length > 1) controls.append(select("games-pick-platform", "Platform", [["any", "Any platform"], ...platforms.map((name) => [name, name])], "platform"));
  const result = element("div", "games-pick-result");
  result.setAttribute("aria-live", "polite");
  const render = () => {
    const { pick, count } = gamesPickNext(list);
    result.replaceChildren();
    if (!pick) {
      result.append(element("p", "games-empty", "Nothing in your backlog matches. Try another mood or length (games need catalog details for those filters)."));
      return;
    }
    const card = element("div", "games-pick-card");
    card.append(gamesCover(pick.game, "games-cover games-cover-large"));
    const body = element("div", "");
    const name = gamesGameHref(pick) ? element("a", "games-pick-title", pick.title) : element("strong", "games-pick-title", pick.title);
    if (name.tagName === "A") name.href = gamesGameHref(pick);
    body.append(element("small", "games-muted", `Your pick, out of ${count} match${count === 1 ? "" : "es"}`), name, element("p", "", gamesPickReason(pick)));
    const actions = element("div", "games-tool-actions");
    const start = element("button", "", "Start playing");
    start.type = "button";
    start.addEventListener("click", () => {
      gamesUpdateEntry(pick.id, { status: "now", started: pick.started || gamesToday() });
      gamesStatus = `${pick.title} moved to Playing. Have fun!`;
      gamesStatusError = false;
      gamesRefresh();
    });
    const another = element("button", "secondary", "Another pick");
    another.type = "button";
    another.addEventListener("click", () => {
      gamesPickerState.skip = [...gamesPickerState.skip, pick.id].slice(-20);
      render();
    });
    actions.append(start, another);
    body.append(actions);
    card.append(body);
    result.append(card);
  };
  render();
  panel.append(title, controls, result);
  return panel;
}

// ---------- Game page ----------

function gamesScreenshotUrl(id, size = "t_screenshot_med") {
  return `https://images.igdb.com/igdb/image/upload/${size}/${encodeURIComponent(id)}.jpg`;
}

function gamesGamePage(id) {
  const page = element("section", "games-page");
  page.append(element("p", "games-muted", "Loading game…"));
  Promise.all([gamesLoadCatalog(), gamesDetails(id).catch(() => null)]).then(([catalog, details]) => {
    page.replaceChildren();
    if (!details) {
      page.append(element("p", "games-empty", catalog ? "This game isn’t in the catalog." : "Game details aren’t available right now."));
      const back = element("a", "", "← Back to My games");
      back.href = "#games";
      page.append(back);
      return;
    }
    const snapshot = gamesSnapshot(Number(id), details);
    const entry = gamesEntryFor(id, details.name);
    // Header
    const head = element("div", "games-page-head");
    const cover = details.cover ? element("img", "games-page-cover") : element("span", "games-page-cover games-cover-empty");
    if (details.cover) {
      cover.src = gamesCoverUrl(details.cover, "t_cover_big");
      cover.alt = "";
      cover.referrerPolicy = "no-referrer";
      cover.addEventListener("error", () => cover.replaceWith(element("span", "games-page-cover games-cover-empty")), { once: true });
    }
    const info = element("div", "games-page-info");
    const back = element("a", "games-muted", "← My games");
    back.href = "#games";
    info.append(back, element("h3", "", details.name));
    const by = [details.developers?.length ? `By ${details.developers.join(", ")}` : "", details.publishers?.length && details.publishers.join() !== details.developers?.join() ? `published by ${details.publishers.join(", ")}` : "", details.released ? gamesFormatDate(details.released) : ""].filter(Boolean);
    if (by.length) info.append(element("p", "games-muted", by.join(" · ")));
    info.append(gamesFacts(snapshot));
    if (Number.isFinite(details.rating)) info.append(element("small", "games-muted", `Players: ${details.rating}/100 from ${details.ratingCount.toLocaleString()} ratings (IGDB)`));
    if (details.platforms?.length) info.append(element("p", "games-muted", details.platforms.join(" · ")));
    // Your copy
    const mine = element("div", "games-page-mine");
    if (entry) {
      const status = (gamesStatuses.find(([value]) => value === entry.status) || [])[1] || "";
      const sessions = gamesSessions(entry);
      mine.append(element("strong", "", `In your games: ${status}`), element("small", "", [entry.platform, Number.isFinite(entry.hours) ? `${entry.hours}h played` : "",
        Number.isFinite(entry.rating) ? `rated ${entry.rating}/10` : "", sessions.length ? `${sessions.length} sessions` : "", Number.isInteger(entry.topRank) ? `#${entry.topRank} in your top 10` : ""].filter(Boolean).join(" · ")));
    } else {
      for (const [label, status] of [["Add to backlog", "next"], ["Playing now", "now"]]) {
        const button = element("button", status === "next" ? "" : "secondary", label);
        button.type = "button";
        button.addEventListener("click", () => {
          gamesAddEntry({ title: details.name, status, game: snapshot, platform: details.platforms?.length === 1 ? details.platforms[0] : "" });
          gamesRefresh();
        });
        mine.append(button);
      }
    }
    info.append(mine);
    head.append(cover, info);
    page.append(head);
    const columns = element("div", "games-page-columns");
    const main = element("div", "games-page-main");
    const side = element("div", "games-page-side");
    if (details.summary) {
      const about = element("section", "games-panel");
      about.append(element("h4", "", "About"), element("p", "", details.summary));
      main.append(about);
    }
    if (details.video) {
      const trailer = element("section", "games-panel");
      trailer.append(element("h4", "", "Trailer"));
      const button = element("button", "games-trailer-play");
      button.type = "button";
      button.setAttribute("aria-label", `Play the ${details.name} trailer`);
      const thumb = element("img", "");
      thumb.src = `https://i.ytimg.com/vi/${encodeURIComponent(details.video)}/hqdefault.jpg`;
      thumb.alt = "";
      thumb.referrerPolicy = "no-referrer";
      button.append(thumb, element("span", "games-trailer-icon", "▶"));
      button.addEventListener("click", () => {
        const frame = document.createElement("iframe");
        frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(details.video)}?autoplay=1&rel=0`;
        frame.title = `${details.name} trailer`;
        frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
        frame.allowFullscreen = true;
        frame.className = "games-trailer-frame";
        button.replaceWith(frame);
      }, { once: true });
      trailer.append(button);
      main.append(trailer);
    }
    if (details.screenshots?.length) {
      const shots = element("section", "games-panel");
      shots.append(element("h4", "", "Screenshots"));
      const grid = element("div", "games-shots");
      for (const shot of details.screenshots) {
        const link = gamesLink("", gamesScreenshotUrl(shot, "t_1080p"), "games-shot");
        const img = element("img", "");
        img.src = gamesScreenshotUrl(shot);
        img.alt = `${details.name} screenshot`;
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        link.append(img);
        grid.append(link);
      }
      shots.append(grid);
      main.append(shots);
    }
    // Where to buy
    const buy = element("section", "games-panel");
    buy.append(element("h4", "", "Where to get it"));
    const stores = Object.entries(details.stores || {});
    if (stores.length) {
      const list = element("div", "games-store-links");
      stores.forEach(([name, url]) => list.append(gamesLink(`${name} ↗`, url, "games-store-link")));
      buy.append(list);
    }
    const price = element("div", "games-price-line");
    buy.append(price);
    gamesPriceLine(price, { title: details.name, game: snapshot });
    if (details.url) buy.append(gamesLink("Full details on IGDB ↗", details.url, "games-external"));
    side.append(buy);
    if (details.similar?.length && catalog) {
      const byId = new Map(catalog.games.map((game) => [game.id, game]));
      const similar = details.similar.map((gameId) => byId.get(gameId)).filter(Boolean).slice(0, 6);
      if (similar.length) {
        const section = element("section", "games-panel");
        section.append(element("h4", "", "If you like this"));
        const list = element("ul", "games-similar");
        for (const game of similar) {
          const item = element("li", "");
          const link = element("a", "");
          link.href = `#games/game/${game.id}`;
          link.append(gamesCover(game, "games-cover"), element("span", "", game.name), element("small", "games-muted", game.year ? String(game.year) : ""));
          item.append(link);
          list.append(item);
        }
        section.append(list);
        side.append(section);
      }
    }
    if (!details.summary && !details.screenshots && !details.video) {
      main.append(element("p", "games-muted", "Summary, screenshots and trailer appear here after the next catalog update."));
    }
    columns.append(main, side);
    page.append(columns);
  });
  return page;
}

// ---------- Discover ----------

function gamesCountdown(start, end) {
  const today = gamesToday();
  if (!start) return "Date to be announced";
  if (start <= today && (end || start) >= today) return start === (end || start) ? "Today" : "On now";
  const [y, m, d] = start.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const days = Math.round((new Date(y, m - 1, d) - new Date(ty, tm - 1, td)) / 86400000);
  return days === 1 ? "Tomorrow" : days < 60 ? `In ${days} days` : `In ${Math.round(days / 30)} months`;
}

function gamesDiscover() {
  const wrap = element("div", "games-discover");
  const showcases = element("section", "games-panel");
  showcases.setAttribute("aria-labelledby", "games-showcases-title");
  const showTitle = element("h3", "", "Showcases & events");
  showTitle.id = "games-showcases-title";
  showcases.append(showTitle);
  const free = element("section", "games-panel");
  free.setAttribute("aria-labelledby", "games-free-title");
  const freeTitle = element("h3", "", "Free to keep");
  freeTitle.id = "games-free-title";
  free.append(freeTitle);
  const pass = element("section", "games-panel");
  pass.setAttribute("aria-labelledby", "games-pass-title");
  const passTitle = element("h3", "", "Xbox Game Pass");
  passTitle.id = "games-pass-title";
  pass.append(passTitle);
  wrap.append(showcases, free, pass);
  gamesFetchJson("data/games-sidebar.json").then((data) => {
    // Showcases
    const events = (data.showcases?.items || []).filter((event) => (event.end || event.start || `${event.month}-31`) >= gamesToday());
    if (!events.length) showcases.append(element("p", "games-empty", "No upcoming shows are listed yet."));
    else {
      const list = element("ul", "games-showcases");
      for (const event of events.slice(0, 12)) {
        const item = element("li", "");
        const when = event.start ? (event.end && event.end !== event.start ? `${gamesFormatDate(event.start, { month: "short", day: "numeric" })} – ${gamesFormatDate(event.end, { month: "short", day: "numeric" })}` : gamesFormatDate(event.start, { weekday: "short", month: "short", day: "numeric" }))
          : new Date(`${event.month}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
        item.append(element("span", "games-countdown", gamesCountdown(event.start, event.end)), element("strong", "", when), element("span", "", event.text));
        list.append(item);
      }
      showcases.append(list, element("small", "games-muted", "From Wikipedia’s video game event listings. Surprise Directs and State of Plays are often announced only a day ahead."));
    }
    // Free games: Epic's own feed plus GamerPower's list across stores, without duplicates.
    const seen = new Set();
    const games = [];
    for (const game of (data.freeGames?.items || []).map((item) => ({ ...item, store: "Epic", upcoming: item.state !== "now" }))
      .concat(data.freeEverywhere?.items || [])) {
      const key = gamesSearchKey(game.title);
      if (seen.has(key)) continue;
      seen.add(key);
      games.push(game);
    }
    const stores = [...new Set(games.map((game) => game.store))];
    let storeFilter = "all";
    const filters = element("div", "games-filters");
    filters.setAttribute("role", "group");
    filters.setAttribute("aria-label", "Filter free games by store");
    const list = element("ul", "games-free-grid");
    const renderFree = () => {
      list.replaceChildren();
      for (const game of games.filter((item) => storeFilter === "all" || item.store === storeFilter)) {
        const item = element("li", `games-free-card${game.upcoming ? " is-upcoming" : ""}`);
        const link = gamesLink("", game.url, "games-free-link");
        if (game.image) {
          const img = element("img", "");
          img.src = game.image;
          img.alt = "";
          img.loading = "lazy";
          img.referrerPolicy = "no-referrer";
          img.addEventListener("error", () => img.remove(), { once: true });
          link.append(img);
        }
        const text = element("span", "games-free-text");
        text.append(element("strong", "", game.title));
        const until = gamesFormatDate((game.end || "").slice(0, 10), { month: "short", day: "numeric" });
        const from = gamesFormatDate((game.start || "").slice(0, 10), { month: "short", day: "numeric" });
        text.append(element("small", "", [game.store, game.worth ? `worth ${game.worth}` : "", game.upcoming ? `free from ${from}` : until ? `until ${until}` : ""].filter(Boolean).join(" · ")));
        link.append(text);
        item.append(link);
        list.append(item);
      }
      if (!list.childElementCount) list.append(element("li", "games-empty", "No free games right now."));
    };
    for (const value of ["all", ...stores]) {
      const button = element("button", "secondary", value === "all" ? `All ${games.length}` : `${value} ${games.filter((game) => game.store === value).length}`);
      button.type = "button";
      button.setAttribute("aria-pressed", String(value === storeFilter));
      button.addEventListener("click", () => {
        storeFilter = value;
        filters.querySelectorAll("button").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
        renderFree();
      });
      filters.append(button);
    }
    renderFree();
    free.append(filters, list, element("small", "games-muted", "Epic’s weekly free games plus giveaways on Steam, GOG, itch.io, mobile and more from GamerPower. Links go to the store or the giveaway page."));
    // Game Pass
    const lists = data.gamePass?.items?.[0] || {};
    const tabs = [["recent", "Recently added"], ["coming", "Coming soon"], ["leaving", "Leaving soon"]].filter(([key]) => lists[key]?.length);
    if (!tabs.length) pass.append(element("p", "games-empty", "Game Pass lists aren’t available right now."));
    else {
      let active = tabs[0][0];
      const tabRow = element("div", "games-filters");
      tabRow.setAttribute("role", "group");
      tabRow.setAttribute("aria-label", "Game Pass lists");
      const grid = element("ul", "games-pass-grid");
      const renderPass = () => {
        grid.replaceChildren();
        for (const game of lists[active]) {
          const item = element("li", "games-pass-card");
          const link = gamesLink("", game.url, "games-pass-link");
          if (game.image) {
            const img = element("img", "");
            img.src = game.image;
            img.alt = "";
            img.loading = "lazy";
            img.referrerPolicy = "no-referrer";
            img.addEventListener("error", () => img.remove(), { once: true });
            link.append(img);
          }
          link.append(element("strong", "", game.title), element("small", "games-muted", (game.on || []).join(" · ")));
          item.append(link);
          const mine = gamesEntryFor(null, game.title);
          if (mine) item.append(element("small", "games-pass-mine", `In your ${(gamesStatuses.find(([value]) => value === mine.status) || [])[1]?.toLowerCase() || "games"}`));
          else if (active !== "leaving") {
            const add = element("button", "secondary", "+ Backlog");
            add.type = "button";
            add.setAttribute("aria-label", `Add ${game.title} to your backlog`);
            add.addEventListener("click", () => {
              gamesAddEntry({ title: game.title, status: "next", platform: (game.on || []).includes("Console") ? "Xbox Series X|S" : "PC", note: "Game Pass" });
              add.replaceWith(element("small", "games-pass-mine", "Added to your backlog"));
            });
            item.append(add);
          }
          grid.append(item);
        }
      };
      for (const [key, label] of tabs) {
        const button = element("button", "secondary", `${label} ${lists[key].length}`);
        button.type = "button";
        button.setAttribute("aria-pressed", String(key === active));
        button.addEventListener("click", () => {
          active = key;
          tabRow.querySelectorAll("button").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
          renderPass();
        });
        tabRow.append(button);
      }
      renderPass();
      pass.append(tabRow, grid, element("small", "games-muted", "From Xbox’s Game Pass catalog (US). PlayStation Plus doesn’t publish its catalog in a way the site can read."));
    }
  }).catch(() => {
    for (const section of [showcases, free, pass]) section.append(element("p", "games-empty", "Couldn’t load this section."));
  });
  return wrap;
}

// ---------- Top 10 ----------

function gamesTopList() {
  return gamesEntries().filter((entry) => Number.isInteger(entry.topRank)).sort((a, b) => a.topRank - b.topRank);
}

function gamesSetTopOrder(ids) {
  const rank = new Map(ids.slice(0, gamesTopLimit).map((id, index) => [id, index + 1]));
  entries = entries.map((entry) => {
    if (entry.channel !== "games") return entry;
    if (rank.has(entry.id)) return { ...entry, topRank: rank.get(entry.id) };
    if (Number.isInteger(entry.topRank)) {
      const { topRank, ...rest } = entry;
      return rest;
    }
    return entry;
  });
  saveEntries();
}

function gamesTopPage() {
  const panel = element("section", "games-panel games-top");
  panel.setAttribute("aria-labelledby", "games-top-title");
  const title = element("h3", "", "My top 10");
  title.id = "games-top-title";
  panel.append(title, element("p", "games-muted", "Rank your favorite games. Drag to reorder, or use the arrows."));
  const top = gamesTopList();
  const ids = top.map((entry) => entry.id);
  const list = element("ol", "games-top-list");
  let dragged = null;
  top.forEach((entry, index) => {
    const item = element("li", "games-top-item");
    item.draggable = true;
    item.dataset.id = entry.id;
    item.append(element("span", "games-top-rank", String(index + 1)), gamesCover(entry.game));
    const text = element("span", "games-top-text");
    const name = gamesGameHref(entry) ? element("a", "", entry.title) : element("strong", "", entry.title);
    if (name.tagName === "A") name.href = gamesGameHref(entry);
    text.append(name, element("small", "games-muted", [Number.isFinite(entry.rating) ? `Your rating ${entry.rating}/10` : "", entry.platform, entry.finished ? `Finished ${gamesFormatDate(entry.finished, { month: "short", year: "numeric" })}` : ""].filter(Boolean).join(" · ")));
    const controls = element("span", "games-top-controls");
    const move = (delta, label) => {
      const button = element("button", "secondary", label);
      button.type = "button";
      button.disabled = index + delta < 0 || index + delta >= top.length;
      button.setAttribute("aria-label", `Move ${entry.title} ${delta < 0 ? "up" : "down"}`);
      button.addEventListener("click", () => {
        const next = [...ids];
        [next[index], next[index + delta]] = [next[index + delta], next[index]];
        gamesSetTopOrder(next);
        gamesRefresh(`games-top-${delta < 0 ? "up" : "down"}-${entry.id}`);
      });
      button.id = `games-top-${delta < 0 ? "up" : "down"}-${entry.id}`;
      return button;
    };
    const remove = element("button", "secondary", "✕");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${entry.title} from your top 10`);
    remove.addEventListener("click", () => {
      gamesSetTopOrder(ids.filter((id) => id !== entry.id));
      gamesRefresh();
    });
    controls.append(move(-1, "↑"), move(1, "↓"), remove);
    item.append(text, controls);
    item.addEventListener("dragstart", (event) => {
      dragged = entry.id;
      item.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", entry.id);
    });
    item.addEventListener("dragend", () => item.classList.remove("is-dragging"));
    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      item.classList.add("is-drop-target");
    });
    item.addEventListener("dragleave", () => item.classList.remove("is-drop-target"));
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!dragged || dragged === entry.id) return;
      const next = ids.filter((id) => id !== dragged);
      next.splice(next.indexOf(entry.id) + (ids.indexOf(dragged) < index ? 1 : 0), 0, dragged);
      gamesSetTopOrder(next);
      gamesRefresh();
    });
    list.append(item);
  });
  if (top.length) panel.append(list);
  else panel.append(element("p", "games-empty", "Your top 10 is empty."));
  const candidates = gamesEntries().filter((entry) => !Number.isInteger(entry.topRank))
    .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || Number(b.status === "done") - Number(a.status === "done") || a.title.localeCompare(b.title));
  const tools = element("div", "games-top-tools");
  if (top.length < gamesTopLimit && candidates.length) {
    const select = document.createElement("select");
    select.id = "games-top-add";
    candidates.forEach((entry) => select.append(new Option(`${entry.title}${Number.isFinite(entry.rating) ? ` (${entry.rating}/10)` : ""}`, entry.id)));
    const add = element("button", "", "Add");
    add.type = "button";
    add.addEventListener("click", () => {
      gamesSetTopOrder([...ids, select.value]);
      gamesRefresh("games-top-add");
    });
    tools.append(gamesField("Add a game", select), add);
    if (!top.length && candidates.some((entry) => Number.isFinite(entry.rating))) {
      const fill = element("button", "secondary", "Start from my ratings");
      fill.type = "button";
      fill.addEventListener("click", () => {
        gamesSetTopOrder(candidates.filter((entry) => Number.isFinite(entry.rating)).slice(0, gamesTopLimit).map((entry) => entry.id));
        gamesRefresh();
      });
      tools.append(fill);
    }
  } else if (!candidates.length && !top.length) {
    tools.append(element("p", "games-muted", "Add games on My games first."));
  }
  if (top.length) {
    const copy = element("button", "secondary", "Copy list");
    copy.type = "button";
    const note = element("small", "games-muted", "");
    note.setAttribute("role", "status");
    copy.addEventListener("click", () => {
      const text = `My top ${top.length} games\n${top.map((entry, index) => `${index + 1}. ${entry.title}`).join("\n")}`;
      navigator.clipboard?.writeText(text).then(() => { note.textContent = "Copied."; }, () => { note.textContent = "Couldn’t copy; select the list instead."; });
    });
    tools.append(copy, note);
  }
  panel.append(tools);
  return panel;
}

// ---------- Notifications: showcases today ----------

async function gamesShowcaseAlerts(today) {
  try {
    const data = await gamesFetchJson("data/games-sidebar.json");
    return (data.showcases?.items || []).filter((event) => event.start === today)
      .map((event) => ({ key: `showcase:${event.start}:${event.text.slice(0, 40)}`, title: "Gaming showcase today", body: event.text, href: "#games/discover" }));
  } catch {
    return [];
  }
}

// Showcases in This week on the Guide.
async function gamesShowcasesThisWeek(days) {
  const data = await gamesFetchJson("data/games-sidebar.json");
  return (data.showcases?.items || []).filter((event) => event.start && event.start >= days[0] && event.start <= days[days.length - 1])
    .map((event) => ({ kind: "game", label: "Gaming showcase", date: event.start, title: event.text.split(/ (?:will|was|is|takes?|held)\b/)[0].slice(0, 80), note: event.text, href: "#games/discover" }));
}
