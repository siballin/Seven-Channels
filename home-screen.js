// Guide home screen (redesign, style C): a greeting, a grid of widgets you can hide and reorder, then This week,
// Year in review, every channel at a glance and the top headlines.
// Each widget reads data the site already has (followed teams on ESPN, the motorsports summary, your games, price
// alerts, esports follows, gaming showcases, concert plans, bowling sessions, K-pop follows). A widget with nothing to
// show stays out of the way unless you're editing. Layout is remembered on this device.
// Uses the app's element(), channels and the channel scripts' functions at call time.

const homeLayoutKey = "seven-channels.home-widgets.v1";
const homeWidgets = [
  ["teams", "Your teams' games", "wide"],
  ["race", "Next race"],
  ["playing", "Playing"],
  ["deal", "Price alerts"],
  ["esports", "Esports"],
  ["concert", "Next concert"],
  ["bowling", "Bowling"],
  ["showcase", "Gaming showcase"],
  ["kpop", "K-pop this week"],
];
let homeEditing = false;

function homeLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(homeLayoutKey) || "{}");
    const known = homeWidgets.map(([id]) => id);
    const order = (Array.isArray(saved.order) ? saved.order : []).filter((id) => known.includes(id));
    return { order: [...order, ...known.filter((id) => !order.includes(id))], hidden: (Array.isArray(saved.hidden) ? saved.hidden : []).filter((id) => known.includes(id)) };
  } catch {
    return { order: homeWidgets.map(([id]) => id), hidden: [] };
  }
}

function homeSaveLayout(layout) {
  try { localStorage.setItem(homeLayoutKey, JSON.stringify(layout)); } catch { /* optional */ }
}

