// Motorsports channel (#motorsports, #motorsports/<f1|nascar|imsa|wec>, #motorsports/<series>/<round>): overview,
// calendars with sessions in your time zone, results, standings, and a live running order for F1 and NASCAR from ESPN.
// Data: data/motorsports/*.json from scripts/update_motorsports.py. Loaded on first visit; element() comes from the app.

const motorsportsCache = new Map();
function motorsportsLoad(id) {
  if (!motorsportsCache.has(id)) {
    motorsportsCache.set(id, fetch(new URL(`data/motorsports/${id}.json`, location.href)).then((response) => {
      if (!response.ok) throw new Error(`${id} data unavailable (${response.status}).`);
      return response.json();
    }).catch((error) => { motorsportsCache.delete(id); throw error; }));
  }
  return motorsportsCache.get(id);
}

const motorsportsLabels = { f1: "F1", nascar: "NASCAR", imsa: "IMSA", wec: "WEC" };
const motorsportsEspn = { f1: "f1", nascar: "nascar-premier" };
const motorsportsNascarSeries = new Map(); // remembered NASCAR series (1 Cup, 2 O'Reilly, 3 Truck)

function motorsportsDate(start, withTime = true) {
  if (!start) return "";
  if (!/T/.test(start)) return new Date(`${start}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return new Date(start).toLocaleString(undefined, withTime ? { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { weekday: "short", month: "short", day: "numeric" });
}

function motorsportsCountdown(start) {
  if (!start) return "";
  const target = /T/.test(start) ? new Date(start) : new Date(`${start}T12:00:00`);
  const diff = target - Date.now();
  if (diff <= 0) return diff > -4 * 3600000 ? "Under way" : "";
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 13) return `in ${Math.round(days / 7)} weeks`;
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}${hours ? ` ${hours} h` : ""}`;
  const minutes = Math.floor((diff % 3600000) / 60000);
  return `in ${hours ? `${hours} h ` : ""}${minutes} min`;
}

function motorsportsDone(round) {
  return Array.isArray(round.results) ? round.results.length > 0 : Boolean(round.results);
}

function motorsportsTime(start) {
  if (!start) return null;
  return /T/.test(start) ? new Date(start) : new Date(`${start}T23:59:59Z`);
}

// The first round without results that hasn't started more than a few hours ago.
function motorsportsNext(rounds) {
  return rounds.find((round) => !motorsportsDone(round) && (!round.start || motorsportsTime(round.start) > Date.now() - 6 * 3600000)) || null;
}

function motorsportsGroup(data) {
  // NASCAR holds several series; the others are one series.
  if (!data.series) return data;
  const wanted = motorsportsNascarSeries.get("nascar") || data.series[0]?.id;
  return data.series.find((item) => String(item.id) === String(wanted)) || data.series[0];
}

// A small flag before a driver's name (country code from the data; images from flagcdn.com).
const motorsportsRegionNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(undefined, { type: "region" }) : null;
function motorsportsFlag(cc) {
  if (!/^[a-z]{2}$/.test(cc || "")) return null;
  const image = element("img", "ms-flag");
  image.src = `https://flagcdn.com/w40/${cc}.png`;
  image.width = 20;
  image.height = 15;
  image.loading = "lazy";
  let country = cc.toUpperCase();
  try { country = motorsportsRegionNames?.of(country) || country; } catch { /* keep the code */ }
  image.alt = country;
  image.title = country;
  image.addEventListener("error", () => image.remove(), { once: true });
  return image;
}

// Team logos from Wikipedia (data/motorsports/logos.json), loaded once before a series page draws.
let motorsportsLogos = {};
let motorsportsLogosRequest = null;
function motorsportsLoadLogos() {
  motorsportsLogosRequest ||= fetch(new URL("data/motorsports/logos.json", location.href))
    .then((response) => (response.ok ? response.json() : { teams: {} }))
    .then((data) => { motorsportsLogos = data.teams || {}; })
    .catch(() => { motorsportsLogosRequest = null; });
  return motorsportsLogosRequest;
}

// Track maps from each circuit's Wikipedia infobox (data/motorsports/tracks.json).
let motorsportsTracks = {};
let motorsportsTracksRequest = null;
function motorsportsLoadTracks() {
  motorsportsTracksRequest ||= fetch(new URL("data/motorsports/tracks.json", location.href))
    .then((response) => (response.ok ? response.json() : { circuits: {} }))
    .then((data) => { motorsportsTracks = data.circuits || {}; })
    .catch(() => { motorsportsTracksRequest = null; });
  return motorsportsTracksRequest;
}

// The layout used by this series: sports cars race road courses (Daytona's road course, not the tri-oval).
function motorsportsTrackMap(seriesId, circuit, { small = false } = {}) {
  const entry = motorsportsTracks[circuit];
  const maps = (entry?.maps || []).filter((item) => /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(item.url));
  if (!maps.length) return null;
  const roadCourse = maps.find((item) => /sports ?car|road|grand prix|circuit/i.test(item.caption) && !/oval|motorcycle|kart/i.test(item.caption));
  const chosen = (["imsa", "wec", "f1"].includes(seriesId) && roadCourse) || maps[0];
  const figure = element("figure", small ? "ms-track is-small" : "ms-track");
  const image = element("img");
  image.src = chosen.url;
  image.alt = `Track map of ${circuit}${chosen.caption ? `, ${chosen.caption}` : ""}`;
  image.loading = "lazy";
  image.addEventListener("error", () => figure.remove(), { once: true });
  figure.append(image);
  if (!small) {
    const caption = element("figcaption");
    if (chosen.caption) caption.append(`${chosen.caption} · `);
    const link = element("a", "", "Wikimedia");
    link.href = `https://en.wikipedia.org/wiki/${encodeURIComponent((entry.article || circuit).replaceAll(" ", "_"))}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    caption.append("Map: ", link);
    figure.append(caption);
  }
  return figure;
}

// A team name with its logo (or its flag when there's no logo).
function motorsportsTeam(name, cc = "") {
  const span = element("span", "ms-person ms-team");
  const url = motorsportsLogos[name]?.url || "";
  if (/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(url)) {
    const logo = element("img", "ms-logo");
    logo.src = url;
    logo.alt = "";
    logo.loading = "lazy";
    logo.addEventListener("error", () => logo.remove(), { once: true });
    span.append(logo);
  } else {
    const flag = motorsportsFlag(cc);
    if (flag) span.append(flag);
  }
  span.append(name || "");
  return span;
}

// "Name" with its flag; accepts {name, cc}, a row with driver/name + cc, or a plain string.
function motorsportsPerson(person, nameKey = "name") {
  const span = element("span", "ms-person");
  const name = typeof person === "string" ? person : person?.[nameKey] || person?.name || "";
  const flag = typeof person === "string" ? null : motorsportsFlag(person?.cc);
  if (flag) span.append(flag);
  span.append(name);
  return span;
}

function motorsportsPeople(list, { stacked = false } = {}) {
  const span = element("span", stacked ? "ms-people is-stacked" : "ms-people");
  (list || []).forEach((person, index) => {
    if (index && !stacked) span.append(", ");
    span.append(motorsportsPerson(person));
  });
  return span;
}

// Winner line for a calendar row: driver (with flag) · team, or each class's team.
function motorsportsWinnerNode(round) {
  if (Array.isArray(round.results) && round.results.length) {
    const first = round.results.find((row) => row.pos === 1) || round.results[0];
    const span = element("span");
    span.append(motorsportsPerson(first, "driver"));
    if (first.team) span.append(" · ", motorsportsTeam(first.team));
    return span;
  }
  if (round.winners && Object.keys(round.winners).length) {
    const span = element("span");
    Object.entries(round.winners).forEach(([name, item], index) => {
      if (index) span.append(" · ");
      span.append(`${name}: `, motorsportsTeam(item.team, item.cc));
    });
    return span;
  }
  return null;
}

function motorsportsWinnerText(round) {
  if (Array.isArray(round.results) && round.results.length) {
    const first = round.results.find((row) => row.pos === 1) || round.results[0];
    return `${first.driver}${first.team ? ` · ${first.team}` : ""}`;
  }
  if (round.winner) return round.winner;
  if (round.winners && Object.keys(round.winners).length) return Object.entries(round.winners).map(([name, item]) => `${name}: ${item.team}`).join(" · ");
  return "";
}

function motorsportsNav(active) {
  const nav = element("nav", "ms-nav");
  nav.setAttribute("aria-label", "Series");
  for (const [id, label] of [["", "Overview"], ...Object.entries(motorsportsLabels)]) {
    const link = element("a", id === active ? "is-active" : "", label);
    link.href = id ? `#motorsports/${id}` : "#motorsports";
    if (id === active) link.setAttribute("aria-current", "page");
    nav.append(link);
  }
  return nav;
}

function motorsportsTable(columns, rows) {
  const scroll = element("div", "ms-scroll");
  const table = element("table", "ms-table");
  const head = element("thead");
  const headRow = element("tr");
  for (const [label] of columns) headRow.append(element("th", "", label));
  head.append(headRow);
  const body = element("tbody");
  for (const row of rows) {
    const tr = element("tr", row.pos === 1 ? "is-first" : "");
    for (const [, read] of columns) {
      const value = read(row);
      const td = element("td");
      if (value instanceof Node) td.append(value);
      else td.textContent = value == null || value === "" ? "—" : String(value);
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(head, body);
  scroll.append(table);
  return scroll;
}

function motorsportsCredit(data) {
  const credit = element("p", "ms-muted ms-credit");
  const link = element("a", "", data.source?.name || "Source");
  link.href = data.source?.url || "#";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  credit.append("Data: ", link, data.source?.license ? ` (${data.source.license})` : "", data.timesNote ? `. ${data.timesNote.replace("are US Eastern", "are shown in your time zone")}` : "",
    data.generatedAt ? `. Updated ${new Date(data.generatedAt).toLocaleDateString()}.` : ".");
  return credit;
}

// ---------- live (ESPN) ----------

async function motorsportsLive(id, box) {
  const slug = motorsportsEspn[id];
  if (!slug) return;
  try {
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/racing/${slug}/scoreboard`);
    if (!response.ok) return;
    const data = await response.json();
    for (const event of data.events || []) {
      const session = (event.competitions || []).find((competition) => competition.status?.type?.state === "in");
      if (!session) continue;
      const order = [...(session.competitors || [])].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).slice(0, 20);
      const card = element("section", "ms-live");
      const title = element("h3");
      title.append(element("span", "ms-live-dot"), `Live: ${event.shortName || event.name} · ${session.type?.text || session.type?.abbreviation || "Session"}`);
      card.append(title, element("p", "ms-muted", session.status?.type?.detail || session.status?.type?.shortDetail || ""));
      const list = element("ol", "ms-live-order");
      for (const competitor of order) {
        const item = element("li");
        const name = element("strong", "ms-person");
        const flagHref = competitor.athlete?.flag?.href || "";
        if (/^https:\/\/a\.espncdn\.com\//.test(flagHref)) {
          const flag = element("img", "ms-flag");
          flag.src = flagHref;
          flag.alt = competitor.athlete.flag.alt || "";
          flag.title = competitor.athlete.flag.alt || "";
          flag.width = 20;
          flag.height = 15;
          name.append(flag);
        }
        name.append(competitor.athlete?.displayName || competitor.athlete?.shortName || "");
        item.append(name,
          element("small", "", [competitor.vehicle?.number ? `#${competitor.vehicle.number}` : "", competitor.vehicle?.manufacturer || competitor.team?.displayName || ""].filter(Boolean).join(" · ")));
        list.append(item);
      }
      card.append(list, element("p", "ms-muted", "Running order from ESPN; refreshes every 30 seconds."));
      box.replaceChildren(card);
      setTimeout(() => { if (box.isConnected) motorsportsLive(id, box); }, 30000);
      return;
    }
    box.replaceChildren();
  } catch {
    // Live order is optional.
  }
}

// ---------- overview ----------

async function motorsportsOverview(container) {
  const page = element("section", "ms-page");
  page.append(motorsportsNav(""));
  const live = element("div", "ms-live-area");
  page.append(live);
  const grid = element("div", "ms-cards");
  page.append(grid);
  container.replaceChildren(page);
  for (const id of Object.keys(motorsportsEspn)) {
    const slot = element("div");
    live.append(slot);
    motorsportsLive(id, slot);
  }
  const summary = typeof loadMotorsportsSummary === "function" ? await loadMotorsportsSummary() : [];
  if (!summary.length) throw new Error("No motorsports summary yet.");
  for (const id of Object.keys(motorsportsLabels)) {
    const item = summary.find((entry) => entry.id === id);
    const card = element("a", `ms-card series-${id}`);
    card.href = `#motorsports/${id}`;
    if (!item) {
      card.append(element("h3", "", motorsportsLabels[id]), element("p", "ms-muted", "Data isn’t available yet."));
      grid.append(card);
      continue;
    }
    card.append(element("h3", "", item.name), element("p", "ms-muted", String(item.season || "")));
    if (item.next) {
      const block = element("div", "ms-card-next");
      block.append(element("small", "", "Next"), element("strong", "", item.next.name),
        element("span", "", `${motorsportsDate(item.next.start)}${motorsportsCountdown(item.next.start) ? ` · ${motorsportsCountdown(item.next.start)}` : ""}`));
      if (item.next.track) block.append(element("small", "", item.next.track));
      card.append(block);
    } else {
      card.append(element("p", "ms-card-done", `${item.season} season complete`));
    }
    if (item.last) {
      const block = element("div", "ms-card-last");
      const winner = element("span", "", "🏁 ");
      winner.append(item.last.winner ? motorsportsPerson({ name: item.last.winner, cc: item.last.cc }) : "Result pending");
      block.append(element("small", "", `Last: ${item.last.name}`), winner);
      card.append(block);
    }
    if (item.leader?.name) {
      const scope = item.leader.title && item.leader.title !== "Drivers" ? ` (${item.leader.title.replace(/ drivers$/, "")})` : "";
      const line = element("p", "ms-card-leader", `${item.next ? "Points leader" : "Champion"}${scope}: `);
      line.append(motorsportsPerson({ name: item.leader.name, cc: item.leader.cc }), ` · ${item.leader.points.toLocaleString()} pts`);
      card.append(line);
    }
    grid.append(card);
  }
}

// ---------- series ----------

function motorsportsRoundRow(id, round, nextRound) {
  const item = element("li", `ms-round${round === nextRound ? " is-next" : ""}${motorsportsDone(round) ? " is-done" : ""}`);
  const link = element("a", "ms-round-link");
  link.href = `#motorsports/${id}/${round.round}`;
  const when = element("span", "ms-round-date");
  when.append(element("strong", "", motorsportsDate(round.start, false)), element("small", "", `Round ${round.round}`));
  const what = element("span", "ms-round-body");
  what.append(element("strong", "", round.name), element("small", "", [round.circuit || round.track, round.location].filter(Boolean).join(" · ")));
  const winner = motorsportsWinnerNode(round) || (round.winner ? document.createTextNode(round.winner) : null);
  if (winner) {
    const line = element("span", "ms-round-winner", "🏁 ");
    line.append(winner);
    what.append(line);
  }
  else if (round === nextRound) what.append(element("span", "ms-round-next", `Next up · ${motorsportsCountdown(round.start) || motorsportsDate(round.start)}`));
  link.append(when, what);
  item.append(link);
  const thumb = round === nextRound ? motorsportsTrackMap(id, round.circuit || round.track, { small: true }) : null;
  if (thumb) item.append(thumb);
  if (round === nextRound && round.sessions?.length) {
    const sessions = element("ul", "ms-sessions");
    for (const session of round.sessions) {
      const li = element("li", new Date(session.start) < Date.now() ? "is-past" : "");
      li.append(element("span", "", session.name), element("strong", "", motorsportsDate(session.start)));
      sessions.append(li);
    }
    item.append(sessions);
  }
  return item;
}

function motorsportsStandings(group) {
  const wrap = element("div", "ms-standings");
  for (const table of group.standings || []) {
    const section = element("section", "ms-section");
    section.append(element("h4", "", table.title));
    const rows = table.rows || [];
    const teamsTable = !/driver/i.test(table.title);
    const columns = [["Pos", (row) => row.pos], ["", (row) => (row.drivers ? motorsportsPeople(row.drivers) : teamsTable ? motorsportsTeam(row.name, row.cc) : motorsportsPerson(row))]];
    if (rows.some((row) => row.team)) columns.push(["Team", (row) => (row.team ? motorsportsTeam(row.team.split(", ")[0]) : "")]);
    columns.push(["Pts", (row) => row.points]);
    if (rows.some((row) => row.wins != null)) columns.push(["Wins", (row) => row.wins]);
    if (rows.some((row) => row.top5 != null)) columns.push(["Top 5", (row) => row.top5], ["Top 10", (row) => row.top10]);
    columns[1][0] = /drivers/i.test(table.title) || table.title === "Drivers" ? "Driver" : "Team";
    section.append(motorsportsTable(columns, rows));
    wrap.append(section);
  }
  if (!wrap.childElementCount) wrap.append(element("p", "ms-muted", "Standings aren’t available yet."));
  return wrap;
}

function motorsportsRoundDetail(id, data, group, round) {
  const page = element("section", "ms-round-detail");
  const back = element("a", "ms-back", `← ${data.name} calendar`);
  back.href = `#motorsports/${id}`;
  page.append(back, element("h3", "", round.name), element("p", "ms-muted", [round.circuit || round.track, round.location, motorsportsDate(round.start)].filter(Boolean).join(" · ")));
  const top = element("div", "ms-round-top");
  if (round.sessions?.length) {
    const sessions = element("ul", "ms-sessions");
    for (const session of round.sessions) {
      const li = element("li", new Date(session.start) < Date.now() ? "is-past" : "");
      li.append(element("span", "", session.name), element("strong", "", motorsportsDate(session.start)));
      sessions.append(li);
    }
    top.append(sessions);
  }
  const map = motorsportsTrackMap(id, round.circuit || round.track);
  if (map) top.append(map);
  if (top.childElementCount) page.append(top);
  if (id === "f1" && round.results?.length) {
    for (const [title, rows] of [["Race", round.results], ["Sprint", round.sprint || []]]) {
      if (!rows.length) continue;
      page.append(element("h4", "", title), motorsportsTable([["Pos", (row) => row.pos ?? "—"], ["No", (row) => row.number], ["Driver", (row) => motorsportsPerson(row, "driver")],
        ["Team", (row) => motorsportsTeam(row.team)], ["Grid", (row) => row.grid || "Pit"], ["Laps", (row) => row.laps], ["Time / status", (row) => `${row.time}${row.fastest ? " ⏱" : ""}`], ["Pts", (row) => row.points || ""]], rows));
    }
    if (round.results.some((row) => row.fastest)) page.append(element("p", "ms-muted", "⏱ fastest lap"));
  } else if (id === "nascar" && round.results?.length) {
    const facts = [round.stageWinners?.length ? `Stage winners: ${round.stageWinners.map((item) => `${item.stage}: ${item.driver}`).join(", ")}` : "",
      round.cautions != null ? `${round.cautions} cautions` : "", round.leadChanges != null ? `${round.leadChanges} lead changes among ${round.leaders} drivers` : "",
      round.margin ? `Margin ${round.margin} s` : "", round.averageSpeed ? `Average ${round.averageSpeed} mph` : ""].filter(Boolean);
    if (facts.length) page.append(element("p", "ms-facts", facts.join(" · ")));
    page.append(motorsportsTable([["Pos", (row) => row.pos], ["Start", (row) => row.start], ["#", (row) => row.car], ["Driver", (row) => motorsportsPerson(row, "driver")], ["Team", (row) => motorsportsTeam(row.team)],
      ["Make", (row) => row.make], ["Laps", (row) => row.laps], ["Led", (row) => row.led || ""], ["Status", (row) => row.status], ["Pts", (row) => row.points]], round.results));
  } else if (round.winners && Object.keys(round.winners).length) {
    const grid = element("div", "ms-class-winners");
    for (const [name, item] of Object.entries(round.winners)) {
      const card = element("div", "ms-class-winner");
      const team = element("strong");
      team.append(motorsportsTeam(item.team, item.cc));
      card.append(element("small", "", `${name} winner`), team, motorsportsPeople(item.drivers, { stacked: true }));
      grid.append(card);
    }
    page.append(grid, element("p", "ms-muted", "Class winners from Wikipedia; the full classification is on the race report."));
  } else {
    page.append(element("p", "ms-muted", "Results appear here after the race."));
  }
  return page;
}

async function motorsportsSeriesPage(container, id, roundNumber) {
  const [data] = await Promise.all([motorsportsLoad(id), motorsportsLoadLogos(), motorsportsLoadTracks()]);
  const page = element("section", "ms-page");
  page.append(motorsportsNav(id));
  const head = element("div", "ms-head");
  head.append(element("h2", "", `${data.name} ${data.season}`));
  if (data.series?.length > 1) {
    const label = element("label", "field", "Series");
    const select = element("select");
    const current = String(motorsportsGroup(data).id);
    for (const series of data.series) {
      const option = element("option", "", series.name);
      option.value = String(series.id);
      option.selected = String(series.id) === current;
      select.append(option);
    }
    select.addEventListener("change", () => { motorsportsNascarSeries.set(id, select.value); motorsportsSeriesPage(container, id, roundNumber); });
    label.append(select);
    head.append(label);
  }
  page.append(head);
  const group = motorsportsGroup(data);
  const rounds = group.rounds || [];
  const live = element("div", "ms-live-area");
  page.append(live);
  motorsportsLive(id, live);
  const round = roundNumber ? rounds.find((item) => String(item.round) === String(roundNumber)) : null;
  if (round) {
    page.append(motorsportsRoundDetail(id, data, group, round));
  } else {
    const next = motorsportsNext(rounds);
    const layout = element("div", "ms-layout");
    const calendar = element("section", "ms-section");
    calendar.append(element("h3", "", "Calendar"));
    if (!next) calendar.append(element("p", "ms-card-done", `${data.season} season complete. Next season’s calendar will appear when it’s published.`));
    const list = element("ol", "ms-rounds");
    rounds.forEach((item) => list.append(motorsportsRoundRow(id, item, next)));
    calendar.append(list);
    const standings = element("section", "ms-section");
    standings.append(element("h3", "", "Standings"), motorsportsStandings(group));
    layout.append(calendar, standings);
    page.append(layout);
  }
  page.append(motorsportsCredit(data));
  container.replaceChildren(page);
}

function createMotorsports(route = "") {
  const container = element("div", "ms-view");
  container.append(element("p", "ms-muted", "Loading…"));
  const match = /^(f1|nascar|imsa|wec)(?:\/(\d+))?$/.exec(route);
  (match ? motorsportsSeriesPage(container, match[1], match[2]) : motorsportsOverview(container)).catch((error) => {
    console.error("Could not load motorsports data.", error);
    container.replaceChildren(motorsportsNav(match?.[1] || ""), element("p", "", "Motorsports data isn’t available yet. It’s built when the site is published."));
  });
  return container;
}
