// More leagues for the Sports channel: a shared scoreboard for MLB, NHL, college football and basketball,
// the Premier League and MLS, using ESPN's public scoreboard API (NBA and NFL keep their own scoreboards).
// Loaded as a classic script before the main app script; element() comes from the app at call time.

const sportsLeagues = [
  { id: "nba", label: "NBA", path: "basketball/nba", espn: "nba" },
  { id: "nfl", label: "NFL", path: "football/nfl", espn: "nfl" },
  { id: "mlb", label: "MLB", path: "baseball/mlb", espn: "mlb" },
  { id: "nhl", label: "NHL", path: "hockey/nhl", espn: "nhl" },
  { id: "cfb", label: "College football", path: "football/college-football", espn: "college-football", groups: "80" },
  { id: "cbb", label: "College basketball", path: "basketball/mens-college-basketball", espn: "mens-college-basketball", groups: "50" },
  { id: "epl", label: "Premier League", path: "soccer/eng.1", espn: "soccer", soccer: true },
  { id: "mls", label: "MLS", path: "soccer/usa.1", espn: "soccer", soccer: true },
];
const sportsLeagueDates = new Map(); // league id → YYYY-MM-DD shown
const sportsLeagueSelected = new Map(); // league id → selected game id
const sportsLeagueRequests = new Map();

function sportsLeague(id) {
  return sportsLeagues.find((league) => league.id === id) || sportsLeagues[0];
}

function sportsLeagueToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function sportsLeagueShift(date, days) {
  const day = new Date(`${date}T12:00:00`);
  day.setDate(day.getDate() + days);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

function sportsLeagueLogo(team) {
  const url = team?.logo || team?.logos?.[0]?.href || "";
  if (!/^https:\/\//.test(url)) return element("span", "league-logo league-logo-empty", (team?.abbreviation || "?").slice(0, 3));
  const img = element("img", "league-logo");
  img.src = url;
  img.alt = "";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => img.replaceWith(element("span", "league-logo league-logo-empty", (team?.abbreviation || "?").slice(0, 3))), { once: true });
  return img;
}

function sportsLeagueStatus(competition) {
  const type = competition?.status?.type || {};
  return { state: type.state || "pre", text: type.shortDetail || type.detail || type.description || "", completed: Boolean(type.completed) };
}

function sportsLeagueGameLink(event) {
  const link = (event.links || []).find((item) => (item.rel || []).includes("summary") || (item.rel || []).includes("desktop"));
  try {
    const url = new URL(link?.href || "");
    return url.hostname.endsWith("espn.com") ? (url.protocol = "https:", url.href) : "";
  } catch {
    return "";
  }
}

// One competitor row on a game card.
function sportsLeagueTeamRow(competitor, competition, status) {
  const row = element("div", "league-team");
  const won = status.completed && competitor.winner;
  if (won) row.classList.add("is-winner");
  row.append(sportsLeagueLogo(competitor.team));
  const name = element("span", "league-team-name");
  name.append(element("strong", "", competitor.team?.shortDisplayName || competitor.team?.displayName || "TBD"));
  const record = competitor.records?.find((item) => item.type === "total" || item.name === "overall")?.summary;
  const rank = competitor.curatedRank?.current;
  if (rank && rank <= 25) name.prepend(element("small", "league-rank", `#${rank} `));
  if (record) name.append(element("small", "", record));
  row.append(name, element("span", "league-score", status.state === "pre" ? "" : String(competitor.score ?? "")));
  return row;
}

function sportsLeagueDetail(event, league) {
  const box = element("section", "league-detail");
  box.setAttribute("aria-live", "polite");
  const competition = event.competitions?.[0] || {};
  const status = sportsLeagueStatus(competition);
  const teams = [...(competition.competitors || [])].sort((a) => (a.homeAway === "away" ? -1 : 1));
  box.append(element("h4", "", event.name || event.shortName || "Game"));
  box.append(element("p", "politics-meta", [status.text, competition.venue?.fullName, (competition.broadcasts || []).flatMap((b) => b.names || []).join(", ")].filter(Boolean).join(" · ")));
  const periods = Math.max(0, ...teams.map((team) => (team.linescores || []).length));
  if (periods) {
    const table = element("table", "league-linescore");
    const head = element("tr", "");
    head.append(element("th", "", ""));
    const label = league.soccer ? (i) => (i === 0 ? "1H" : i === 1 ? "2H" : `ET${i - 1}`) : league.id === "mlb" ? (i) => String(i + 1) : league.id === "nhl" ? (i) => (i < 3 ? `P${i + 1}` : i === 3 ? "OT" : "SO") : (i) => (i < 4 ? `Q${i + 1}` : `OT${i > 4 ? i - 3 : ""}`);
    for (let index = 0; index < periods; index++) head.append(element("th", "", label(index)));
    head.append(element("th", "", league.id === "mlb" ? "R" : "T"));
    table.append(head);
    for (const team of teams) {
      const row = element("tr", "");
      row.append(element("th", "", team.team?.abbreviation || team.team?.shortDisplayName || ""));
      for (let index = 0; index < periods; index++) row.append(element("td", "", String(team.linescores?.[index]?.value ?? "")));
      row.append(element("td", "league-total", String(team.score ?? "")));
      table.append(row);
    }
    box.append(table);
  }
  const leaders = teams.flatMap((team) => (team.leaders || []).slice(0, 3).map((group) => ({ team, group })))
    .filter(({ group }) => group.leaders?.[0]?.athlete?.displayName);
  if (leaders.length) {
    const list = element("ul", "league-leaders");
    for (const { team, group } of leaders.slice(0, 6)) {
      const leader = group.leaders[0];
      list.append(element("li", "", `${group.displayName || group.name}: ${leader.athlete.displayName} (${team.team?.abbreviation || ""}) ${leader.displayValue || leader.value}`));
    }
    box.append(list);
  }
  const href = sportsLeagueGameLink(event);
  if (href) {
    const link = element("a", "", "Full game on ESPN ↗");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    box.append(link);
  }
  return box;
}

function createLeagueScoreboard(leagueId) {
  const league = sportsLeague(leagueId);
  const section = element("section", `scoreboard league-scoreboard ${league.id}-scoreboard`);
  section.dataset.league = league.id;
  section.setAttribute("aria-labelledby", `${league.id}-scoreboard-title`);
  const heading = element("div", "scoreboard-heading");
  const title = element("h3", "", `${league.label.toUpperCase()} SCORES`);
  title.id = `${league.id}-scoreboard-title`;
  heading.append(title, element("p", "", `Every ${league.label} game for the selected day · Live games refresh more often.`));
  const controls = element("div", "score-controls");
  const dateField = element("div", "field");
  const dateLabel = element("label", "", "Game day");
  dateLabel.htmlFor = `${league.id}-date`;
  const dateInput = element("input", "");
  dateInput.type = "date";
  dateInput.id = `${league.id}-date`;
  dateInput.value = sportsLeagueDates.get(league.id) || sportsLeagueToday();
  dateField.append(dateLabel, dateInput);
  const previous = element("button", "secondary", "‹");
  previous.type = "button";
  previous.setAttribute("aria-label", "Show previous day");
  const next = element("button", "secondary", "›");
  next.type = "button";
  next.setAttribute("aria-label", "Show next day");
  const refresh = element("button", "secondary", "Refresh");
  refresh.type = "button";
  controls.append(dateField, previous, next, refresh);
  const status = element("p", "score-status", "Loading games…");
  status.setAttribute("role", "status");
  const updated = element("p", "score-updated", "");
  const games = element("div", "league-games");
  const detail = element("div", "league-detail-area");
  const body = element("div", "league-body");
  body.append(games, detail);
  section.append(heading, controls, status, updated, body);
  const go = (date) => {
    dateInput.value = date;
    sportsLeagueDates.set(league.id, date);
    loadLeagueGames(section);
  };
  dateInput.addEventListener("change", () => dateInput.value && go(dateInput.value));
  previous.addEventListener("click", () => go(sportsLeagueShift(dateInput.value || sportsLeagueToday(), -1)));
  next.addEventListener("click", () => go(sportsLeagueShift(dateInput.value || sportsLeagueToday(), 1)));
  refresh.addEventListener("click", () => loadLeagueGames(section));
  section.reloadGames = (options) => loadLeagueGames(section, options);
  loadLeagueGames(section);
  return section;
}

async function loadLeagueGames(section, { automatic = false } = {}) {
  const league = sportsLeague(section.dataset.league);
  const date = section.querySelector(`#${league.id}-date`)?.value || sportsLeagueToday();
  sportsLeagueDates.set(league.id, date);
  sportsLeagueRequests.get(league.id)?.abort();
  const controller = new AbortController();
  sportsLeagueRequests.set(league.id, controller);
  const status = section.querySelector(".score-status");
  const updated = section.querySelector(".score-updated");
  const games = section.querySelector(".league-games");
  const detailArea = section.querySelector(".league-detail-area");
  section.dataset.loading = "true";
  if (!automatic) {
    status.textContent = `Loading ${league.label} games…`;
    games.setAttribute("aria-busy", "true");
  }
  try {
    const params = new URLSearchParams({ dates: date.replaceAll("-", ""), limit: "300" });
    if (league.groups) params.set("groups", league.groups);
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Scoreboard request failed (${response.status}).`);
    const data = await response.json();
    if (!Array.isArray(data.events)) throw new TypeError("Scoreboard response was incomplete.");
    const events = data.events.filter((event) => (event.competitions?.[0]?.competitors || []).length >= 2);
    section.dataset.refreshInterval = String(typeof scoreRefreshInterval === "function" ? scoreRefreshInterval(events) : 300000);
    section.dataset.lastRefresh = String(Date.now());
    document.dispatchEvent(new CustomEvent("sports-schedule", { detail: { sport: league.id, events, date } }));
    games.replaceChildren();
    if (!events.length) {
      status.textContent = `No ${league.label} games on ${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}.`;
      detailArea.replaceChildren();
      return;
    }
    const live = events.filter((event) => sportsLeagueStatus(event.competitions[0]).state === "in").length;
    status.textContent = `${events.length} game${events.length === 1 ? "" : "s"}${live ? ` · ${live} live` : ""}`;
    let selectedId = sportsLeagueSelected.get(league.id);
    if (!events.some((event) => String(event.id) === selectedId)) selectedId = String((events.find((event) => sportsLeagueStatus(event.competitions[0]).state === "in") || events[0]).id);
    for (const event of events) {
      const competition = event.competitions[0];
      const gameStatus = sportsLeagueStatus(competition);
      const card = element("button", `league-game is-${gameStatus.state}`);
      card.type = "button";
      card.dataset.gameId = String(event.id);
      card.setAttribute("aria-pressed", String(String(event.id) === selectedId));
      const teams = [...competition.competitors].sort((a) => (a.homeAway === "away" ? -1 : 1));
      const top = element("span", "league-game-status");
      top.append(element("strong", "", gameStatus.state === "pre" ? new Date(event.date).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : gameStatus.text));
      const network = (competition.broadcasts || []).flatMap((b) => b.names || [])[0];
      if (network) top.append(element("small", "", network));
      card.append(top, ...teams.map((team) => sportsLeagueTeamRow(team, competition, gameStatus)));
      card.addEventListener("click", () => {
        sportsLeagueSelected.set(league.id, String(event.id));
        games.querySelectorAll(".league-game").forEach((item) => item.setAttribute("aria-pressed", String(item === card)));
        detailArea.replaceChildren(sportsLeagueDetail(event, league));
        document.dispatchEvent(new CustomEvent("sports-selection", { detail: { sport: league.id, event } }));
      });
      games.append(card);
    }
    const selected = events.find((event) => String(event.id) === selectedId);
    sportsLeagueSelected.set(league.id, selectedId);
    detailArea.replaceChildren(sportsLeagueDetail(selected, league));
    document.dispatchEvent(new CustomEvent("sports-selection", { detail: { sport: league.id, event: selected } }));
    updated.textContent = `Last updated ${new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error(`Could not load ${league.label} games.`, error);
    if (!automatic) {
      status.textContent = `Couldn’t load ${league.label} games. Check your connection and try Refresh.`;
      games.replaceChildren();
    }
  } finally {
    section.dataset.loading = "false";
    games.setAttribute("aria-busy", "false");
  }
}
