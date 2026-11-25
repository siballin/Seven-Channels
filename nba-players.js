// NBA player database (#sports/players, #sports/players/<ESPN id>, #sports/players/records, #sports/players/compare/<id>,<id>)
// built from data/nba/ by scripts/build_nba_players.py (ESPN stats). Loaded on first visit.

const nbaDbCache = new Map();
function nbaDbFetch(path) {
  if (!nbaDbCache.has(path)) {
    nbaDbCache.set(path, fetch(new URL(path, location.href)).then((response) => {
      if (!response.ok) throw new Error(`${path} request failed (${response.status}).`);
      return response.json();
    }).catch((error) => { nbaDbCache.delete(path); throw error; }));
  }
  return nbaDbCache.get(path);
}
// Photos for players ESPN has none for (mostly retired players): NBA.com headshots or Wikimedia Commons photos.
let nbaDbAltHeadshots = {};
const nbaDbIndex = () => Promise.all([
  nbaDbFetch("data/nba/index.json"),
  nbaDbFetch("data/nba/headshots.json").then((data) => { nbaDbAltHeadshots = data.players || {}; }, () => {})
]).then(([index]) => index);
const nbaDbRecords = () => nbaDbFetch("data/nba/records.json");
async function nbaDbPlayer(id) {
  const index = await nbaDbIndex();
  const shard = String(Number(id) % (index.shards || 64)).padStart(2, "0");
  const data = await nbaDbFetch(`data/nba/players/${shard}.json`);
  const player = data.players?.[id];
  if (!player) return null;
  const columns = data.seasonColumns || index.seasonColumns;
  return { ...player, seasons: player.seasons.map((row) => Object.fromEntries(columns.map((name, position) => [name, row[position]]))) };
}

function nbaDbFold(value) {
  return String(value || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function nbaDbFormat(value, digits = 1) {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function nbaDbYears(from, to, active) {
  const season = (year) => `${year - 1}–${String(year).slice(2)}`;
  if (!from) return "";
  return active ? `${season(from)} to now` : from === to ? season(from) : `${from - 1}–${to}`;
}

function nbaDbAge(birth) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth || "")) return null;
  const now = new Date();
  let age = now.getFullYear() - Number(birth.slice(0, 4));
  if (`${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}` < birth.slice(5)) age--;
  return age;
}

