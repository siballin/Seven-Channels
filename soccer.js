// Premier League, La Liga and MLS: Matches | Table | Stats tabs inside the league panel, and a soccer match centre
// (timeline, match stats, lineups, form, mini table). Everything comes from ESPN's public soccer endpoints,
// fetched in the browser. Loaded after sports-leagues.js; element() comes from the app.

const soccerCache = new Map();
function soccerFetch(url, maxAge = 300000) {
  const hit = soccerCache.get(url);
  if (hit && Date.now() - hit.time < maxAge) return hit.promise;
  const promise = fetch(url).then((response) => {
    if (!response.ok) throw new Error(`ESPN request failed (${response.status}).`);
    return response.json();
  });
  promise.catch(() => soccerCache.delete(url));
  soccerCache.set(url, { time: Date.now(), promise });
  return promise;
}

function soccerStat(stats, name) {
  const stat = (stats || []).find((item) => item.name === name);
  return stat ? Number(stat.value ?? stat.displayValue) : null;
}

function soccerLogo(team, size = 20) {
  const href = team?.logo || team?.logos?.[0]?.href || "";
  if (!/^https:\/\/a\.espncdn\.com\//.test(href)) return element("span", "soccer-logo soccer-logo-empty");
  const image = element("img", "soccer-logo");
  image.src = href;
  image.alt = "";
  image.width = size;
  image.height = size;
  image.loading = "lazy";
  image.addEventListener("error", () => image.replaceWith(element("span", "soccer-logo soccer-logo-empty")), { once: true });
  return image;
}

function soccerNoteColor(color) {
  const match = /#?#?([0-9a-f]{6})/i.exec(color || "");
  return match ? `#${match[1]}` : "";
}

// ---------- data ----------

async function soccerStandings(league) {
  const data = await soccerFetch(`https://site.api.espn.com/apis/v2/sports/${league.path}/standings`);
  const groups = (data.children || []).map((group) => ({
    name: group.name || group.abbreviation || league.label,
    entries: (group.standings?.entries || []).map((entry) => ({
      team: { id: String(entry.team?.id || ""), name: entry.team?.displayName || "", short: entry.team?.shortDisplayName || entry.team?.displayName || "",
        abbr: entry.team?.abbreviation || "", logo: entry.team?.logos?.[0]?.href || "" },
      rank: soccerStat(entry.stats, "rank"), gp: soccerStat(entry.stats, "gamesPlayed"), w: soccerStat(entry.stats, "wins"),
      d: soccerStat(entry.stats, "ties"), l: soccerStat(entry.stats, "losses"), gf: soccerStat(entry.stats, "pointsFor"),
      ga: soccerStat(entry.stats, "pointsAgainst"), gd: soccerStat(entry.stats, "pointDifferential"), pts: soccerStat(entry.stats, "points"),
      deductions: soccerStat(entry.stats, "deductions"),
      note: entry.note ? { color: soccerNoteColor(entry.note.color), description: entry.note.description || "" } : null,
    })).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)),
  })).filter((group) => group.entries.length);
  return { groups, season: data.seasons?.[0]?.displayName || data.children?.[0]?.name || "" };
}

