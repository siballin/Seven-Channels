// ESPN's stable team IDs are used independently of display names and route slugs.
const nbaTeamRoutes = [
  ["1", "atlanta-hawks"], ["2", "boston-celtics"], ["17", "brooklyn-nets"],
  ["30", "charlotte-hornets"], ["4", "chicago-bulls"], ["5", "cleveland-cavaliers"],
  ["6", "dallas-mavericks"], ["7", "denver-nuggets"], ["8", "detroit-pistons"],
  ["9", "golden-state-warriors"], ["10", "houston-rockets"], ["11", "indiana-pacers"],
  ["12", "la-clippers"], ["13", "los-angeles-lakers"], ["29", "memphis-grizzlies"],
  ["14", "miami-heat"], ["15", "milwaukee-bucks"], ["16", "minnesota-timberwolves"],
  ["3", "new-orleans-pelicans"], ["18", "new-york-knicks"], ["25", "oklahoma-city-thunder"],
  ["19", "orlando-magic"], ["20", "philadelphia-76ers"], ["21", "phoenix-suns"],
  ["22", "portland-trail-blazers"], ["23", "sacramento-kings"], ["24", "san-antonio-spurs"],
  ["28", "toronto-raptors"], ["26", "utah-jazz"], ["27", "washington-wizards"]
];
const nbaTeamSlugs = new Map(nbaTeamRoutes);
const nbaTeamIds = new Map(nbaTeamRoutes.map(([id, slug]) => [slug, id]));
const nbaHubCache = new Map();
const nbaHubPending = new WeakMap();
let nbaHubController;

function nbaTeamLink(team, text, className = "") {
  const slug = nbaTeamSlugs.get(String(team?.id || ""));
  if (!slug) return element("span", className, text || team?.displayName || "Team");
  const link = element("a", className, text || team?.displayName || "Team");
  link.href = `#sports/nba/teams/${slug}`;
  return link;
}

async function nbaHubFetch(url, signal) {
  const cached = nbaHubCache.get(url);
  if (cached && Date.now() - cached.time < 300000) return cached.data;
  let pending = nbaHubPending.get(signal);
  if (!pending) {
    pending = new Map();
    nbaHubPending.set(signal, pending);
  }
  if (!pending.has(url)) {
    const request = (async () => {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`NBA data request failed (${response.status}).`);
      const data = await response.json();
      if (nbaHubCache.size >= 300) nbaHubCache.delete(nbaHubCache.keys().next().value);
      nbaHubCache.set(url, { data, time: Date.now() });
      return data;
    })().finally(() => pending.delete(url));
    pending.set(url, request);
  }
  return pending.get(url);
}