function nbaDbHeadshot(id, hasHeadshot, name, className = "nba-db-photo") {
  const initials = (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const fallback = element("span", `${className} nba-db-initials`, initials);
  fallback.setAttribute("aria-hidden", "true");
  const alt = hasHeadshot ? null : nbaDbAltHeadshots[id];
  if ((!hasHeadshot && !alt) || !/^\d+$/.test(String(id))) return fallback;
  const image = element("img", alt?.source === "Wikimedia Commons" ? `${className} is-photo` : className);
  image.src = alt ? alt.src : `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=200&h=146`;
  image.alt = "";
  image.loading = "lazy";
  image.addEventListener("error", () => image.replaceWith(fallback), { once: true });
  return image;
}

function nbaDbNav(active) {
  const nav = element("nav", "nba-db-nav");
  nav.setAttribute("aria-label", "Player database");
  for (const [key, label, href] of [["players", "Players", "#sports/players"], ["records", "All-time leaders", "#sports/players/records"], ["compare", "Compare", "#sports/players/compare"]]) {
    const link = element("a", key === active ? "is-active" : "", label);
    link.href = href;
    if (key === active) link.setAttribute("aria-current", "page");
    nav.append(link);
  }
  const back = element("a", "nba-db-back", "← Sports");
  back.href = "#sports";
  nav.append(back);
  return nav;
}

// ---------- directory ----------

const nbaDbState = { query: "", team: "", pos: "", era: "", status: "", sort: "pts", shown: 60 };
const nbaDbSorts = [["pts", "Career points"], ["ppg", "Points per game"], ["rpg", "Rebounds per game"], ["apg", "Assists per game"],
  ["reb", "Career rebounds"], ["ast", "Career assists"], ["gp", "Games played"], ["to", "Most recent"], ["n", "Name"]];

function nbaDbFilter(index) {
  const state = nbaDbState;
  const words = nbaDbFold(state.query).split(/\s+/).filter(Boolean);
  const decade = Number(state.era) || 0;
  const rows = index.players.filter((row) =>
    (!words.length || words.every((word) => nbaDbFold(`${row.n} ${row.c || ""}`).includes(word))) &&
    (!state.team || (row.t || []).includes(state.team)) &&
    (!state.pos || (row.pos || "").includes(state.pos)) &&
    (!decade || (row.from <= decade + 10 && row.to > decade)) &&
    (!state.status || (state.status === "active" ? row.a : !row.a)));
  const key = state.sort;
  return rows.sort((a, b) => key === "n" ? a.n.localeCompare(b.n) : (b[key] ?? -1) - (a[key] ?? -1) || a.n.localeCompare(b.n));
}

function nbaDbTable(rows) {
  const scroll = element("div", "nba-db-scroll");
  const table = element("table", "nba-db-table");
  const head = element("thead");
  const headRow = element("tr");
  for (const label of ["Player", "Seasons", "Teams", "GP", "PPG", "RPG", "APG", "PTS"]) headRow.append(element("th", "", label));
  head.append(headRow);
  const body = element("tbody");
  for (const row of rows) {
    const tr = element("tr");
    const nameCell = element("th");
    nameCell.scope = "row";
    const link = element("a", "nba-db-player-link");
    link.href = `#sports/players/${row.id}`;
    link.append(nbaDbHeadshot(row.id, row.h, row.n, "nba-db-thumb"));
    const text = element("span");
    text.append(element("strong", "", row.n), element("small", "", [row.pos, row.a ? "Active" : ""].filter(Boolean).join(" · ")));
    link.append(text);
    nameCell.append(link);
    tr.append(nameCell, element("td", "", nbaDbYears(row.from, row.to, row.a)), element("td", "nba-db-teams", (row.t || []).slice(0, 4).join(", ") + ((row.t || []).length > 4 ? "…" : "")),
      element("td", "", nbaDbFormat(row.gp, 0)), element("td", "", nbaDbFormat(row.ppg)), element("td", "", nbaDbFormat(row.rpg)),
      element("td", "", nbaDbFormat(row.apg)), element("td", "", nbaDbFormat(row.pts, 0)));
    body.append(tr);
  }
  table.append(head, body);
  scroll.append(table);
  return scroll;
}

function nbaDbDirectory(container, index) {
  const state = nbaDbState;
  const page = element("section", "nba-db");
  page.setAttribute("aria-labelledby", "nba-db-title");
  const title = element("h2", "", "NBA player database");
  title.id = "nba-db-title";
  const seasons = index.players.reduce((range, row) => [Math.min(range[0], row.from), Math.max(range[1], row.to)], [9999, 0]);
  page.append(nbaDbNav("players"), title, element("p", "nba-db-muted",
    `${index.players.length.toLocaleString()} players with regular-season stats from ${seasons[0] - 1}–${String(seasons[0]).slice(2)} to ${seasons[1] - 1}–${String(seasons[1]).slice(2)}, from ESPN. Updated ${new Date(index.generatedAt).toLocaleDateString()}.`));

  const controls = element("form", "nba-db-controls");
  controls.addEventListener("submit", (event) => event.preventDefault());
  const searchWrap = element("label", "field nba-db-search", "Search");
  const search = element("input");
  search.type = "search";
  search.placeholder = "Player or college";
  search.value = state.query;
  searchWrap.append(search);
  const select = (label, key, options) => {
    const wrap = element("label", "field", label);
    const input = element("select");
    for (const [value, text] of options) {
      const option = element("option", "", text);
      option.value = value;
      option.selected = value === state[key];
      input.append(option);
    }
    input.addEventListener("change", () => { state[key] = input.value; state.shown = 60; draw(); });
    wrap.append(input);
    return wrap;
  };
  const teams = [...new Set(index.players.flatMap((row) => row.t || []))].filter((team) => /^[A-Z]{2,4}$/.test(team)).sort();
  const decades = [...new Set(index.players.map((row) => Math.floor((row.from - 1) / 10) * 10))].sort();
  controls.append(searchWrap,
    select("Team", "team", [["", "Any team"], ...teams.map((team) => [team, team])]),
    select("Position", "pos", [["", "Any"], ["G", "Guard"], ["F", "Forward"], ["C", "Center"]]),
    select("Era", "era", [["", "All eras"], ...decades.map((decade) => [String(decade), `${decade}s`])]),
    select("Status", "status", [["", "Everyone"], ["active", "Active"], ["retired", "Retired"]]),
    select("Sort by", "sort", nbaDbSorts));
  const summary = element("p", "nba-db-muted");
  summary.setAttribute("role", "status");
  const results = element("div");
  const more = element("button", "secondary", "Show more");
  more.type = "button";
  more.addEventListener("click", () => { state.shown += 60; draw(); });
  page.append(controls, summary, results, more);

  function draw() {
    const rows = nbaDbFilter(index);
    summary.textContent = `${rows.length.toLocaleString()} player${rows.length === 1 ? "" : "s"}`;
    results.replaceChildren(nbaDbTable(rows.slice(0, state.shown)));
    more.hidden = rows.length <= state.shown;
  }
  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.query = search.value.trim(); state.shown = 60; draw(); }, 150);
  });
  draw();
  page.append(nbaDbCredit());
  container.replaceChildren(page);
}