function soccerDay(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

// Every league match from the start of the season to today (one request), for form, home/away tables and team stats.
async function soccerSeasonMatches(league) {
  const current = await soccerFetch(`https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard`, 600000);
  const start = new Date(current.leagues?.[0]?.season?.startDate || current.leagues?.[0]?.calendarStartDate || Date.now() - 200 * 86400000);
  const end = new Date();
  end.setDate(end.getDate() + 30);
  const data = await soccerFetch(`https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard?dates=${soccerDay(start)}-${soccerDay(end)}&limit=1000`, 600000);
  return (data.events || []).map((event) => {
    const competition = event.competitions?.[0] || {};
    const side = (homeAway) => {
      const team = (competition.competitors || []).find((item) => item.homeAway === homeAway) || {};
      return { id: String(team.team?.id || ""), name: team.team?.shortDisplayName || team.team?.displayName || "", abbr: team.team?.abbreviation || "",
        logo: team.team?.logo || team.team?.logos?.[0]?.href || "", score: team.score === undefined ? null : Number(team.score) };
    };
    return { id: String(event.id), date: event.date, completed: Boolean(event.status?.type?.completed), state: event.status?.type?.state || "",
      home: side("home"), away: side("away") };
  }).filter((match) => match.home.id && match.away.id).sort((a, b) => a.date.localeCompare(b.date));
}

function soccerResult(match, teamId) {
  const mine = match.home.id === teamId ? match.home : match.away;
  const theirs = match.home.id === teamId ? match.away : match.home;
  return mine.score > theirs.score ? "W" : mine.score < theirs.score ? "L" : "D";
}

// A table built from match results; side "home" or "away" counts only those matches.
function soccerTableFromMatches(matches, side = "all") {
  const rows = new Map();
  const row = (team) => {
    if (!rows.has(team.id)) rows.set(team.id, { team: { id: team.id, short: team.name, abbr: team.abbr, logo: team.logo }, gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
    return rows.get(team.id);
  };
  for (const match of matches.filter((item) => item.completed)) {
    for (const [mine, theirs, where] of [[match.home, match.away, "home"], [match.away, match.home, "away"]]) {
      const entry = row(mine);
      if (side !== "all" && side !== where) continue;
      entry.gp++;
      entry.gf += mine.score;
      entry.ga += theirs.score;
      if (mine.score > theirs.score) entry.w++;
      else if (mine.score < theirs.score) entry.l++;
      else entry.d++;
    }
  }
  return [...rows.values()].map((entry) => ({ ...entry, gd: entry.gf - entry.ga, pts: entry.w * 3 + entry.d }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.short.localeCompare(b.team.short))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function soccerForm(matches, teamId, count = 5) {
  return matches.filter((match) => match.completed && (match.home.id === teamId || match.away.id === teamId)).slice(-count);
}

function soccerTeamStats(matches) {
  const teams = new Map();
  for (const match of matches.filter((item) => item.completed)) {
    for (const [mine, theirs] of [[match.home, match.away], [match.away, match.home]]) {
      if (!teams.has(mine.id)) teams.set(mine.id, { team: mine, gp: 0, gf: 0, ga: 0, cleanSheets: 0, blanks: 0, bigWin: null, results: [] });
      const entry = teams.get(mine.id);
      entry.gp++;
      entry.gf += mine.score;
      entry.ga += theirs.score;
      if (theirs.score === 0) entry.cleanSheets++;
      if (mine.score === 0) entry.blanks++;
      const margin = mine.score - theirs.score;
      if (margin > 0 && (!entry.bigWin || margin > entry.bigWin.margin)) entry.bigWin = { margin, text: `${mine.score}–${theirs.score} v ${theirs.name}` };
      entry.results.push(margin > 0 ? "W" : margin < 0 ? "L" : "D");
    }
  }
  return [...teams.values()].map((entry) => {
    // Current run: unbeaten or winless streak from the latest match back.
    let unbeaten = 0;
    for (const result of [...entry.results].reverse()) { if (result === "L") break; unbeaten++; }
    let winless = 0;
    for (const result of [...entry.results].reverse()) { if (result === "W") break; winless++; }
    return { ...entry, gfpg: entry.gp ? entry.gf / entry.gp : 0, gapg: entry.gp ? entry.ga / entry.gp : 0, unbeaten, winless };
  });
}

// ---------- shared UI ----------

function soccerFormChips(matches, teamId) {
  const chips = element("span", "soccer-form");
  for (const match of soccerForm(matches, teamId)) {
    const result = soccerResult(match, teamId);
    const home = match.home.id === teamId;
    const opponent = home ? match.away : match.home;
    const chip = element("span", `soccer-chip is-${result}`, result);
    chip.title = `${result === "W" ? "Won" : result === "L" ? "Lost" : "Drew"} ${match.home.score}–${match.away.score} ${home ? "v" : "at"} ${opponent.name}, ${new Date(match.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    chips.append(chip);
  }
  return chips;
}

function soccerTableElement(entries, { matches = [], showForm = true, highlight = [] } = {}) {
  const scroll = element("div", "soccer-table-scroll");
  const table = element("table", "soccer-table");
  const head = element("thead");
  const headRow = element("tr");
  for (const [label, title] of [["#", "Position"], ["Club", ""], ["P", "Played"], ["W", "Won"], ["D", "Drawn"], ["L", "Lost"], ["GF", "Goals for"], ["GA", "Goals against"], ["GD", "Goal difference"], ["Pts", "Points"], ...(showForm ? [["Form", "Last five league matches, oldest first"]] : [])]) {
    const th = element("th", "", label);
    if (title) th.title = title;
    headRow.append(th);
  }
  head.append(headRow);
  const body = element("tbody");
  for (const entry of entries) {
    const tr = element("tr", highlight.includes(entry.team.id) ? "is-highlight" : "");
    if (entry.note?.color) {
      tr.style.setProperty("--zone", entry.note.color);
      tr.classList.add("has-zone");
      tr.title = entry.note.description;
    }
    const club = element("td", "soccer-club");
    const clubInner = element("span", "soccer-club-inner");
    clubInner.append(soccerLogo(entry.team), element("span", "soccer-club-name", entry.team.short || entry.team.name), element("span", "soccer-club-abbr", entry.team.abbr || entry.team.short));
    club.append(clubInner);
    const gd = entry.gd ?? (entry.gf ?? 0) - (entry.ga ?? 0);
    tr.append(element("td", "soccer-rank", String(entry.rank ?? "")), club,
      ...[entry.gp, entry.w, entry.d, entry.l, entry.gf, entry.ga].map((value) => element("td", "", value == null ? "—" : String(value))),
      element("td", gd > 0 ? "is-plus" : gd < 0 ? "is-minus" : "", `${gd > 0 ? "+" : ""}${gd}`), element("td", "soccer-pts", String(entry.pts ?? "—")));
    if (showForm) {
      const form = element("td");
      form.append(soccerFormChips(matches, entry.team.id));
      tr.append(form);
    }
    body.append(tr);
  }
  table.append(head, body);
  scroll.append(table);
  return scroll;
}

function soccerZoneLegend(entries) {
  const zones = new Map();
  for (const entry of entries) if (entry.note?.color && entry.note.description) zones.set(entry.note.description, entry.note.color);
  if (!zones.size) return null;
  const legend = element("ul", "soccer-legend");
  for (const [description, color] of zones) {
    const item = element("li");
    const swatch = element("span", "soccer-swatch");
    swatch.style.background = color;
    item.append(swatch, description);
    legend.append(item);
  }
  return legend;
}

// ---------- Table tab ----------

const soccerTableView = new Map(); // league id → { group, side }

async function soccerTablePanel(panel, league) {
  panel.replaceChildren(element("p", "score-status", `Loading the ${league.label} table…`));
  const [standings, matches] = await Promise.all([soccerStandings(league), soccerSeasonMatches(league).catch(() => [])]);
  const view = soccerTableView.get(league.id) || { group: "0", side: "all" };
  soccerTableView.set(league.id, view);
  const controls = element("div", "soccer-controls");
  const groupOptions = standings.groups.map((group, index) => [String(index), group.name]);
  if (standings.groups.length > 1) groupOptions.push(["overall", "Overall (all clubs)"]);
  const select = (label, value, options, onChange) => {
    const wrap = element("label", "field", label);
    const input = element("select");
    for (const [optionValue, text] of options) {
      const option = element("option", "", text);
      option.value = optionValue;
      option.selected = optionValue === value;
      input.append(option);
    }
    input.addEventListener("change", () => onChange(input.value));
    wrap.append(input);
    return wrap;
  };
  const body = element("div");
  const draw = () => {
    let entries;
    if (view.side !== "all") {
      const ids = view.group === "overall" ? null : new Set(standings.groups[Number(view.group)]?.entries.map((entry) => entry.team.id));
      entries = soccerTableFromMatches(matches, view.side).filter((entry) => !ids || ids.has(entry.team.id)).map((entry, index) => ({ ...entry, rank: index + 1 }));
    } else if (view.group === "overall") {
      entries = standings.groups.flatMap((group) => group.entries)
        .sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0) || (b.gd ?? 0) - (a.gd ?? 0) || (b.gf ?? 0) - (a.gf ?? 0))
        .map((entry, index) => ({ ...entry, rank: index + 1, note: null }));
    } else {
      entries = standings.groups[Number(view.group)]?.entries || [];
    }
    const note = view.side === "all"
      ? (view.group === "overall" ? "All clubs by points: the Supporters’ Shield race." : "")
      : `${view.side === "home" ? "Home" : "Away"} matches only, worked out from this season’s results.`;
    body.replaceChildren(...[note ? element("p", "soccer-muted", note) : null, soccerTableElement(entries, { matches }), view.side === "all" ? soccerZoneLegend(entries) : null].filter(Boolean));
  };
  if (groupOptions.length > 1) controls.append(select(league.id === "mls" ? "Conference" : "Group", view.group, groupOptions, (value) => { view.group = value; draw(); }));
  controls.append(select("Matches", view.side, [["all", "All"], ["home", "Home"], ["away", "Away"]], (value) => { view.side = value; draw(); }));
  panel.replaceChildren(element("h4", "soccer-panel-title", standings.season || `${league.label} table`), controls, body);
  draw();
}

// ---------- Stats tab ----------

async function soccerStatsPanel(panel, league) {
  panel.replaceChildren(element("p", "score-status", `Loading ${league.label} stats…`));
  const [statistics, matches] = await Promise.all([
    soccerFetch(`https://site.api.espn.com/apis/site/v2/sports/${league.path}/statistics`).catch(() => null),
    soccerSeasonMatches(league).catch(() => []),
  ]);
  const parts = [];
  const categories = new Map((statistics?.stats || []).map((category) => [category.name, category]));
  const leaders = (name) => (categories.get(name)?.leaders || []).filter((item) => item.athlete?.displayName);
  const goals = leaders("goalsLeaders");
  const assists = leaders("assistsLeaders");
  const matchesFrom = (item) => Number(/Matches:\s*(\d+)/.exec(item.displayValue || "")?.[1]) || null;
  // Goal contributions: goals + assists for everyone on either list.
  const combined = new Map();
  for (const [list, key] of [[goals, "g"], [assists, "a"]]) {
    for (const item of list) {
      const id = item.athlete.id;
      if (!combined.has(id)) combined.set(id, { athlete: item.athlete, g: 0, a: 0, m: matchesFrom(item) });
      combined.get(id)[key] = item.value || 0;
    }
  }
  const contributions = [...combined.values()].map((item) => ({ ...item, value: item.g + item.a })).sort((a, b) => b.value - a.value || b.g - a.g).slice(0, 20);

  const leaderList = (title, list, valueOf, extraOf) => {
    const card = element("section", "soccer-leaders");
    card.append(element("h4", "", title));
    if (!list.length) { card.append(element("p", "soccer-muted", "Not available yet this season.")); return card; }
    const ol = element("ol");
    for (const item of list.slice(0, 20)) {
      const li = element("li");
      const name = element("span", "soccer-leader-name");
      name.append(soccerLogo(item.athlete.team, 18), element("strong", "", item.athlete.displayName), element("small", "", item.athlete.team?.abbreviation || ""));
      li.append(name, element("small", "soccer-leader-extra", extraOf(item)), element("strong", "soccer-leader-value", String(valueOf(item))));
      ol.append(li);
    }
    card.append(ol);
    return card;
  };
  const grid = element("div", "soccer-leader-grid");
  grid.append(
    leaderList("Top scorers", goals, (item) => item.value, (item) => matchesFrom(item) ? `${matchesFrom(item)} matches` : ""),
    leaderList("Assists", assists, (item) => item.value, (item) => matchesFrom(item) ? `${matchesFrom(item)} matches` : ""),
    leaderList("Goals + assists", contributions, (item) => item.value, (item) => `${item.g} G · ${item.a} A`),
  );
  parts.push(element("h4", "soccer-panel-title", "Players"), grid);

  const teams = soccerTeamStats(matches);
  if (teams.length) {
    const teamCards = element("div", "soccer-leader-grid");
    const teamList = (title, sorted, valueOf, extraOf = () => "") => {
      const card = element("section", "soccer-leaders");
      card.append(element("h4", "", title));
      const ol = element("ol");
      for (const item of sorted.slice(0, 8)) {
        const li = element("li");
        const name = element("span", "soccer-leader-name");
        name.append(soccerLogo(item.team, 18), element("strong", "", item.team.name));
        li.append(name, element("small", "soccer-leader-extra", extraOf(item)), element("strong", "soccer-leader-value", String(valueOf(item))));
        ol.append(li);
      }
      card.append(ol);
      return card;
    };
    const per = (value) => value.toFixed(2);
    teamCards.append(
      teamList("Most goals", [...teams].sort((a, b) => b.gf - a.gf), (item) => item.gf, (item) => `${per(item.gfpg)} a game`),
      teamList("Fewest conceded", [...teams].sort((a, b) => a.ga - b.ga), (item) => item.ga, (item) => `${per(item.gapg)} a game`),
      teamList("Clean sheets", [...teams].sort((a, b) => b.cleanSheets - a.cleanSheets), (item) => item.cleanSheets, (item) => `${item.gp} played`),
      teamList("Failed to score", [...teams].sort((a, b) => b.blanks - a.blanks), (item) => item.blanks, (item) => `${item.gp} played`),
      teamList("Unbeaten run", [...teams].sort((a, b) => b.unbeaten - a.unbeaten), (item) => item.unbeaten, () => "matches"),
      teamList("Biggest win", [...teams].filter((item) => item.bigWin).sort((a, b) => b.bigWin.margin - a.bigWin.margin), (item) => `+${item.bigWin.margin}`, (item) => item.bigWin.text),
    );
    const played = matches.filter((match) => match.completed);
    const totalGoals = played.reduce((sum, match) => sum + match.home.score + match.away.score, 0);
    const homeWins = played.filter((match) => match.home.score > match.away.score).length;
    const draws = played.filter((match) => match.home.score === match.away.score).length;
    const summary = element("div", "soccer-summary");
    for (const [label, value] of [["Matches played", played.length], ["Goals", totalGoals], ["Goals a match", played.length ? (totalGoals / played.length).toFixed(2) : "—"],
      ["Home wins", played.length ? `${Math.round((homeWins / played.length) * 100)}%` : "—"], ["Draws", played.length ? `${Math.round((draws / played.length) * 100)}%` : "—"]]) {
      const tile = element("div", "soccer-summary-tile");
      tile.append(element("strong", "", String(value)), element("span", "", label));
      summary.append(tile);
    }
    parts.push(element("h4", "soccer-panel-title", "Clubs"), summary, teamCards);
  }
  parts.push(element("p", "soccer-muted", "Player leaders from ESPN; club figures worked out from this season’s league results."));
  panel.replaceChildren(...parts);
}

// ---------- tabs inside the league panel ----------

function soccerEnhance(section, league) {
  const heading = section.querySelector(".scoreboard-heading");
  const matches = element("div", "soccer-panel soccer-matches");
  for (const child of [...section.children]) if (child !== heading) matches.append(child);
  const tablePanel = element("div", "soccer-panel");
  const statsPanel = element("div", "soccer-panel");
  const panels = { matches, table: tablePanel, stats: statsPanel };
  const loaded = new Set(["matches"]);
  const nav = element("div", "soccer-tabs");
  nav.setAttribute("role", "tablist");
  nav.setAttribute("aria-label", `${league.label} views`);
  const buttons = {};
  const show = (key) => {
    if (title && headings?.[key]) { title.textContent = headings[key][0]; if (note) note.textContent = headings[key][1]; }
    for (const [name, panel] of Object.entries(panels)) {
      panel.hidden = name !== key;
      buttons[name].setAttribute("aria-selected", String(name === key));
      buttons[name].tabIndex = name === key ? 0 : -1;
    }
    if (!loaded.has(key)) {
      loaded.add(key);
      const task = key === "table" ? soccerTablePanel(tablePanel, league) : soccerStatsPanel(statsPanel, league);
      task.catch((error) => {
        console.error(`Could not load ${league.label} ${key}.`, error);
        loaded.delete(key);
        panels[key].replaceChildren(element("p", "score-status", `Couldn’t load the ${key}. Check your connection and try again.`));
      });
    }
    try { sessionStorage.setItem(`seven-channels.soccer-tab.${league.id}`, key); } catch { /* optional */ }
  };
  for (const [key, label] of [["matches", "Matches"], ["table", "Table"], ["stats", "Stats"]]) {
    const button = element("button", "soccer-tab", label);
    button.type = "button";
    button.setAttribute("role", "tab");
    button.id = `${league.id}-tab-${key}`;
    panels[key].setAttribute("role", "tabpanel");
    panels[key].setAttribute("aria-labelledby", button.id);
    button.addEventListener("click", () => show(key));
    button.addEventListener("keydown", (event) => {
      const keys = Object.keys(panels);
      const index = keys.indexOf(key);
      const next = event.key === "ArrowRight" ? keys[(index + 1) % keys.length] : event.key === "ArrowLeft" ? keys[(index + keys.length - 1) % keys.length] : null;
      if (next) { event.preventDefault(); show(next); buttons[next].focus(); }
    });
    buttons[key] = button;
    nav.append(button);
  }
  heading.after(nav, matches, tablePanel, statsPanel);
  const title = heading.querySelector("h3");
  const note = heading.querySelector("p");
  const headings = { matches: [`${league.label.toUpperCase()} MATCHES`, `Every ${league.label} match for the selected day · Live matches refresh more often.`],
    table: [`${league.label.toUpperCase()} TABLE`, "Zones, form and home/away splits."], stats: [`${league.label.toUpperCase()} STATS`, "Scorers, assists and club numbers this season."] };
  section.showSoccerTab = show;
  let saved = "matches";
  try { saved = sessionStorage.getItem(`seven-channels.soccer-tab.${league.id}`) || "matches"; } catch { /* optional */ }
  show(panels[saved] ? saved : "matches");
}

// ---------- match centre ----------

const soccerEventTypes = [
  [/own-goal/, "own", "⚽", "Own goal"], [/penalty---missed|penalty---saved/, "miss", "✕", "Penalty missed"], [/penalty|goal/, "goal", "⚽", "Goal"],
  [/red-card|second-yellow/, "red", "", "Red card"], [/yellow-card/, "yellow", "", "Yellow card"], [/substitution/, "sub", "⇄", "Substitution"],
];

function soccerTimeline(summary, homeId) {
  const events = (summary.keyEvents || []).map((item) => {
    const type = item.type?.type || "";
    const kind = soccerEventTypes.find(([pattern]) => pattern.test(type));
    return kind ? { item, kind } : null;
  }).filter(Boolean);
  if (!events.length) return null;
  const section = element("section", "soccer-section");
  section.append(element("h5", "", "Timeline"));
  const list = element("ol", "soccer-timeline");
  for (const { item, kind } of events) {
    const [, className, icon, label] = kind;
    const home = String(item.team?.id) === homeId;
    const li = element("li", `soccer-event is-${className} ${home ? "is-home" : "is-away"}`);
    const names = (item.participants || []).map((part) => part.athlete?.displayName).filter(Boolean);
    const detail = className === "sub" ? `${names[0] || ""}${names[1] ? ` for ${names[1]}` : ""}`
      : className === "goal" || className === "own" ? `${names[0] || ""}${names[1] && className === "goal" ? ` (assist ${names[1]})` : ""}${className === "own" ? " (own goal)" : ""}${/penalty/.test(item.type?.type || "") ? " (pen)" : ""}`
      : names[0] || item.shortText || "";
    const marker = element("span", "soccer-event-icon", icon);
    marker.setAttribute("aria-label", label);
    li.append(element("span", "soccer-minute", item.clock?.displayValue || ""), marker, element("span", "soccer-event-text", detail));
    li.title = item.text || label;
    list.append(li);
  }
  section.append(list);
  return section;
}

function soccerStatBars(summary, homeId) {
  const teams = summary.boxscore?.teams || [];
  const home = teams.find((team) => String(team.team?.id) === homeId) || teams[0];
  const away = teams.find((team) => team !== home);
  if (!home?.statistics?.length || !away) return null;
  const value = (team, name) => {
    const stat = team.statistics.find((item) => item.name === name);
    return stat ? Number(stat.displayValue ?? stat.value) : null;
  };
  const rows = [["possessionPct", "Possession", "%"], ["totalShots", "Shots"], ["shotsOnTarget", "On target"], ["wonCorners", "Corners"], ["accuratePasses", "Accurate passes"],
    ["totalTackles", "Tackles"], ["interceptions", "Interceptions"], ["saves", "Saves"], ["foulsCommitted", "Fouls"], ["offsides", "Offsides"], ["yellowCards", "Yellow cards"], ["redCards", "Red cards"]];
  const section = element("section", "soccer-section");
  section.append(element("h5", "", "Match stats"));
  const list = element("div", "soccer-bars");
  for (const [name, label, suffix = ""] of rows) {
    const a = value(home, name);
    const b = value(away, name);
    if (a === null || b === null || (name === "redCards" && !a && !b)) continue;
    const total = a + b || 1;
    const row = element("div", "soccer-bar-row");
    const bar = element("div", "soccer-bar");
    const left = element("span", "soccer-bar-home");
    left.style.width = `${(a / total) * 100}%`;
    const right = element("span", "soccer-bar-away");
    right.style.width = `${(b / total) * 100}%`;
    bar.append(left, right);
    const labels = element("div", "soccer-bar-labels");
    labels.append(element("strong", a > b ? "is-lead" : "", `${a}${suffix}`), element("span", "", label), element("strong", b > a ? "is-lead" : "", `${b}${suffix}`));
    row.append(labels, bar);
    list.append(row);
  }
  section.append(list);
  return list.childElementCount ? section : null;
}

// Match rating (an estimate on the usual 0–10 scale; about 6.5 is an ordinary game) from ESPN's per-player match stats:
// goals, assists, shots, saves, goals conceded while on the pitch, cards, fouls, offsides and the result.
// FotMob and SofaScore ratings have no open API, so this is worked out here.
function soccerPlayerRating(player, result) {
  const stats = Object.fromEntries((player.stats || []).map((stat) => [stat.name, Number(stat.value) || 0]));
  if (!(player.starter || player.subbedIn) || !stats.appearances) return null;
  const role = /^G/.test(player.position?.abbreviation || "") ? "G" : /defender|back/i.test(player.position?.name || "") ? "D" : /midfield/i.test(player.position?.name || "") ? "M" : "F";
  const goals = stats.totalGoals || 0;
  const conceded = stats.goalsConceded || 0;
  let rating = 6.4
    + goals * 1.0 + (stats.goalAssists || 0) * 0.7 - (stats.ownGoals || 0) * 0.8
    + Math.max(0, (stats.shotsOnTarget || 0) - goals) * 0.2 + Math.max(0, (stats.totalShots || 0) - (stats.shotsOnTarget || 0)) * 0.05
    + (stats.foulsSuffered || 0) * 0.05 - (stats.foulsCommitted || 0) * 0.05 - (stats.offsides || 0) * 0.05
    - (stats.yellowCards || 0) * 0.25 - (stats.redCards || 0) * 1.5
    + (result === "W" ? 0.3 : result === "L" ? -0.2 : 0);
  if (role === "G") rating += (stats.saves || 0) * 0.3 - conceded * 0.3 + (conceded ? 0 : 0.7);
  else if (role === "D") rating += -conceded * 0.15 + (conceded ? 0 : 0.4);
  else if (role === "M") rating += conceded ? 0 : 0.15;
  if (!player.starter) rating = 6.4 + (rating - 6.4) * 0.8; // less time on the pitch
  return Math.round(Math.min(10, Math.max(3, rating)) * 10) / 10;
}

function soccerRatingClass(rating) {
  return rating >= 8 ? "is-great" : rating >= 7 ? "is-good" : rating >= 6 ? "is-ok" : "is-poor";
}

function soccerPlayerTitle(player, rating) {
  const stats = Object.fromEntries((player.stats || []).map((stat) => [stat.name, Number(stat.value) || 0]));
  const parts = [["totalGoals", "goal"], ["goalAssists", "assist"], ["totalShots", "shot"], ["shotsOnTarget", "on target"], ["saves", "save"],
    ["yellowCards", "yellow"], ["redCards", "red"], ["foulsCommitted", "foul"]].filter(([key]) => stats[key])
    .map(([key, label]) => `${stats[key]} ${label}${stats[key] > 1 && !/target/.test(label) ? "s" : ""}`);
  return [player.athlete?.displayName, player.position?.displayName !== "Substitute" ? player.position?.displayName : "", rating != null ? `Rating ${rating.toFixed(1)}` : "", parts.join(", ")].filter(Boolean).join(" · ");
}

function soccerAvatar(player) {
  const wrap = element("span", "soccer-avatar");
  const jersey = () => element("span", "soccer-jersey", player.jersey || "");
  const url = player.athlete?.headshot?.href || "";
  if (/^https:\/\/a\.espncdn\.com\//.test(url)) {
    const image = element("img", "soccer-face");
    image.src = url.replace(/^https:\/\/a\.espncdn\.com\/i\//, "https://a.espncdn.com/combiner/i?img=/i/") + (/combiner/.test(url) ? "" : "&w=96&h=96");
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => { image.replaceWith(jersey()); wrap.classList.remove("has-face"); }, { once: true });
    wrap.classList.add("has-face");
    wrap.append(image, element("span", "soccer-avatar-number", player.jersey || ""));
  } else {
    wrap.append(jersey());
  }
  return wrap;
}

// Formation rows from ESPN's formation ("4-2-3-1") and formationPlace (1 = goalkeeper, then outfield order).
// context: { result: "W" | "D" | "L" | "", rated: whether the match has started }.
function soccerLineup(roster, context = {}) {
  const card = element("div", "soccer-lineup");
  const title = element("h6");
  title.append(soccerLogo(roster.team, 18), `${roster.team?.shortDisplayName || roster.team?.displayName || ""}${roster.formation ? ` · ${roster.formation}` : ""}`);
  card.append(title);
  const starters = (roster.roster || []).filter((player) => player.starter).sort((a, b) => (a.formationPlace || 99) - (b.formationPlace || 99));
  const subs = (roster.roster || []).filter((player) => !player.starter);
  const shape = /^\d(-\d)+$/.test(roster.formation || "") ? roster.formation.split("-").map(Number) : null;
  const ratings = new Map(context.rated ? (roster.roster || []).map((player) => [player, soccerPlayerRating(player, context.result)]).filter(([, rating]) => rating != null) : []);
  const best = Math.max(...ratings.values(), 0);
  const name = (player) => {
    const item = element("li", player.subbedOut ? "is-off" : player.subbedIn ? "is-on" : "");
    const rating = ratings.get(player);
    item.title = soccerPlayerTitle(player, rating);
    const top = element("span", "soccer-avatar-wrap");
    top.append(soccerAvatar(player));
    if (rating != null) top.append(element("span", `soccer-rating ${soccerRatingClass(rating)}${rating === best && context.best === rating ? " is-best" : ""}`, rating.toFixed(1)));
    const label = element("span", "soccer-player-name", player.athlete?.shortName || player.athlete?.displayName || "");
    if (player.subbedOut) label.append(element("span", "soccer-sub-mark", " ↓"));
    if (player.subbedIn) label.append(element("span", "soccer-sub-mark", " ↑"));
    item.append(top, label);
    return item;
  };
  if (shape && starters.length === 11 && shape.reduce((sum, count) => sum + count, 0) === 10) {
    const pitch = element("div", "soccer-pitch");
    let index = 1;
    const lines = [[starters[0]], ...shape.map((count) => { const line = starters.slice(index, index + count); index += count; return line; })];
    for (const line of lines) {
      const row = element("ul", "soccer-pitch-line");
      line.forEach((player) => row.append(name(player)));
      pitch.append(row);
    }
    card.append(pitch);
  } else if (starters.length) {
    const list = element("ul", "soccer-list");
    starters.forEach((player) => list.append(name(player)));
    card.append(list);
  }
  const used = subs.filter((player) => player.subbedIn);
  const unused = subs.filter((player) => !player.subbedIn);
  if (used.length) {
    const row = element("ul", "soccer-pitch-line soccer-subs-used");
    row.setAttribute("aria-label", "Substitutes who came on");
    used.forEach((player) => row.append(name(player)));
    card.append(element("p", "soccer-muted soccer-bench", "Came on"), row);
  }
  if (unused.length) {
    const bench = element("p", "soccer-muted soccer-bench");
    bench.textContent = `${used.length ? "Unused" : "Bench"}: ${unused.map((player) => player.athlete?.shortName || player.athlete?.displayName).join(", ")}`;
    card.append(bench);
  }
  return starters.length ? card : null;
}

function soccerLastFive(summary) {
  const teams = summary.lastFiveGames || [];
  if (!teams.length) return null;
  const section = element("section", "soccer-section");
  section.append(element("h5", "", "Form (last five, all competitions)"));
  for (const team of teams) {
    const row = element("div", "soccer-last-five");
    const label = element("span", "soccer-last-team");
    label.append(soccerLogo(team.team, 18), team.team?.abbreviation || team.team?.displayName || "");
    const chips = element("span", "soccer-form");
    for (const game of [...(team.events || [])].reverse()) {
      const chip = element("span", `soccer-chip is-${game.gameResult || "D"}`, game.gameResult || "–");
      chip.title = `${game.gameResult === "W" ? "Won" : game.gameResult === "L" ? "Lost" : "Drew"} ${game.score} ${game.atVs === "@" ? "at" : "v"} ${game.opponent?.displayName || ""} (${game.leagueAbbreviation || game.competitionName || ""}), ${new Date(game.gameDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
      chips.append(chip);
    }
    row.append(label, chips);
    section.append(row);
  }
  return section;
}

function soccerMiniTable(summary, ids) {
  const group = summary.standings?.groups?.find((item) => (item.standings?.entries || []).some((entry) => ids.includes(String(entry.id))));
  const entries = group?.standings?.entries || [];
  if (!entries.length) return null;
  const rows = entries.map((entry, index) => ({
    team: { id: String(entry.id), short: entry.team, abbr: "", logo: "" }, rank: soccerStat(entry.stats, "rank") || index + 1,
    gp: soccerStat(entry.stats, "gamesPlayed"), w: soccerStat(entry.stats, "wins"), d: soccerStat(entry.stats, "ties"), l: soccerStat(entry.stats, "losses"),
    gf: soccerStat(entry.stats, "pointsFor"), ga: soccerStat(entry.stats, "pointsAgainst"), gd: soccerStat(entry.stats, "pointDifferential"), pts: soccerStat(entry.stats, "points"),
  }));
  // Around the two clubs: from two above the higher one to two below the lower one.
  const positions = rows.map((row, index) => (ids.includes(row.team.id) ? index : -1)).filter((index) => index >= 0);
  const from = Math.max(0, Math.min(...positions) - 2);
  const to = Math.min(rows.length, Math.max(...positions) + 3);
  const section = element("section", "soccer-section");
  section.append(element("h5", "", group.header || "Table"), soccerTableElement(rows.slice(from, to), { showForm: false, highlight: ids }));
  return section;
}

function soccerMatchCentre(event, league) {
  const box = element("section", "league-detail soccer-centre");
  box.setAttribute("aria-live", "polite");
  const competition = event.competitions?.[0] || {};
  const status = typeof sportsLeagueStatus === "function" ? sportsLeagueStatus(competition) : { state: "", text: "" };
  const home = (competition.competitors || []).find((team) => team.homeAway === "home") || competition.competitors?.[0] || {};
  const away = (competition.competitors || []).find((team) => team !== home) || {};
  const scoreline = element("div", "soccer-scoreline");
  const side = (team) => {
    const wrap = element("div", "soccer-side");
    wrap.append(soccerLogo(team.team, 40), element("strong", "", team.team?.shortDisplayName || team.team?.displayName || ""));
    if (team.form) wrap.append(element("small", "soccer-muted", `Form ${team.form}`));
    return wrap;
  };
  const middle = element("div", "soccer-score");
  middle.append(element("strong", "", status.state === "pre" ? new Date(event.date).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : `${home.score ?? ""} – ${away.score ?? ""}`),
    element("small", status.state === "in" ? "is-live" : "", status.state === "pre" ? new Date(event.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : status.text));
  scoreline.append(side(home), middle, side(away));
  box.append(scoreline, element("p", "politics-meta", [competition.venue?.fullName, (competition.broadcasts || []).flatMap((item) => item.names || []).join(", ")].filter(Boolean).join(" · ")));
  const body = element("div", "soccer-centre-body");
  body.append(element("p", "soccer-muted", status.state === "pre" ? "Loading form and table…" : "Loading timeline, stats and lineups…"));
  box.append(body);
  const homeId = String(home.team?.id || "");
  const awayId = String(away.team?.id || "");
  soccerFetch(`https://site.api.espn.com/apis/site/v2/sports/${league.path}/summary?event=${encodeURIComponent(event.id)}`, status.state === "in" ? 30000 : 300000)
    .then((summary) => {
      const left = element("div", "soccer-centre-main");
      const right = element("div", "soccer-centre-side");
      for (const part of [soccerTimeline(summary, homeId), soccerStatBars(summary, homeId)]) if (part) left.append(part);
      const headerTeams = summary.header?.competitions?.[0]?.competitors || competition.competitors || [];
      const scoreOf = (id) => Number(headerTeams.find((team) => String(team.id ?? team.team?.id) === id)?.score);
      const rated = status.state !== "pre" && (summary.rosters || []).some((roster) => (roster.roster || []).some((player) => (player.stats || []).length));
      const resultFor = (id) => {
        const mine = scoreOf(id);
        const theirs = scoreOf(id === homeId ? awayId : homeId);
        return !Number.isFinite(mine) || !Number.isFinite(theirs) ? "" : mine > theirs ? "W" : mine < theirs ? "L" : "D";
      };
      const contexts = (summary.rosters || []).map((roster) => ({ result: resultFor(String(roster.team?.id || "")), rated }));
      // Player of the match: the highest rating on either side.
      const best = rated ? Math.max(0, ...(summary.rosters || []).flatMap((roster, index) => (roster.roster || []).map((player) => soccerPlayerRating(player, contexts[index].result) ?? 0))) : 0;
      const rosters = (summary.rosters || []).map((roster, index) => ({ roster, context: { ...contexts[index], best } }))
        .sort((a) => (String(a.roster.team?.id) === homeId ? -1 : 1)).map(({ roster, context }) => soccerLineup(roster, context)).filter(Boolean);
      if (rosters.length) {
        const lineups = element("section", "soccer-section");
        lineups.append(element("h5", "", "Lineups"));
        if (rated) lineups.append(element("p", "soccer-muted soccer-rating-note", `${status.state === "in" ? "Live ratings" : "Ratings"} are estimates from ESPN's match stats (goals, assists, shots, saves, goals conceded, cards, fouls and the result); ★ marks the best of the match. Hover over a player for their numbers.`));
        const grid = element("div", "soccer-lineups");
        rosters.forEach((card) => grid.append(card));
        lineups.append(grid);
        left.append(lineups);
      }
      for (const part of [soccerLastFive(summary), soccerMiniTable(summary, [homeId, awayId])]) if (part) right.append(part);
      body.replaceChildren(...[left, right].filter((part) => part.childElementCount));
      if (!body.childElementCount) body.append(element("p", "soccer-muted", "No match details yet."));
    })
    .catch(() => body.replaceChildren(element("p", "soccer-muted", "Match details are unavailable right now.")));
  const href = typeof sportsLeagueGameLink === "function" ? sportsLeagueGameLink(event) : "";
  if (href) {
    const link = element("a", "", "Full match on ESPN ↗");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    box.append(link);
  }
  return box;
}