function createNbaTeamPage(slug) {
  nbaHubController?.abort();
  nbaHubController = new AbortController();
  const { signal } = nbaHubController;
  const root = element("section", "nba-team-hub");
  const back = element("a", "nba-data-back", "← Back to NBA Scores");
  back.href = "#sports";
  root.append(back);
  const id = nbaTeamIds.get(slug);
  if (!id) {
    root.append(element("p", "nba-data-state error", "NBA team not found. Return to Sports and choose a team."));
    return root;
  }
  const content = element("div", "nba-team-hub-content");
  content.append(element("p", "nba-data-state", "Loading team information…"));
  root.append(content);
  const base = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
  const api = (path) => nbaHubFetch(`${base}${path}`, signal);
  const standingsUrl = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings";
  const tabs = [
    ["overview", "Overview"], ["roster", "Roster"], ["stats", "Stats"],
    ["schedule", "Schedule"], ["news", "News"], ["depth", "Depth Chart"]
  ];
  let activeTab = "overview";
  let tabRequest = 0;
  let teamEntry;
  let conference;
  let season;

  function section(title) {
    const node = element("section", "nba-team-hub-card");
    node.append(element("h3", "", title));
    return node;
  }

  function empty(node, text) {
    node.append(element("p", "nba-team-hub-note", text));
  }

  function gameLink(event, text = "View game") {
    const link = element("a", "", text);
    const date = new Date(event.date);
    if (!event.id || Number.isNaN(date.getTime())) return element("span", "", "Game details unavailable");
    link.href = `#sports/nba/games/${localDateValue(date)}/${encodeURIComponent(String(event.id))}`;
    return link;
  }

  function gameRow(event) {
    const competition = event.competitions?.[0];
    const opponents = competition?.competitors || [];
    const own = opponents.find((item) => String(item.team?.id) === id);
    const opponent = opponents.find((item) => String(item.team?.id) !== id);
    const row = element("li", "nba-team-hub-game");
    const date = new Date(event.date);
    const time = Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    });
    const opponentText = opponent?.team?.displayName || "Opponent unavailable";
    const opponentLink = nbaTeamLink(opponent?.team, opponentText);
    const title = element("div", "nba-team-hub-game-title");
    title.append(element("span", "", own?.homeAway === "home" ? "vs" : "at"), opponentLink);
    const state = competition?.status?.type?.state;
    const status = competition?.status?.type?.shortDetail || competition?.status?.type?.description || "Status unavailable";
    const score = state !== "pre" && own?.score != null && opponent?.score != null
      ? ` · ${own.score?.displayValue ?? own.score}–${opponent.score?.displayValue ?? opponent.score}` : "";
    row.append(title, element("small", "", `${time} · ${status}${score}`), gameLink(event));
    return row;
  }

  function gameList(events) {
    const list = element("ul", "nba-team-hub-list");
    for (const event of events) list.append(gameRow(event));
    return list;
  }

  function performanceChart(events) {
    const box = section("Recent scoring");
    const games = events.flatMap((event) => {
      const competitors = event.competitions?.[0]?.competitors || [];
      const own = competitors.find((item) => String(item.team?.id) === id);
      const opponent = competitors.find((item) => String(item.team?.id) !== id);
      const score = (team) => {
        const value = team?.score?.value ?? team?.score?.displayValue ?? team?.score;
        if (value == null || value === "") return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
      };
      const scored = score(own), allowed = score(opponent);
      return scored == null || allowed == null || !event.date ? [] : [{ event, scored, allowed }];
    });
    if (!games.length) {
      empty(box, "Game scoring history is unavailable.");
      return box;
    }
    empty(box, "Points scored and allowed in the last five completed games, oldest to newest. Open the data table for exact values.");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 400 180");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Points scored and points allowed by game");
    svg.classList.add("nba-team-hub-chart");
    const values = games.flatMap((game) => [game.scored, game.allowed]);
    const min = Math.max(0, Math.floor(Math.min(...values) / 10) * 10 - 10);
    const max = Math.ceil(Math.max(...values) / 10) * 10 + 10;
    const x = (index) => games.length === 1 ? 210 : 45 + index * 330 / (games.length - 1);
    const y = (value) => 145 - (value - min) / (max - min) * 115;
    for (const tick of [min, (min + max) / 2, max]) {
      const text = document.createElementNS(svg.namespaceURI, "text");
      text.setAttribute("x", "4");
      text.setAttribute("y", String(y(tick) + 4));
      text.textContent = String(Math.round(tick));
      svg.append(text);
    }
    for (const [key, className] of [["scored", "nba-chart-scored"], ["allowed", "nba-chart-allowed"]]) {
      const line = document.createElementNS(svg.namespaceURI, "polyline");
      line.setAttribute("points", games.map((game, index) => `${x(index)},${y(game[key])}`).join(" "));
      line.setAttribute("class", className);
      svg.append(line);
      games.forEach((game, index) => {
        const point = document.createElementNS(svg.namespaceURI, "circle");
        point.setAttribute("cx", String(x(index)));
        point.setAttribute("cy", String(y(game[key])));
        point.setAttribute("r", "4");
        point.setAttribute("class", className);
        const title = document.createElementNS(svg.namespaceURI, "title");
        title.textContent = `${new Date(game.event.date).toLocaleDateString()}: ${key === "scored" ? "Scored" : "Allowed"} ${game[key]}`;
        point.append(title);
        svg.append(point);
      });
    }
    games.forEach((game, index) => {
      const text = document.createElementNS(svg.namespaceURI, "text");
      text.setAttribute("x", String(x(index)));
      text.setAttribute("y", "167");
      text.setAttribute("text-anchor", "middle");
      text.textContent = new Date(game.event.date).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
      svg.append(text);
    });
    const details = document.createElement("details");
    details.append(element("summary", "", "View scoring data"));
    const list = element("ul", "nba-team-hub-list");
    for (const game of games) {
      const row = element("li");
      row.append(gameLink(game.event, `${new Date(game.event.date).toLocaleDateString()} · Scored ${game.scored}, allowed ${game.allowed} · Differential ${game.scored - game.allowed > 0 ? "+" : ""}${game.scored - game.allowed}`));
      list.append(row);
    }
    details.append(list);
    box.append(svg, element("p", "nba-team-hub-note", "Solid: points scored · Dashed: points allowed"), details);
    return box;
  }

  function statsMap(data) {
    return new Map((data.results?.stats?.categories || []).flatMap((category) => category.stats || [])
      .map((stat) => [stat.name, stat]));
  }

  function standingsStats(entry) {
    return new Map((entry?.stats || []).map((stat) => [stat.name, stat.displayValue]));
  }

  async function loadRosterAverages(athletes, isActive, onUpdate) {
    let next = 0;
    let failed = 0;
    const values = new Map();
    const workers = Array.from({ length: Math.min(4, athletes.length) }, async () => {
      while (next < athletes.length && !signal.aborted && isActive()) {
        const athlete = athletes[next++];
        if (!athlete.id) continue;
        try {
          const url = `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${encodeURIComponent(athlete.id)}/stats?region=us&lang=en&contentorigin=espn`;
          const data = await nbaHubFetch(url, signal);
          const averages = data.categories?.find((category) => category.name === "averages");
          if (!Array.isArray(averages?.labels) || !Array.isArray(averages?.statistics)) throw new TypeError("Player averages are incomplete.");
          const rows = averages.statistics.filter((row) => row.season?.year === season && Array.isArray(row.stats));
          const row = rows.find((item) => String(item.teamId) === "0") ||
            rows.find((item) => String(item.teamId) === id) || (rows.length === 1 ? rows[0] : null);
          if (row) {
            const result = new Map(averages.labels.map((label, index) => [String(label).toUpperCase(), row.stats[index]]));
            values.set(String(athlete.id), result);
          }
        } catch (error) {
          if (signal.aborted) return;
          console.error(`Could not load season averages for ${athlete.displayName}.`, error);
          failed++;
        }
      }
    });
    await Promise.all(workers);
    if (!signal.aborted) onUpdate(values, failed);
  }

  function addHero(teamData) {
    const team = teamData.team || teamEntry.team;
    const hero = element("header", "nba-team-hub-hero");
    if (/^[0-9a-f]{6}$/i.test(team.color || "")) hero.style.setProperty("--team-color", `#${team.color}`);
    const logoUrl = team.logo || teamEntry.team?.logos?.[0]?.href;
    if (logoUrl) {
      const logo = document.createElement("img");
      logo.src = logoUrl;
      logo.alt = "";
      logo.addEventListener("error", () => logo.remove(), { once: true });
      hero.append(logo);
    }
    const copy = element("div");
    copy.append(element("h2", "", team.displayName || teamEntry.team?.displayName || "NBA Team"));
    const stats = standingsStats(teamEntry);
    const record = stats.get("overall") || team.recordSummary || "Record unavailable";
    copy.append(element("p", "", `${conference.name} · ${team.standingSummary || "Division unavailable"} · ${record}`));
    copy.append(element("p", "", `Win % ${stats.get("winPercent") || "—"} · Last 10 ${stats.get("Last Ten Games") || "—"} · Streak ${stats.get("streak") || "—"} · Home ${stats.get("Home") || "—"} · Away ${stats.get("Road") || "—"}`));
    hero.append(copy);
    return hero;
  }

  async function loadHeroStats(container) {
    try {
      const data = await api(`/teams/${id}/statistics?season=${encodeURIComponent(season)}&seasontype=2`);
      if (data.season?.year !== season || data.season?.type !== 2 || !Array.isArray(data.results?.stats?.categories)) throw new TypeError("Team season statistics are unavailable.");
      if (signal.aborted || !container.isConnected) return;
      const stats = statsMap(data);
      const number = (key) => {
        const value = stats.get(key)?.value;
        return typeof value === "number" && Number.isFinite(value) ? value : null;
      };
      const fgm = number("fieldGoalsMade"), fga = number("fieldGoalsAttempted");
      const threes = number("threePointFieldGoalsMade"), fta = number("freeThrowsAttempted"), points = number("points");
      const efg = fgm != null && threes != null && fga > 0 ? `${((fgm + 0.5 * threes) / fga * 100).toFixed(1)}%` : "—";
      const ts = points != null && fga != null && fta != null && fga + 0.44 * fta > 0
        ? `${(points / (2 * (fga + 0.44 * fta)) * 100).toFixed(1)}%` : "—";
      const values = [
        ["Points/game", stats.get("avgPoints")?.displayValue ?? "—"], ["Offensive rating", "Unavailable"],
        ["Defensive rating", "Unavailable"], ["Net rating", "Unavailable"], ["Pace", "Unavailable"],
        ["eFG%", efg], ["TS%", ts]
      ];
      container.dataset.state = "ready";
      container.replaceChildren(...values.map(([label, value]) => {
        const card = element("div", "nba-team-hub-metric");
        card.append(element("strong", "", value), element("small", "", label));
        return card;
      }));
    } catch (error) {
      if (signal.aborted) return;
      console.error("Could not load team headline statistics.", error);
      container.dataset.state = "error";
      const message = element("div");
      message.append(element("p", "nba-team-hub-note", "Team season statistics are unavailable."));
      const retry = element("button", "secondary", "Retry headline statistics");
      retry.type = "button";
      retry.addEventListener("click", () => loadHeroStats(container));
      message.append(retry);
      container.replaceChildren(message);
    }
  }

  async function renderTab(panel, name) {
    const current = ++tabRequest;
    panel.replaceChildren(element("p", "nba-data-state", `Loading ${name}…`));
    try {
      if (name === "overview" || name === "schedule") {
        const data = await api(`/teams/${id}/schedule`);
        if (!Array.isArray(data.events)) throw new TypeError("Team schedule is incomplete.");
        if (current !== tabRequest || signal.aborted) return;
        const events = [...data.events].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
        if (name === "schedule") {
          const box = section("Schedule and results");
          const filters = element("div", "nba-team-hub-filters");
          const month = document.createElement("select");
          month.setAttribute("aria-label", "Schedule month");
          const all = element("option", "", "All months");
          all.value = "";
          month.append(all);
          const months = [...new Set(events.map((event) => event.date?.slice(0, 7)).filter(Boolean))];
          for (const value of months) {
            const option = element("option", "", new Date(`${value}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" }));
            option.value = value;
            month.append(option);
          }
          const filter = document.createElement("select");
          filter.setAttribute("aria-label", "Schedule status");
          for (const [value, text] of [["all", "All games"], ["upcoming", "Upcoming and live"], ["completed", "Completed"]]) {
            const option = element("option", "", text);
            option.value = value;
            filter.append(option);
          }
          const results = element("div");
          function draw() {
            const matching = events.filter((event) => {
              const state = event.competitions?.[0]?.status?.type?.state;
              return (!month.value || event.date?.startsWith(month.value)) &&
                (filter.value === "all" || (filter.value === "completed" ? state === "post" : state === "pre" || state === "in"));
            });
            results.replaceChildren();
            if (matching.length) results.append(gameList(matching));
            else empty(results, "No games match these filters.");
          }
          month.addEventListener("change", draw);
          filter.addEventListener("change", draw);
          filters.append(month, filter);
          box.append(filters, results);
          draw();
          panel.replaceChildren(box);
          return;
        }
        const columns = element("div", "nba-team-hub-overview");
        const next = section("Upcoming games");
        const upcoming = events.filter((event) => {
          const state = event.competitions?.[0]?.status?.type?.state;
          return state === "in" || (state === "pre" && Date.parse(event.date) >= Date.now());
        }).slice(0, 3);
        if (upcoming.length) next.append(gameList(upcoming));
        else empty(next, "No upcoming games are available.");
        const recent = section("Recent results");
        const completed = events.filter((event) => event.competitions?.[0]?.status?.type?.state === "post").slice(-5).reverse();
        if (completed.length) recent.append(gameList(completed));
        else empty(recent, "No recent results are available.");
        const position = section("Conference standings");
        const seedFor = (entry) => {
          const value = entry.stats?.find((stat) => stat.name === "playoffSeed")?.value;
          return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
        };
        const ordered = [...conference.standings.entries].sort((a, b) => {
          const seedA = seedFor(a), seedB = seedFor(b);
          if (seedA != null && seedB != null) return seedA - seedB;
          if (seedA != null || seedB != null) return seedA != null ? -1 : 1;
          const pct = (entry) => {
            const value = entry.stats?.find((stat) => stat.name === "winPercent")?.value;
            return typeof value === "number" && Number.isFinite(value) ? value : -1;
          };
          return pct(b) - pct(a) || (a.team?.displayName || "").localeCompare(b.team?.displayName || "");
        });
        empty(position, `${conference.name} · ESPN standings${ordered.some((entry) => seedFor(entry) == null) ? "; unranked teams follow by win percentage." : "."}`);
        const table = element("table", "nba-team-conference-table");
        const head = document.createElement("thead");
        const header = document.createElement("tr");
        for (const [label, description] of [["#", "Conference position"], ["Team", "Team"], ["W", "Wins"], ["L", "Losses"]]) {
          const cell = element("th", "", label);
          cell.scope = "col";
          cell.title = description;
          header.append(cell);
        }
        head.append(header);
        const body = document.createElement("tbody");
        for (const entry of ordered) {
          const stats = standingsStats(entry);
          const selected = String(entry.team?.id) === id;
          const row = element("tr", selected ? "nba-team-conference-current" : "");
          const teamCell = document.createElement("th");
          teamCell.scope = "row";
          const link = nbaTeamLink(entry.team, entry.team?.displayName || entry.team?.abbreviation || "Team", "nba-team-conference-link");
          link.setAttribute("aria-label", `${entry.team?.displayName || "Team"}${selected ? " (current team)" : ""}`);
          if (selected && link.tagName === "A") link.setAttribute("aria-current", "page");
          const logoUrl = entry.team?.logos?.[0]?.href || entry.team?.logo;
          if (logoUrl) {
            const logo = document.createElement("img");
            logo.src = logoUrl;
            logo.alt = "";
            logo.loading = "lazy";
            logo.addEventListener("error", () => logo.remove(), { once: true });
            link.prepend(logo);
          }
          teamCell.append(link);
          row.append(element("td", "", seedFor(entry) ?? "—"), teamCell,
            element("td", "", stats.get("wins") ?? "—"), element("td", "", stats.get("losses") ?? "—"));
          body.append(row);
        }
        table.append(head, body);
        position.append(table);
        const full = element("a", "", "View conference standings");
        full.href = "#sports-standings";
        position.append(full);
        const injuries = section("Injury report");
        empty(injuries, "Loading roster injury information…");
        const matchup = section("Next opponent");
        empty(matchup, "Loading matchup information…");
        const headlines = section("Team news");
        empty(headlines, "Loading team news…");
        columns.append(next, recent, position, performanceChart([...completed].reverse()), injuries, matchup, headlines);
        panel.replaceChildren(columns);
        api(`/teams/${id}/roster`).then((roster) => {
          if (current !== tabRequest || signal.aborted) return;
          if (!Array.isArray(roster.athletes)) throw new TypeError("Roster injury data is incomplete.");
          const players = roster.athletes.flatMap((item) => Array.isArray(item.items) ? item.items : [item]);
          const reports = players.flatMap((athlete) => (athlete.injuries || []).filter((injury) => injury.status).map((injury) => ({ athlete, injury })));
          injuries.replaceChildren(element("h3", "", "Injury report"));
          if (!reports.length) empty(injuries, "No injury reports are available in the team roster feed.");
          else {
            const list = element("ul", "nba-team-hub-roster");
            reports.forEach(({ athlete }) => list.append(playerCard(athlete)));
            injuries.append(list);
          }
        }).catch((error) => {
          if (signal.aborted || current !== tabRequest) return;
          console.error("Could not load team injuries.", error);
          injuries.replaceChildren(element("h3", "", "Injury report"), element("p", "nba-team-hub-note", "Injury information is unavailable."));
        });
        const opponent = upcoming[0]?.competitions?.[0]?.competitors?.find((item) => String(item.team?.id) !== id);
        if (!opponent?.team?.id) {
          matchup.replaceChildren(element("h3", "", "Next opponent"), element("p", "nba-team-hub-note", "No upcoming opponent is available."));
        } else {
          matchup.replaceChildren(element("h3", "", "Next opponent"));
          const teamLink = nbaTeamLink(opponent.team, opponent.team.displayName, "nba-team-matchup-team");
          const logoUrl = opponent.team.logos?.[0]?.href || opponent.team.logo;
          if (logoUrl) {
            const logo = document.createElement("img");
            logo.src = logoUrl;
            logo.alt = "";
            logo.addEventListener("error", () => logo.remove(), { once: true });
            teamLink.prepend(logo);
          }
          const featured = element("div");
          empty(featured, "Loading opponent's scoring leader…");
          const comparison = element("div");
          empty(comparison, "Loading matchup statistics…");
          matchup.append(teamLink, featured, comparison);
          api(`/summary?event=${encodeURIComponent(upcoming[0].id)}`).then((summary) => {
            if (current !== tabRequest || signal.aborted) return;
            if (!Array.isArray(summary.leaders)) throw new TypeError("Game leaders are unavailable.");
            const leaders = summary.leaders.find((item) => String(item.team?.id) === String(opponent.team.id))?.leaders;
            const category = leaders?.find((item) => item.name === "pointsPerGame" && item.leaders?.[0]?.athlete) ||
              leaders?.find((item) => item.name === "points" && item.leaders?.[0]?.athlete);
            const leader = category?.leaders?.[0];
            const athlete = leader?.athlete;
            featured.replaceChildren();
            if (!athlete?.id || !(athlete.displayName || athlete.fullName)) {
              empty(featured, "Opponent scoring leader is unavailable.");
              return;
            }
            const player = element("div", "nba-team-matchup-player");
            const copy = element("div");
            const name = element("button", "nba-team-hub-player-link", athlete.displayName || athlete.fullName);
            name.type = "button";
            name.addEventListener("click", () => openPlayerProfile(String(athlete.id)));
            copy.append(element("small", "", category.name === "pointsPerGame" ? "Scoring leader · season" : "Scoring leader · game"), name);
            if (leader.displayValue) copy.append(element("small", "", `${leader.displayValue} ${category.name === "pointsPerGame" ? "PPG" : "points"}`));
            player.append(createPlayerPortrait(athlete, athlete.position?.abbreviation || "NBA"), copy);
            featured.append(player);
          }).catch((error) => {
            if (signal.aborted || current !== tabRequest) return;
            console.error("Could not load opponent scoring leader.", error);
            featured.replaceChildren(element("p", "nba-team-hub-note", "Opponent scoring leader is unavailable."));
          });
          Promise.all([
            api(`/teams/${id}/statistics?season=${encodeURIComponent(season)}&seasontype=2`),
            api(`/teams/${encodeURIComponent(opponent.team.id)}/statistics?season=${encodeURIComponent(season)}&seasontype=2`)
          ]).then(([own, other]) => {
            if (current !== tabRequest || signal.aborted) return;
            if ([own, other].some((item) => item.season?.year !== season || item.season?.type !== 2 || !Array.isArray(item.results?.stats?.categories))) throw new TypeError("Matchup statistics are incomplete.");
            const ownStats = statsMap(own), otherStats = statsMap(other);
            comparison.replaceChildren(element("p", "nba-team-hub-note", "Regular-season comparison"));
            const list = element("dl", "nba-team-hub-stats");
            for (const [title, key] of [["Points/game", "avgPoints"], ["Rebounds/game", "avgRebounds"], ["3-point %", "threePointFieldGoalPct"]]) {
              list.append(element("dt", "", title), element("dd", "", `${ownStats.get(key)?.displayValue ?? "—"} / ${otherStats.get(key)?.displayValue ?? "—"}`));
            }
            comparison.append(list);
            empty(comparison, "Team / opponent. Comparisons are not predictions; ratings and pace are unavailable.");
          }).catch((error) => {
            if (signal.aborted || current !== tabRequest) return;
            console.error("Could not load next opponent comparison.", error);
            comparison.replaceChildren(element("p", "nba-team-hub-note", "Matchup statistics are unavailable."));
          });
        }
        api(`/news?team=${id}`).then((news) => {
          if (current !== tabRequest || signal.aborted) return;
          if (!Array.isArray(news.articles)) throw new TypeError("Team news is incomplete.");
          headlines.replaceChildren(element("h3", "", "Team news"));
          const list = renderNews(news.articles.slice(0, 3));
          if (list.children.length) headlines.append(list);
          else empty(headlines, "No team news is currently available.");
        }).catch((error) => {
          if (signal.aborted || current !== tabRequest) return;
          console.error("Could not load team news.", error);
          headlines.replaceChildren(element("h3", "", "Team news"), element("p", "nba-team-hub-note", "Team news is unavailable."));
        });
      } else if (name === "roster" || name === "depth") {
        const data = await api(`/teams/${id}/roster`);
        if (!Array.isArray(data.athletes)) throw new TypeError("Roster data is incomplete.");
        if (current !== tabRequest || signal.aborted) return;
        const box = section(name === "roster" ? "Current roster" : "Roster position groups");
        if (name === "depth") empty(box, "Positions are roster designations, not a confirmed depth chart or starter order.");
        const athletes = data.athletes.flatMap((item) => Array.isArray(item.items) ? item.items : [item]).filter((item) => item?.displayName);
        if (!athletes.length) empty(box, "Roster information is unavailable.");
        else if (name === "depth") {
          const groups = new Map();
          for (const athlete of athletes) {
            const position = athlete.position?.displayName || "Position unavailable";
            if (!groups.has(position)) groups.set(position, []);
            groups.get(position).push(athlete);
          }
          for (const [position, players] of groups) {
            const group = element("section");
            group.append(element("h4", "", position));
            const list = element("ul", "nba-team-hub-roster");
            for (const athlete of players) list.append(playerCard(athlete));
            group.append(list);
            box.append(group);
          }
        } else {
          const sort = document.createElement("select");
          sort.setAttribute("aria-label", "Sort roster");
          for (const [value, text] of [["name", "Name"], ["position", "Position"], ["MIN", "Minutes per game"], ["PTS", "Points per game"], ["REB", "Rebounds per game"], ["AST", "Assists per game"]]) {
            const option = element("option", "", text);
            option.value = value;
            sort.append(option);
          }
          const status = element("p", "nba-team-hub-note", "Loading player season averages…");
          status.setAttribute("role", "status");
          const list = element("ul", "nba-team-hub-roster");
          let averages = new Map();
          let loaded = false;
          function draw() {
            const key = sort.value;
            const sorted = [...athletes].sort((a, b) => {
              if (key === "name" || key === "position") {
                const left = key === "name" ? a.displayName : a.position?.displayName || "";
                const right = key === "name" ? b.displayName : b.position?.displayName || "";
                return left.localeCompare(right) || a.displayName.localeCompare(b.displayName);
              }
              const left = Number.parseFloat(averages.get(String(a.id))?.get(key));
              const right = Number.parseFloat(averages.get(String(b.id))?.get(key));
              if (!Number.isFinite(left) || !Number.isFinite(right)) return !Number.isFinite(left) && !Number.isFinite(right) ? a.displayName.localeCompare(b.displayName) : !Number.isFinite(left) ? 1 : -1;
              return right - left || a.displayName.localeCompare(b.displayName);
            });
            list.replaceChildren(...sorted.map((athlete) => playerCard(athlete, averages.get(String(athlete.id)) || (loaded ? new Map() : null))));
          }
          sort.addEventListener("change", draw);
          box.append(sort, status, list);
          draw();
          loadRosterAverages(athletes, () => current === tabRequest, (values, failed) => {
            if (current !== tabRequest || !box.isConnected) return;
            averages = values;
            loaded = true;
            status.textContent = failed ? `Season averages unavailable for ${failed} player${failed === 1 ? "" : "s"}.` : `Regular-season averages for ${season}; dashes indicate unavailable data.`;
            draw();
          });
        }
        panel.replaceChildren(box);
      } else if (name === "stats") {
        const data = await api(`/teams/${id}/statistics?season=${encodeURIComponent(season)}&seasontype=2`);
        if (data.season?.year !== season || data.season?.type !== 2 || !Array.isArray(data.results?.stats?.categories)) throw new TypeError("Team season statistics are unavailable.");
        if (current !== tabRequest || signal.aborted) return;
        const headline = root.querySelector(".nba-team-hub-metrics");
        if (headline?.dataset.state === "error") loadHeroStats(headline);
        const stats = statsMap(data);
        const box = section(`${data.season.displayName || season} regular-season team statistics`);
        const view = document.createElement("select");
        view.setAttribute("aria-label", "Team statistics view");
        for (const [value, text] of [["standard", "Traditional"], ["advanced", "Advanced"]]) {
          const option = element("option", "", text);
          option.value = value;
          view.append(option);
        }
        const period = document.createElement("select");
        period.setAttribute("aria-label", "Statistics period");
        const full = element("option", "", "Full regular season");
        period.append(full);
        for (const text of ["Last 5 games", "Last 10 games", "Last 15 games", "Last 20 games", "Home", "Away"]) {
          const option = element("option", "", `${text} — unavailable`);
          option.disabled = true;
          period.append(option);
        }
        const controls = element("div", "nba-team-hub-filters");
        controls.append(view, period);
        const list = element("dl", "nba-team-hub-stats");
        const note = element("p", "nba-team-hub-note");
        function draw() {
          list.replaceChildren();
          const number = (key) => {
            const value = stats.get(key)?.value;
            return typeof value === "number" && Number.isFinite(value) ? value : null;
          };
          const fgm = number("fieldGoalsMade"), fga = number("fieldGoalsAttempted");
          const threes = number("threePointFieldGoalsMade"), fta = number("freeThrowsAttempted");
          const points = number("points"), turnovers = number("turnovers");
          const percentage = (numerator, denominator) => numerator != null && denominator > 0 ? `${(100 * numerator / denominator).toFixed(1)}%` : "—";
          const advanced = [
            ["Offensive rating", "—"], ["Defensive rating", "—"], ["Net rating", "—"], ["Pace", "—"],
            ["Effective FG%", fgm != null && threes != null ? percentage(fgm + 0.5 * threes, fga) : "—"],
            ["True shooting %", points != null && fga != null && fta != null ? percentage(points, 2 * (fga + 0.44 * fta)) : "—"],
            ["Turnover %", turnovers != null && fga != null && fta != null ? percentage(turnovers, fga + 0.44 * fta + turnovers) : "—"],
            ["Offensive rebound %", "—"], ["Free throw rate", fta != null && fga > 0 ? (fta / fga).toFixed(3) : "—"]
          ];
          const standard = [
            ["Points per game", stats.get("avgPoints")?.displayValue], ["Opponent points per game", standingsStats(teamEntry).get("avgPointsAgainst")],
            ["Rebounds per game", stats.get("avgRebounds")?.displayValue], ["Assists per game", stats.get("avgAssists")?.displayValue],
            ["Steals per game", stats.get("avgSteals")?.displayValue], ["Blocks per game", stats.get("avgBlocks")?.displayValue],
            ["Field goal %", stats.get("fieldGoalPct")?.displayValue], ["3-point %", stats.get("threePointFieldGoalPct")?.displayValue],
            ["Free throw %", stats.get("freeThrowPct")?.displayValue]
          ];
          for (const [label, value] of view.value === "advanced" ? advanced : standard) {
            list.append(element("dt", "", label), element("dd", "", value ?? "—"));
          }
          note.textContent = view.value === "advanced"
            ? "Calculated from ESPN season totals: eFG% = (FGM + 0.5 × 3PM) / FGA; TS% = points / (2 × (FGA + 0.44 × FTA)); turnover % = turnovers / (FGA + 0.44 × FTA + turnovers); free throw rate = FTA / FGA. Ratings, pace, opponent rebound data, league comparisons and splits are unavailable."
            : "Regular-season averages from ESPN. League ranks, league averages and game-window splits are unavailable.";
        }
        view.addEventListener("change", draw);
        box.append(controls, list, note);
        draw();
        panel.replaceChildren(box);
      } else if (name === "news") {
        const data = await api(`/news?team=${id}`);
        if (!Array.isArray(data.articles)) throw new TypeError("Team news is incomplete.");
        if (current !== tabRequest || signal.aborted) return;
        const box = section("Team news");
        const list = renderNews(data.articles);
        if (list.children.length) box.append(list);
        else empty(box, "No team news is currently available.");
        panel.replaceChildren(box);
      }
    } catch (error) {
      if (signal.aborted || current !== tabRequest) return;
      console.error(`Could not load NBA team ${name}.`, error);
      const box = section("Data unavailable");
      empty(box, `Could not load ${name}. Check your connection and try again.`);
      const retry = element("button", "secondary", "Try again");
      retry.type = "button";
      retry.addEventListener("click", () => renderTab(panel, name));
      box.append(retry);
      panel.replaceChildren(box);
    }
  }

  function renderNews(articles) {
    const list = element("ul", "nba-team-hub-list");
    for (const article of articles) {
      let url;
      try { url = new URL(article.links?.web?.href); } catch { continue; }
      if (url.protocol !== "https:" || !(url.hostname === "espn.com" || url.hostname.endsWith(".espn.com")) || !article.headline) continue;
      const item = element("li");
      const link = element("a", "sports-news-link", article.headline);
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const image = article.images?.[0]?.url;
      if (image && /^https:\/\/[^/]+/i.test(image)) {
        const img = document.createElement("img");
        img.src = image;
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("error", () => img.remove(), { once: true });
        link.prepend(img);
      }
      item.append(link);
      if (article.published) {
        const date = new Date(article.published);
        if (!Number.isNaN(date.getTime())) item.append(element("small", "", `ESPN · ${date.toLocaleDateString()}`));
      }
      list.append(item);
    }
    return list;
  }

  function playerCard(athlete, averages) {
    const card = element("li", "nba-team-hub-player");
    const portrait = createPlayerPortrait(athlete, athlete.position?.abbreviation || "NBA");
    const info = element("span");
    const title = athlete.id ? element("button", "nba-team-hub-player-link", athlete.displayName) : element("strong", "", athlete.displayName);
    if (athlete.id) {
      title.type = "button";
      title.addEventListener("click", () => openPlayerProfile(String(athlete.id)));
    }
    info.append(title, element("small", "", [
      athlete.jersey ? `#${athlete.jersey}` : "", athlete.position?.displayName,
      athlete.displayHeight, athlete.age ? `${athlete.age} years` : ""
    ].filter(Boolean).join(" · ")));
    if (averages) info.append(element("small", "", `PPG ${averages.get("PTS") ?? "—"} · RPG ${averages.get("REB") ?? "—"} · APG ${averages.get("AST") ?? "—"}`));
    for (const injury of athlete.injuries || []) {
      if (injury.status) {
        const updated = injury.date ? new Date(injury.date) : null;
        const when = updated && !Number.isNaN(updated.getTime()) ? ` · Updated ${updated.toLocaleDateString()}` : "";
        info.append(element("small", "", `Injury: ${injury.status}${when}`));
      }
    }
    card.append(portrait, info);
    return card;
  }

  async function load() {
    try {
      const [standings, teamData] = await Promise.all([
        nbaHubFetch(standingsUrl, signal),
        api(`/teams/${id}/roster`).catch((error) => {
          if (signal.aborted) throw error;
          console.error("Could not load team identity details.", error);
          return null;
        })
      ]);
      if (!Array.isArray(standings.children)) throw new TypeError("NBA standings are incomplete.");
      conference = standings.children.find((group) => group.standings?.entries?.some((entry) => String(entry.team?.id) === id));
      teamEntry = conference?.standings?.entries?.find((entry) => String(entry.team?.id) === id);
      season = standings.season?.year;
      if (!teamEntry || !Number.isInteger(season)) throw new TypeError("Team standings or season are unavailable.");
      if (signal.aborted) return;
      const tablist = element("div", "nba-team-hub-tabs");
      tablist.setAttribute("role", "tablist");
      tablist.setAttribute("aria-label", "Team page sections");
      const panel = element("div", "nba-team-hub-panel");
      panel.setAttribute("role", "tabpanel");
      panel.id = "nba-team-hub-panel";
      const metrics = element("div", "nba-team-hub-metrics");
      metrics.append(element("p", "nba-team-hub-note", "Loading team season statistics…"));
      function selectTab(name) {
        activeTab = name;
        for (const button of tablist.querySelectorAll("button")) {
          const selected = button.dataset.tab === name;
          button.setAttribute("aria-selected", String(selected));
          button.tabIndex = selected ? 0 : -1;
        }
        panel.setAttribute("aria-labelledby", `nba-team-tab-${name}`);
        renderTab(panel, name);
      }
      tabs.forEach(([name, text], index) => {
        const button = element("button", "secondary", text);
        button.type = "button";
        button.id = `nba-team-tab-${name}`;
        button.dataset.tab = name;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-controls", panel.id);
        button.addEventListener("click", () => selectTab(name));
        button.addEventListener("keydown", (event) => {
          if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
            (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
          selectTab(tabs[next][0]);
          tablist.querySelectorAll("button")[next].focus();
        });
        tablist.append(button);
      });
      content.replaceChildren(addHero(teamData || {}), metrics, tablist, panel);
      if (!teamData) content.insertBefore(element("p", "nba-team-hub-note", "Team colors and division details are unavailable; roster data can be retried in its tab."), metrics);
      loadHeroStats(metrics);
      selectTab(activeTab);
    } catch (error) {
      if (signal.aborted) return;
      console.error("Could not load NBA team page.", error);
      const message = element("div", "nba-data-state error");
      message.append(element("p", "", "Could not load team information. Check your connection and try again."));
      const retry = element("button", "secondary", "Try again");
      retry.type = "button";
      retry.addEventListener("click", load);
      message.append(retry);
      content.replaceChildren(message);
    }
  }
  load();
  return root;
}