function nbaDbCredit() {
  const credit = element("p", "nba-db-muted nba-db-credit", "Regular-season stats and photos from ESPN. Seasons before the 1980s are only included for players who also played later; career totals cover what ESPN lists.");
  return credit;
}

// ---------- player page ----------

const nbaDbChartStats = [["pts", "Points"], ["reb", "Rebounds"], ["ast", "Assists"]];

function nbaDbSeasonChart(seasons) {
  const rows = seasons.filter((row) => row.gp);
  if (rows.length < 2) return null;
  const width = window.innerWidth < 600 ? 380 : 900;
  const height = 220;
  const pad = { left: 34, right: 12, top: 14, bottom: 26 };
  const max = Math.max(5, ...rows.flatMap((row) => nbaDbChartStats.map(([key]) => row[key] || 0)));
  const x = (index) => pad.left + (index / (rows.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - value / max) * (height - pad.top - pad.bottom);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "nba-db-chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Points, rebounds and assists per game by season, ${rows[0].season} to ${rows[rows.length - 1].season}`);
  for (const tick of [0, Math.round(max / 2), Math.round(max)]) {
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", pad.left); line.setAttribute("x2", width - pad.right);
    line.setAttribute("y1", y(tick)); line.setAttribute("y2", y(tick));
    line.setAttribute("class", "nba-db-grid");
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", pad.left - 6); label.setAttribute("y", y(tick) + 4);
    label.setAttribute("text-anchor", "end");
    label.textContent = tick;
    svg.append(line, label);
  }
  for (const index of [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])]) {
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", x(index)); label.setAttribute("y", height - 6);
    label.setAttribute("text-anchor", index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle");
    label.textContent = rows[index].season;
    svg.append(label);
  }
  nbaDbChartStats.forEach(([key], series) => {
    const path = document.createElementNS(ns, "polyline");
    path.setAttribute("points", rows.map((row, index) => `${x(index).toFixed(1)},${y(row[key] || 0).toFixed(1)}`).join(" "));
    path.setAttribute("class", `nba-db-line series-${series}`);
    svg.append(path);
  });
  const figure = element("figure", "nba-db-chart-wrap");
  const legend = element("figcaption", "nba-db-legend");
  nbaDbChartStats.forEach(([, label], series) => {
    const item = element("span", `series-${series}`);
    item.append(element("i"), label);
    legend.append(item);
  });
  figure.append(svg, legend);
  return figure;
}