function homeDay(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function homeCountdown(target) {
  const ms = target - Date.now();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "Now";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days >= 2) return `${days} days`;
  if (days === 1) return `1d ${hours}h`;
  const minutes = Math.floor((ms % 3600000) / 60000);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function homeTile(kind, tone = "") {
  return element("article", `home-widget home-widget-${kind}${tone ? ` is-${tone}` : ""}`);
}

function homeLabel(text, color) {
  const label = element("span", "home-widget-label", text);
  if (color) label.style.color = color;
  return label;
}

function homeLink(text, href) {
  const link = element("a", "home-widget-link", `${text} →`);
  link.href = href;
  return link;
}

// ---------- Widgets ----------

async function homeTeamsWidget() {
  const follows = typeof followedNbaTeams !== "undefined" ? followedNbaTeams : [];
  if (!follows.length) return null;
  const sports = [...new Set(follows.map((team) => team.sport || "nba"))].slice(0, 4);
  const today = homeDay(new Date()).replace(/-/g, "");
  const games = [];
  await Promise.all(sports.map(async (sport) => {
    const league = typeof sportsLeague === "function" ? sportsLeague(sport) : null;
    if (!league?.path) return;
    try {
      const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard?dates=${today}`);
      if (!response.ok) return;
      const data = await response.json();
      for (const event of data.events || []) {
        const competitors = event.competitions?.[0]?.competitors || [];
        const mine = competitors.find((team) => follows.some((item) => (item.sport || "nba") === sport && item.id === String(team.team?.id)));
        if (mine) games.push({ sport, league, event, mine, competitors });
      }
    } catch { /* offline: the widget lists your teams instead */ }
  }));
  const rank = (game) => ({ in: 0, pre: 1, post: 2 }[game.event.competitions?.[0]?.status?.type?.state] ?? 3);
  games.sort((a, b) => rank(a) - rank(b) || Date.parse(a.event.date) - Date.parse(b.event.date));
  const tile = homeTile("teams", "dark");
  if (!games.length) {
    tile.append(homeLabel("Your teams"), element("strong", "home-widget-title", "No games today"),
      element("span", "home-widget-note", follows.slice(0, 4).map((team) => team.abbreviation || team.name).join(" · ")), homeLink("Scores", "#sports"));
    return tile;
  }
  const [main, ...rest] = games;
  const status = main.event.competitions[0].status?.type || {};
  const away = main.competitors.find((team) => team.homeAway === "away") || main.competitors[0];
  const home = main.competitors.find((team) => team !== away) || main.competitors[1];
  const head = element("div", "home-widget-row");
  head.append(homeLabel(`${main.league.label}${status.state === "in" ? " · live" : ""}`), element("span", "home-widget-note", status.state === "pre"
    ? new Date(main.event.date).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : status.shortDetail || ""));
  const score = element("div", "home-score");
  for (const [team, align] of [[away, "start"], [home, "end"]]) {
    const side = element("div", `home-score-side is-${align}`);
    const followed = team === main.mine ? "★ " : "";
    side.append(element("strong", "home-score-value", status.state === "pre" ? "–" : String(team.score ?? "")), element("span", "home-widget-note", `${followed}${team.team?.shortDisplayName || team.team?.abbreviation || ""}`));
    score.append(side);
  }
  score.insertBefore(element("span", "home-widget-note", status.state === "pre" ? "vs" : "at"), score.lastChild);
  tile.append(head, score);
  if (rest.length) tile.append(element("span", "home-widget-note", `Also today: ${rest.slice(0, 2).map((game) => `${game.mine.team?.abbreviation || ""} ${game.event.competitions[0].status?.type?.shortDetail || ""}`).join(" · ")}`));
  tile.append(homeLink("Game center", "#sports"));
  return tile;
}

async function homeRaceWidget() {
  if (typeof loadMotorsportsSummary !== "function") return null;
  const series = await loadMotorsportsSummary();
  const now = Date.now();
  const next = series.filter((item) => item.next?.start && Date.parse(item.next.start) > now - 3 * 3600000).sort((a, b) => a.next.start.localeCompare(b.next.start))[0];
  if (!next) return null;
  const short = Object.fromEntries(typeof motorsportsSeries !== "undefined" ? motorsportsSeries : []);
  const start = Date.parse(next.next.start);
  const tile = homeTile("race");
  tile.append(homeLabel(`${short[next.id] || next.name} · next race`, "var(--home-red)"), element("strong", "home-widget-big", homeCountdown(start)),
    element("span", "home-widget-note", `${next.next.name}${next.next.track ? ` · ${next.next.track}` : ""}`),
    element("span", "home-widget-note", new Date(start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })));
  tile.href = `#motorsports/${next.id}`;
  tile.append(homeLink("Weekend", `#motorsports/${next.id}`));
  return tile;
}

function homePlayingWidget() {
  if (typeof gamesEntries !== "function") return null;
  const list = gamesEntries();
  const playing = list.filter((entry) => entry.status === "now");
  if (!playing.length) return null;
  const stats = typeof gamesPlayStats === "function" ? gamesPlayStats(list) : null;
  const game = playing[0];
  const tile = homeTile("playing", "cyan");
  tile.append(homeLabel("Playing", "var(--home-cyan)"), element("strong", "home-widget-title", game.title),
    element("span", "home-widget-note", [stats?.week ? `${typeof gamesHoursText === "function" ? gamesHoursText(stats.week) : Math.round(stats.week / 60) + "h"} this week` : "", stats?.streak ? `${stats.streak}-day streak` : "", playing.length > 1 ? `+${playing.length - 1} more` : ""].filter(Boolean).join(" · ") || "Log a session to track play time"));
  const main = game.game?.timeToBeat?.main;
  if (main && Number.isFinite(game.hours)) {
    const bar = element("div", "home-progress");
    bar.style.setProperty("--p", `${Math.min(100, (game.hours / main) * 100)}%`);
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", `${game.hours} of about ${Math.round(main)} hours to beat`);
    tile.append(bar);
  }
  tile.append(homeLink("My games", "#games"));
  return tile;
}

function homeDealWidget() {
  if (typeof gamesEntries !== "function" || typeof gamesReadAlertChecks !== "function") return null;
  const watched = gamesEntries().filter((entry) => entry.status !== "done" && Number.isFinite(entry.priceAlert?.target));
  if (!watched.length) return null;
  const checks = gamesReadAlertChecks();
  const hits = watched.map((entry) => ({ entry, check: checks[entry.id] })).filter(({ entry, check }) => Number.isFinite(check?.price) && check.price <= entry.priceAlert.target);
  const money = (value) => value.toLocaleString(undefined, { style: "currency", currency: "USD" });
  const tile = homeTile("deal");
  if (hits.length) {
    const { entry, check } = hits[0];
    tile.append(homeLabel("Price alert hit", "var(--home-green)"), element("strong", "home-widget-big", check.price === 0 ? "Free" : money(check.price)),
      element("span", "home-widget-note", `${entry.title}${check.store ? ` at ${check.store}` : ""} · alert ${money(entry.priceAlert.target)}`));
    if (check.url) {
      const link = element("a", "home-widget-link", "View deal →");
      link.href = check.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      tile.append(link);
    }
  } else {
    tile.append(homeLabel("Price alerts", "var(--home-green)"), element("strong", "home-widget-big", String(watched.length)),
      element("span", "home-widget-note", `game${watched.length === 1 ? "" : "s"} watched · none at your price yet`), homeLink("My games", "#games"));
  }
  return tile;
}

async function homeEsportsWidget() {
  if (typeof gamesEsportsFollows !== "function" || !gamesEsportsFollows().length) return null;
  const data = await gamesLoadEsports();
  if (!data) return null;
  const mine = data.matches.filter((match) => match.teams.some((team) => gamesEsportsFollowing(match.game, team.id)));
  const live = mine.find((match) => gamesEsportsState(match) === "live");
  const next = live || mine.find((match) => gamesEsportsState(match) === "upcoming");
  if (!next) return null;
  const tile = homeTile("esports");
  const label = next.game === "lol" ? "LoL" : "CS2";
  tile.append(homeLabel(`${label} · ${live ? "live" : new Date(next.start).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`, "var(--home-cyan)"));
  const row = element("div", "home-widget-row");
  row.append(element("strong", "", next.teams[0]?.short || next.teams[0]?.name || "TBD"),
    element("strong", "home-widget-big", live ? `${next.teams[0]?.score ?? 0}–${next.teams[1]?.score ?? 0}` : "vs"),
    element("strong", "", next.teams[1]?.short || next.teams[1]?.name || "TBD"));
  tile.append(row, element("span", "home-widget-note", next.league || ""));
  if (next.stream) {
    const link = element("a", "home-widget-link", live ? "Watch live →" : "Stream →");
    link.href = next.stream;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    tile.append(link);
  } else tile.append(homeLink("Esports", "#games/esports"));
  return tile;
}

function homeConcertWidget() {
  if (typeof liveGetState !== "function") return null;
  const today = homeDay(new Date());
  const plan = liveGetState().plans.filter((item) => item.event?.date >= today && ["Ticket Purchased", "Attending", "Planning"].includes(item.status))
    .sort((a, b) => a.event.date.localeCompare(b.event.date))[0];
  if (!plan) return null;
  const date = new Date(`${plan.event.date}T${plan.event.time || "20:00"}`);
  const tile = homeTile("concert", "teal");
  tile.append(homeLabel(plan.status === "Planning" ? "Concert you're planning" : "Next concert", "var(--home-teal)"),
    element("strong", "home-widget-title", plan.event.attractions?.[0]?.name || plan.event.name),
    element("span", "home-widget-note", [date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), plan.event.venue?.name].filter(Boolean).join(" · ")),
    element("strong", "home-widget-big", homeCountdown(date)));
  tile.append(homeLink("Plans", `#live/event/${plan.event.id}`));
  return tile;
}

function homeBowlingWidget() {
  if (typeof bowlingGetState !== "function" || typeof bowlingSeriesSummary !== "function") return null;
  const sessions = bowlingGetState().sessions || [];
  const recent = sessions.map((session) => bowlingSeriesSummary(session)).filter((summary) => summary.scores.length).slice(0, 6).reverse();
  if (!recent.length) return null;
  const averages = recent.map((summary) => summary.total / summary.scores.length);
  const overall = typeof bowlingOverall === "function" ? bowlingOverall(sessions) : null;
  const tile = homeTile("bowling");
  tile.append(homeLabel("Bowling average", "var(--home-orange)"),
    element("strong", "home-widget-big", overall?.games ? (typeof bowlingFormatAverage === "function" ? bowlingFormatAverage(overall.average) : overall.average.toFixed(1)) : "—"));
  const max = Math.max(...averages);
  const min = Math.min(...averages);
  const chart = element("div", "home-bars");
  chart.setAttribute("role", "img");
  chart.setAttribute("aria-label", `Series averages, oldest to newest: ${averages.map((value) => value.toFixed(0)).join(", ")}`);
  averages.forEach((value, index) => {
    const bar = element("span", index === averages.length - 1 ? "is-latest" : "");
    bar.style.setProperty("--h", `${max === min ? 70 : 25 + ((value - min) / (max - min)) * 75}%`);
    chart.append(bar);
  });
  tile.append(chart, homeLink("Bowling", "#bowling"));
  return tile;
}

async function homeShowcaseWidget() {
  if (typeof gamesFetchJson !== "function") return null;
  try {
    const data = await gamesFetchJson("data/games-sidebar.json");
    const today = homeDay(new Date());
    const next = (data.showcases?.items || []).filter((event) => event.start && (event.end || event.start) >= today).sort((a, b) => a.start.localeCompare(b.start))[0];
    if (!next) return null;
    const [y, m, d] = next.start.split("-").map(Number);
    const name = next.text.split(/ (?:will|was|is|takes?|held)\b/)[0].slice(0, 60);
    const tile = homeTile("showcase");
    tile.append(homeLabel(name, "var(--home-blue)"), element("strong", "home-widget-big", next.start <= today ? "Today" : homeCountdown(new Date(y, m - 1, d, 12))),
      element("span", "home-widget-note", new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })), homeLink("Discover", "#games/discover"));
    return tile;
  } catch {
    return null;
  }
}

async function homeKpopWidget() {
  if (typeof thisWeekKpop !== "function" || typeof thisWeekRange !== "function") return null;
  const items = await thisWeekKpop(thisWeekRange()).catch(() => []);
  if (!items.length) return null;
  const tile = homeTile("kpop", "pink");
  tile.append(homeLabel("K-pop this week", "var(--home-pink)"));
  const list = element("ul", "home-list");
  for (const item of items.slice(0, 3)) {
    const li = element("li", "");
    li.append(element("strong", "", item.title), element("span", "home-widget-note", new Date(`${item.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" })));
    list.append(li);
  }
  tile.append(list, homeLink("K-Pop", "#kpop"));
  return tile;
}

const homeBuilders = { teams: homeTeamsWidget, race: homeRaceWidget, playing: homePlayingWidget, deal: homeDealWidget, esports: homeEsportsWidget,
  concert: homeConcertWidget, bowling: homeBowlingWidget, showcase: homeShowcaseWidget, kpop: homeKpopWidget };

// ---------- Page ----------

function homeGreeting(date = new Date()) {
  const hour = date.getHours();
  return hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function createHomeScreen(rerender) {
  const root = element("section", `home${homeEditing ? " is-editing" : ""}`);
  root.setAttribute("aria-labelledby", "home-greeting");
  const header = element("header", "home-header");
  const titles = element("div", "");
  titles.append(element("p", "home-date", new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })));
  const greeting = element("h1", "home-greeting", homeGreeting());
  greeting.id = "home-greeting";
  titles.append(greeting);
  const edit = element("button", homeEditing ? "" : "secondary", homeEditing ? "Done" : "Edit widgets");
  edit.type = "button";
  edit.setAttribute("aria-pressed", String(homeEditing));
  edit.addEventListener("click", () => { homeEditing = !homeEditing; rerender(); });
  header.append(titles, edit);
  root.append(header);

  const layout = homeLayout();
  const grid = element("div", "home-grid");
  grid.setAttribute("aria-label", "Widgets");
  root.append(grid);
  const names = Object.fromEntries(homeWidgets.map(([id, name]) => [id, name]));
  const sizes = Object.fromEntries(homeWidgets.map(([id, , size]) => [id, size || ""]));
  const shown = layout.order.filter((id) => !layout.hidden.includes(id));
  shown.forEach((id, index) => {
    const slot = element("div", `home-slot${sizes[id] ? ` is-${sizes[id]}` : ""}`);
    slot.dataset.widget = id;
    slot.append(element("div", "home-widget home-widget-loading", ""));
    grid.append(slot);
    const controls = () => {
      if (!homeEditing) return null;
      const bar = element("div", "home-edit-bar");
      const move = (delta, label, text) => {
        const button = element("button", "secondary", text);
        button.type = "button";
        button.setAttribute("aria-label", `${label} ${names[id]}`);
        button.disabled = index + delta < 0 || index + delta >= shown.length;
        button.addEventListener("click", () => {
          const order = [...layout.order];
          const from = order.indexOf(id);
          const to = order.indexOf(shown[index + delta]);
          [order[from], order[to]] = [order[to], order[from]];
          homeSaveLayout({ ...layout, order });
          rerender();
        });
        return button;
      };
      const hide = element("button", "secondary", "Hide");
      hide.type = "button";
      hide.setAttribute("aria-label", `Hide ${names[id]}`);
      hide.addEventListener("click", () => {
        homeSaveLayout({ ...layout, hidden: [...layout.hidden, id] });
        rerender();
      });
      bar.append(element("span", "home-edit-name", names[id]), move(-1, "Move earlier:", "←"), move(1, "Move later:", "→"), hide);
      return bar;
    };
    Promise.resolve().then(() => homeBuilders[id]()).catch((error) => { console.warn(`Home widget ${id} failed.`, error); return null; }).then((tile) => {
      if (!slot.isConnected) return;
      if (!tile && !homeEditing) {
        slot.remove();
        return;
      }
      const content = tile || (() => {
        const empty = homeTile("empty");
        empty.append(homeLabel(names[id]), element("span", "home-widget-note", "Shows up when there's something to show."));
        return empty;
      })();
      slot.replaceChildren(content);
      const bar = controls();
      if (bar) slot.append(bar);
    });
  });
  if (homeEditing && layout.hidden.length) {
    const tray = element("div", "home-tray");
    tray.append(element("span", "home-widget-note", "Hidden:"));
    for (const id of layout.hidden) {
      const add = element("button", "secondary", `+ ${names[id]}`);
      add.type = "button";
      add.addEventListener("click", () => {
        homeSaveLayout({ ...layout, hidden: layout.hidden.filter((item) => item !== id) });
        rerender();
      });
      tray.append(add);
    }
    root.append(tray);
  }
  return root;
}

// Every channel at a glance: a tile per channel with its three summary lines.
function createHomeChannels(rows) {
  const section = element("section", "home-channels");
  section.setAttribute("aria-labelledby", "home-channels-title");
  const title = element("h2", "home-section-title", "All channels");
  title.id = "home-channels-title";
  const grid = element("div", "home-channel-grid");
  for (const { channel, cells } of rows) {
    const link = element("a", "home-channel");
    link.href = `#${channel.id}`;
    link.dataset.channel = channel.id;
    const head = element("span", "home-channel-head");
    if (typeof channelIcon === "function") head.append(channelIcon(channel.id));
    head.append(element("strong", "", channel.name), element("small", "", `CH ${channel.number}`));
    link.append(head);
    for (const cell of cells) {
      const line = element("span", "home-channel-line");
      line.append(element("small", "", cell.label), element("span", "", cell.title || "—"));
      link.append(line);
    }
    grid.append(link);
  }
  section.append(title, grid);
  return section;
}