function nbaDbSeasonTable(seasons, mode) {
  const perGame = mode === "pergame";
  const columns = perGame
    ? [["gp", "GP", 0], ["gs", "GS", 0], ["min", "MIN", 1], ["pts", "PTS", 1], ["reb", "REB", 1], ["ast", "AST", 1], ["stl", "STL", 1], ["blk", "BLK", 1], ["tov", "TO", 1], ["fgp", "FG%", 1], ["fg3p", "3P%", 1], ["ftp", "FT%", 1]]
    : [["gp", "GP", 0], ["tpts", "PTS", 0], ["treb", "REB", 0], ["tast", "AST", 0], ["tstl", "STL", 0], ["tblk", "BLK", 0], ["ttov", "TO", 0], ["fgm", "FGM", 0], ["fga", "FGA", 0], ["fg3m", "3PM", 0], ["ftm", "FTM", 0], ["dd2", "DD", 0], ["td3", "TD", 0]];
  const value = (row, key) => row[key];
  // Career highs among full seasons (or traded totals), per column.
  const counted = seasons.filter((row) => row.team === "TOT" || !seasons.some((other) => other.year === row.year && other.team === "TOT"));
  const best = Object.fromEntries(columns.filter(([key]) => !["tov", "ttov"].includes(key)).map(([key]) => [key, Math.max(...counted.map((row) => value(row, key) ?? -Infinity))]));
  const scroll = element("div", "nba-db-scroll");
  const table = element("table", "nba-db-table nba-db-seasons");
  const head = element("thead");
  const headRow = element("tr");
  for (const label of ["Season", "Team", ...columns.map(([, label]) => label)]) headRow.append(element("th", "", label));
  head.append(headRow);
  const body = element("tbody");
  for (const row of [...seasons].reverse()) {
    const traded = row.team !== "TOT" && seasons.some((other) => other.year === row.year && other.team === "TOT");
    const tr = element("tr", traded ? "is-split" : row.team === "TOT" ? "is-total" : "");
    tr.append(element("th", "", row.season), element("td", "", row.team === "TOT" ? "Total" : row.team));
    for (const [key, , digits] of columns) {
      const cellValue = value(row, key);
      const td = element("td", !traded && cellValue != null && cellValue === best[key] && counted.length > 1 ? "is-best" : "", nbaDbFormat(cellValue, digits));
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(head, body);
  scroll.append(table);
  return scroll;
}

async function nbaDbPlayerPage(container, id) {
  const [player, index, records] = await Promise.all([nbaDbPlayer(id), nbaDbIndex(), nbaDbRecords().catch(() => null)]);
  if (!player) { container.replaceChildren(nbaDbNav(""), element("p", "", "This player isn’t in the database.")); return; }
  const row = index.players.find((item) => item.id === id) || {};
  const page = element("article", "nba-db nba-db-player");
  page.setAttribute("aria-labelledby", "nba-db-player-name");
  page.append(nbaDbNav(""));

  const hero = element("div", "nba-db-hero");
  const photo = nbaDbAltHeadshots[id];
  if (!player.headshot && photo?.source === "Wikimedia Commons") {
    const figure = element("figure", "nba-db-photo-figure");
    const credit = element("figcaption", "nba-db-photo-credit");
    const link = element("a", "", "Wikimedia Commons");
    link.href = photo.page;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const byline = [photo.author, photo.license].filter(Boolean).join(" · ");
    if (!byline) link.textContent = "Wikimedia Commons (photographer and license)";
    credit.append(byline ? `Photo: ${byline} · ` : "Photo: ", link);
    figure.append(nbaDbHeadshot(id, false, player.name, "nba-db-photo-large"), credit);
    hero.append(figure);
  } else {
    hero.append(nbaDbHeadshot(id, Boolean(player.headshot), player.name, "nba-db-photo-large"));
  }
  const text = element("div");
  const name = element("h2", "", player.name);
  name.id = "nba-db-player-name";
  text.append(name);
  const age = nbaDbAge(player.birth);
  text.append(element("p", "nba-db-subtitle", [player.position, player.active && player.team?.name ? player.team.name : player.active ? "Active" : "Retired",
    player.jersey, nbaDbYears(row.from, row.to, player.active)].filter(Boolean).join(" · ")));
  const facts = element("dl", "nba-db-facts");
  for (const [term, value] of [
    ["Born", [player.birth ? new Date(`${player.birth}T12:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "", player.birthplace, age !== null && player.active ? `age ${age}` : ""].filter(Boolean).join(" · ")],
    ["Height / weight", [player.height, player.weight].filter(Boolean).join(", ")],
    ["College", player.college],
    ["Draft", player.draft ? `${player.draft.year}, round ${player.draft.round}, pick ${player.draft.pick} (${player.draft.team})` : player.debut ? "Undrafted" : ""],
    ["Teams", (row.t || []).join(", ")],
  ]) {
    if (!value) continue;
    facts.append(element("dt", "", term), element("dd", "", value));
  }
  text.append(facts);
  const actions = element("div", "nba-db-actions");
  const compare = element("a", "button-link", "Compare");
  compare.href = `#sports/players/compare/${id}`;
  const espn = element("a", "", "ESPN profile");
  espn.href = `https://www.espn.com/nba/player/_/id/${id}`;
  espn.target = "_blank";
  espn.rel = "noopener noreferrer";
  actions.append(compare, espn);
  text.append(actions);
  hero.append(text);
  page.append(hero);

  const career = player.career || {};
  const tiles = element("div", "nba-db-tiles");
  for (const [label, value, digits] of [["PPG", career.pts, 1], ["RPG", career.reb, 1], ["APG", career.ast, 1], ["SPG", career.stl, 1], ["BPG", career.blk, 1],
    ["FG%", career.fgp, 1], ["3P%", career.fg3p, 1], ["FT%", career.ftp, 1], ["Games", career.gp, 0], ["Points", career.totals?.pts, 0]]) {
    const tile = element("div", "nba-db-tile");
    tile.append(element("strong", "", nbaDbFormat(value, digits)), element("span", "", label));
    tiles.append(tile);
  }
  page.append(element("h3", "", "Career (regular season)"), tiles);

  // Where they rank all-time in this database.
  const ranks = [];
  for (const [key, label] of [["pts", "points"], ["reb", "rebounds"], ["ast", "assists"], ["stl", "steals"], ["blk", "blocks"]]) {
    if (!row[key]) continue;
    const rank = index.players.filter((other) => (other[key] || 0) > row[key]).length + 1;
    if (rank <= 100) ranks.push(`#${rank} in career ${label}`);
  }
  for (const [stat, label] of [["pts", "points"], ["reb", "rebounds"], ["ast", "assists"]]) {
    const position = (records?.season?.[stat] || []).findIndex((item) => item[0] === id);
    if (position >= 0 && position < 100) ranks.push(`#${position + 1} single-season ${label} per game (${records.season[stat][position][2]})`);
  }
  if (ranks.length) page.append(element("p", "nba-db-ranks", `All-time in this database: ${ranks.join(" · ")}`));

  const chart = nbaDbSeasonChart(player.seasons.filter((season) => season.team === "TOT" || !player.seasons.some((other) => other.year === season.year && other.team === "TOT")));
  if (chart) page.append(chart);

  const tableHead = element("div", "nba-db-table-head");
  tableHead.append(element("h3", "", "Season by season"));
  const toggle = element("div", "nba-db-toggle");
  const tableWrap = element("div");
  for (const [mode, label] of [["pergame", "Per game"], ["totals", "Totals"]]) {
    const button = element("button", mode === "pergame" ? "" : "secondary", label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(mode === "pergame"));
    button.addEventListener("click", () => {
      toggle.querySelectorAll("button").forEach((other) => { other.className = other === button ? "" : "secondary"; other.setAttribute("aria-pressed", String(other === button)); });
      tableWrap.replaceChildren(nbaDbSeasonTable(player.seasons, mode));
    });
    toggle.append(button);
  }
  tableHead.append(toggle);
  tableWrap.append(nbaDbSeasonTable(player.seasons, "pergame"));
  page.append(tableHead, tableWrap, element("p", "nba-db-muted", "Highlighted: career highs. Traded seasons show each team, then the total."), nbaDbCredit());
  container.replaceChildren(page);
}

// ---------- records ----------

async function nbaDbRecordsPage(container) {
  const [records, index] = await Promise.all([nbaDbRecords(), nbaDbIndex()]);
  const page = element("section", "nba-db");
  page.setAttribute("aria-labelledby", "nba-db-records-title");
  const title = element("h2", "", "All-time leaders");
  title.id = "nba-db-records-title";
  page.append(nbaDbNav("records"), title, element("p", "nba-db-muted", "Regular season, from the players in this database. Career averages need 400 games; single seasons need 58 games."));
  const byId = new Map(index.players.map((row) => [row.id, row]));
  const groups = [
    ["Career totals", "career", [["pts", "Points"], ["reb", "Rebounds"], ["ast", "Assists"], ["stl", "Steals"], ["blk", "Blocks"], ["td3", "Triple-doubles"]], 0],
    ["Career per game", "careerAverage", [["ppg", "Points"], ["rpg", "Rebounds"], ["apg", "Assists"], ["spg", "Steals"], ["bpg", "Blocks"]], 1],
    ["Single season per game", "season", [["pts", "Points"], ["reb", "Rebounds"], ["ast", "Assists"], ["stl", "Steals"], ["blk", "Blocks"]], 1],
  ];
  for (const [heading, key, stats, digits] of groups) {
    const section = element("section", "nba-db-record-group");
    section.append(element("h3", "", heading));
    const grid = element("div", "nba-db-record-grid");
    for (const [stat, label] of stats) {
      const list = records[key]?.[stat] || [];
      if (!list.length) continue;
      const card = element("div", "nba-db-record");
      card.append(element("h4", "", label));
      const ol = element("ol");
      for (const item of list.slice(0, 10)) {
        const li = element("li");
        const link = element("a", "", item[1]);
        link.href = `#sports/players/${item[0]}`;
        const extra = key === "season" ? ` ${item[2]} ${item[3]}` : byId.get(item[0])?.a ? " · active" : "";
        li.append(link, element("small", "", extra), element("strong", "", nbaDbFormat(item[item.length - 1], digits)));
        ol.append(li);
      }
      card.append(ol);
      grid.append(card);
    }
    section.append(grid);
    page.append(section);
  }
  page.append(nbaDbCredit());
  container.replaceChildren(page);
}

// ---------- compare ----------

async function nbaDbComparePage(container, ids) {
  const index = await nbaDbIndex();
  const players = (await Promise.all(ids.slice(0, 3).map((id) => nbaDbPlayer(id)))).filter(Boolean);
  const page = element("section", "nba-db");
  page.setAttribute("aria-labelledby", "nba-db-compare-title");
  const title = element("h2", "", "Compare players");
  title.id = "nba-db-compare-title";
  page.append(nbaDbNav("compare"), title);

  // Add a player (up to three).
  if (players.length < 3) {
    const picker = element("div", "nba-db-picker");
    const label = element("label", "field", players.length ? "Add a player" : "Pick a player");
    const input = element("input");
    input.type = "search";
    input.placeholder = "Search players";
    label.append(input);
    const suggestions = element("ul", "nba-db-suggestions");
    input.addEventListener("input", () => {
      const words = nbaDbFold(input.value).split(/\s+/).filter(Boolean);
      suggestions.replaceChildren();
      if (!words.length) return;
      for (const row of index.players.filter((item) => words.every((word) => nbaDbFold(item.n).includes(word)) && !ids.includes(item.id)).slice(0, 8)) {
        const li = element("li");
        const link = element("a", "", `${row.n} (${nbaDbYears(row.from, row.to, row.a)})`);
        link.href = `#sports/players/compare/${[...players.map((player) => player.id), row.id].join(",")}`;
        li.append(link);
        suggestions.append(li);
      }
    });
    picker.append(label, suggestions);
    page.append(picker);
  }
  if (!players.length) { page.append(nbaDbCredit()); container.replaceChildren(page); return; }

  const scroll = element("div", "nba-db-scroll");
  const table = element("table", "nba-db-table nba-db-compare");
  const head = element("thead");
  const headRow = element("tr");
  headRow.append(element("th", "", ""));
  for (const player of players) {
    const th = element("th");
    const link = element("a", "nba-db-player-link");
    link.href = `#sports/players/${player.id}`;
    link.append(nbaDbHeadshot(player.id, Boolean(player.headshot), player.name, "nba-db-thumb"), element("strong", "", player.name));
    const remove = element("a", "nba-db-remove", "Remove");
    remove.href = `#sports/players/compare/${players.filter((other) => other !== player).map((other) => other.id).join(",")}`;
    th.append(link, remove);
    headRow.append(th);
  }
  head.append(headRow);
  const body = element("tbody");
  const rowsFor = players.map((player) => index.players.find((row) => row.id === player.id) || {});
  const lines = [
    ["Seasons", (player, row) => nbaDbYears(row.from, row.to, player.active), null],
    ["Games", (player) => player.career?.gp, 0], ["Points per game", (player) => player.career?.pts, 1], ["Rebounds per game", (player) => player.career?.reb, 1],
    ["Assists per game", (player) => player.career?.ast, 1], ["Steals per game", (player) => player.career?.stl, 1], ["Blocks per game", (player) => player.career?.blk, 1],
    ["FG%", (player) => player.career?.fgp, 1], ["3P%", (player) => player.career?.fg3p, 1], ["FT%", (player) => player.career?.ftp, 1],
    ["Career points", (player) => player.career?.totals?.pts, 0], ["Career rebounds", (player) => player.career?.totals?.reb, 0], ["Career assists", (player) => player.career?.totals?.ast, 0],
    ["Triple-doubles", (player) => player.career?.totals?.td3, 0],
    ["Best season (PPG)", (player) => Math.max(...player.seasons.map((season) => season.pts || 0)), 1],
  ];
  for (const [label, read, digits] of lines) {
    const tr = element("tr");
    tr.append(element("th", "", label));
    const values = players.map((player, position) => read(player, rowsFor[position]));
    const numeric = digits !== null && values.filter((value) => typeof value === "number");
    const top = numeric && numeric.length > 1 ? Math.max(...numeric) : null;
    values.forEach((value) => tr.append(element("td", top !== null && value === top ? "is-best" : "", digits === null ? value || "—" : nbaDbFormat(value, digits))));
    body.append(tr);
  }
  table.append(head, body);
  scroll.append(table);
  page.append(scroll);

  // Points per game by season of career (1st season, 2nd season…), one line each.
  if (players.length > 1) {
    const series = players.map((player) => player.seasons.filter((season) => season.team === "TOT" || !player.seasons.some((other) => other.year === season.year && other.team === "TOT")));
    const longest = Math.max(...series.map((list) => list.length));
    if (longest > 1) {
      const width = window.innerWidth < 600 ? 380 : 900;
      const height = 220;
      const pad = { left: 34, right: 12, top: 14, bottom: 26 };
      const max = Math.max(5, ...series.flat().map((season) => season.pts || 0));
      const x = (index) => pad.left + (index / (longest - 1)) * (width - pad.left - pad.right);
      const y = (value) => pad.top + (1 - value / max) * (height - pad.top - pad.bottom);
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute("class", "nba-db-chart");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Points per game by season of career");
      for (const tick of [0, Math.round(max / 2), Math.round(max)]) {
        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", pad.left); line.setAttribute("x2", width - pad.right); line.setAttribute("y1", y(tick)); line.setAttribute("y2", y(tick));
        line.setAttribute("class", "nba-db-grid");
        const text = document.createElementNS(ns, "text");
        text.setAttribute("x", pad.left - 6); text.setAttribute("y", y(tick) + 4); text.setAttribute("text-anchor", "end"); text.textContent = tick;
        svg.append(line, text);
      }
      for (const index of [0, longest - 1]) {
        const text = document.createElementNS(ns, "text");
        text.setAttribute("x", x(index)); text.setAttribute("y", height - 6); text.setAttribute("text-anchor", index ? "end" : "start");
        text.textContent = `Season ${index + 1}`;
        svg.append(text);
      }
      series.forEach((list, position) => {
        const path = document.createElementNS(ns, "polyline");
        path.setAttribute("points", list.map((season, index) => `${x(index).toFixed(1)},${y(season.pts || 0).toFixed(1)}`).join(" "));
        path.setAttribute("class", `nba-db-line series-${position}`);
        svg.append(path);
      });
      const figure = element("figure", "nba-db-chart-wrap");
      const legend = element("figcaption", "nba-db-legend");
      players.forEach((player, position) => {
        const item = element("span", `series-${position}`);
        item.append(element("i"), player.name);
        legend.append(item);
      });
      figure.append(element("h3", "", "Points per game by season of career"), svg, legend);
      page.append(figure);
    }
  }
  page.append(nbaDbCredit());
  container.replaceChildren(page);
}

async function nbaDbRender(container, route) {
  container.replaceChildren(element("p", "nba-db-muted", "Loading the player database…"));
  try {
    const player = /^(\d+)$/.exec(route);
    const compare = /^compare(?:\/([\d,]*))?$/.exec(route);
    if (player) await nbaDbPlayerPage(container, player[1]);
    else if (route === "records") await nbaDbRecordsPage(container);
    else if (compare) await nbaDbComparePage(container, (compare[1] || "").split(",").filter((id) => /^\d+$/.test(id)));
    else nbaDbDirectory(container, await nbaDbIndex());
  } catch (error) {
    console.error("Could not load the NBA player database.", error);
    container.replaceChildren(element("p", "", "The player database couldn’t load. The data may not be published yet; try again later."));
  }
}

function createNbaPlayersView(route) {
  const container = element("div", "nba-db-view");
  nbaDbRender(container, route);
  return container;
}
