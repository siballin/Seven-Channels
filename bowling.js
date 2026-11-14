// Bowling channel: league-night log, arsenal, and dashboard.
// Loaded as a classic script before the main app script; helpers such as
// element() and showNotice() are resolved from the app at call time.
const bowlingStorageKey = "seven-channels.bowling.v1";
const bowlingSessionTypes = [["league", "League"], ["practice", "Practice"], ["tournament", "Tournament"]];
// Stable IDs let starter balls merge across devices instead of duplicating.
const bowlingStarterBalls = [
  ["starter-black-venom", "Black Venom"],
  ["starter-motiv-nebula", "Motiv Nebula"],
  ["starter-c300-pulse", "C300 Pulse"]
];
const bowlingMaxGames = 12;
const bowlingLimits = { league: 60, team: 60, center: 60, notes: 500, move: 140, result: 140, ballName: 60, layout: 40, surface: 60, ballNotes: 200 };
const bowlingMoveSuggestions = [
  "Moved 2 boards right", "Moved 2 boards left", "Moved feet 2 left, eyes 1 left", "Moved feet 2 right, eyes 1 right",
  "Moved deeper", "More hand", "Less hand", "Slowed speed", "Picked up speed", "Earlier release", "Changed loft"
];
const bowlingResultSuggestions = [
  "Ball read sooner", "Better carry", "Struck more", "Still high", "Still light", "Over-reacted", "No change", "Leaving 10 pins"
];

let bowlingState = null;
let bowlingDraft = null;
let bowlingBallDraft = null;
let bowlingFilters = { type: "all", ball: "all", query: "" };
let bowlingStatus = { form: "", formError: false, ball: "", ballError: false };
let bowlingPendingDelete = null;
let bowlingRoot = null;
let bowlingFabHidden = false;
// Set by the app so local Bowling changes are pushed to the signed-in account.
let bowlingOnChange = null;

function bowlingId(prefix) {
  const random = globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`;
}

function bowlingToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function bowlingText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function bowlingTime(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function bowlingValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function bowlingNormalizeBallRef(value) {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id) return null;
  return {
    id: value.id.slice(0, 80),
    name: bowlingText(value.name, bowlingLimits.ballName) || "Unnamed ball",
    layout: bowlingText(value.layout, bowlingLimits.layout),
    surface: bowlingText(value.surface, bowlingLimits.surface)
  };
}

const bowlingCoverTypes = [["solid", "Solid"], ["pearl", "Pearl"], ["hybrid", "Hybrid"], ["urethane", "Urethane"], ["polyester", "Polyester"]];

function bowlingSpecNumber(value) {
  return Number.isFinite(value) && value > 0 && value < 10 ? value : null;
}

// Specs copied from the ball database when a ball is added or linked, so they stay with the arsenal entry.
function bowlingNormalizeCatalogRef(value) {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id) return null;
  return {
    id: value.id.slice(0, 120),
    brand: bowlingText(value.brand, 40),
    name: bowlingText(value.name, 80),
    coverType: bowlingCoverTypes.some(([type]) => type === value.coverType) ? value.coverType : "",
    coverstock: bowlingText(value.coverstock, 80),
    core: bowlingText(value.core, 80),
    symmetry: ["symmetric", "asymmetric"].includes(value.symmetry) ? value.symmetry : "",
    weight: Number.isInteger(value.weight) && value.weight >= 6 && value.weight <= 16 ? value.weight : null,
    rg: bowlingSpecNumber(value.rg),
    diff: bowlingSpecNumber(value.diff),
    intDiff: bowlingSpecNumber(value.intDiff),
    releaseDate: bowlingValidDate(value.releaseDate) ? value.releaseDate : "",
    url: typeof value.url === "string" && value.url.startsWith("https://") ? value.url.slice(0, 300) : ""
  };
}

function bowlingNormalizeBall(value) {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id) return null;
  const name = bowlingText(value.name, bowlingLimits.ballName);
  if (!name) return null;
  return {
    id: value.id.slice(0, 80),
    name,
    layout: bowlingText(value.layout, bowlingLimits.layout),
    surface: bowlingText(value.surface, bowlingLimits.surface),
    notes: bowlingText(value.notes, bowlingLimits.ballNotes),
    archived: value.archived === true,
    catalog: bowlingNormalizeCatalogRef(value.catalog),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
  };
}

// Leagues are set up in the League tracker tab; sessions keep the league's id and name from when they were logged.
function bowlingNormalizeLeague(value) {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id) return null;
  const name = bowlingText(value.name, bowlingLimits.league);
  if (!name) return null;
  return {
    id: value.id.slice(0, 80),
    name,
    center: bowlingText(value.center, bowlingLimits.center),
    night: Number.isInteger(value.night) && value.night >= 0 && value.night <= 6 ? value.night : null,
    time: typeof value.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) ? value.time : "",
    team: bowlingText(value.team, bowlingLimits.team),
    seasonStart: bowlingValidDate(value.seasonStart) ? value.seasonStart : "",
    seasonEnd: bowlingValidDate(value.seasonEnd) ? value.seasonEnd : "",
    archived: value.archived === true,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
  };
}

function bowlingNormalizeLeagueRef(value) {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id) return null;
  const name = bowlingText(value.name, bowlingLimits.league);
  return name ? { id: value.id.slice(0, 80), name } : null;
}

function bowlingNormalizeScore(value) {
  return Number.isInteger(value) && value >= 0 && value <= 300 ? value : null;
}

function bowlingNormalizeSession(value) {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id) return null;
  if (!bowlingValidDate(value.date) || !Array.isArray(value.games) || !value.games.length) return null;
  const games = value.games.slice(0, bowlingMaxGames).map((game, index) => {
    // Frame-by-frame games (from the score tracker) keep their throws; the total always comes from the frames.
    const frames = typeof bowlingNormalizeFrames === "function" ? bowlingNormalizeFrames(game?.frames) : null;
    const record = {
    id: typeof game?.id === "string" && game.id ? game.id.slice(0, 80) : `game-${index + 1}`,
    score: frames ? bowlingReplayFrames(frames).total : bowlingNormalizeScore(game?.score),
    adjustments: (Array.isArray(game?.adjustments) ? game.adjustments : []).map((adjustment, adjustmentIndex) => ({
      id: typeof adjustment?.id === "string" && adjustment.id ? adjustment.id.slice(0, 80) : `adj-${index + 1}-${adjustmentIndex + 1}`,
      ball: bowlingNormalizeBallRef(adjustment?.ball),
      move: bowlingText(adjustment?.move, bowlingLimits.move),
      result: bowlingText(adjustment?.result, bowlingLimits.result)
    })).filter((adjustment) => adjustment.ball || adjustment.move || adjustment.result)
    };
    if (frames) record.frames = frames;
    return record;
  });
  return {
    id: value.id.slice(0, 80),
    date: value.date,
    type: bowlingSessionTypes.some(([type]) => type === value.type) ? value.type : "league",
    league: bowlingNormalizeLeagueRef(value.league),
    center: bowlingText(value.center, bowlingLimits.center),
    startBall: bowlingNormalizeBallRef(value.startBall),
    notes: bowlingText(value.notes, bowlingLimits.notes),
    games,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
  };
}

function bowlingSortSessions(a, b) {
  return b.date.localeCompare(a.date) || bowlingTime(b.createdAt) - bowlingTime(a.createdAt) || a.id.localeCompare(b.id);
}

// Canonical ordering keeps merged state byte-identical on every device, so sync converges.
function bowlingNormalizeState(value) {
  const source = value && typeof value === "object" ? value : {};
  const tombstones = [...new Set((Array.isArray(source.deletedSessionIds) ? source.deletedSessionIds : [])
    .filter((id) => typeof id === "string" && id))].sort();
  const deleted = new Set(tombstones);
  const sessions = new Map();
  for (const session of (Array.isArray(source.sessions) ? source.sessions : []).map(bowlingNormalizeSession)) {
    if (session && !deleted.has(session.id) && !sessions.has(session.id)) sessions.set(session.id, session);
  }
  const balls = new Map();
  for (const ball of (Array.isArray(source.balls) ? source.balls : []).map(bowlingNormalizeBall)) {
    if (ball && !balls.has(ball.id)) balls.set(ball.id, ball);
  }
  const leagues = new Map();
  for (const league of (Array.isArray(source.leagues) ? source.leagues : []).map(bowlingNormalizeLeague)) {
    if (league && !leagues.has(league.id)) leagues.set(league.id, league);
  }
  return {
    sessions: [...sessions.values()].sort(bowlingSortSessions),
    leagues: [...leagues.values()].sort((a, b) => bowlingTime(a.createdAt) - bowlingTime(b.createdAt) || a.id.localeCompare(b.id)),
    balls: [...balls.values()].sort((a, b) => bowlingTime(a.createdAt) - bowlingTime(b.createdAt) || a.id.localeCompare(b.id)),
    deletedSessionIds: tombstones
  };
}

function bowlingValidState(value) {
  return Boolean(value && typeof value === "object" &&
    Array.isArray(value.sessions) && Array.isArray(value.balls) && Array.isArray(value.deletedSessionIds));
}

function bowlingNewerRecord(candidate, current) {
  const candidateTime = bowlingTime(candidate.updatedAt);
  const currentTime = bowlingTime(current.updatedAt);
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  // Deterministic tie-break so two devices pick the same version.
  return JSON.stringify(candidate) > JSON.stringify(current);
}

// Per-record merge: the newest edit of each session or ball wins and deleted sessions stay deleted.
function bowlingMergeState(local, remote) {
  const localState = bowlingNormalizeState(local);
  const remoteState = bowlingNormalizeState(remote);
  const tombstones = [...new Set([...localState.deletedSessionIds, ...remoteState.deletedSessionIds])];
  const pick = (records) => {
    const combined = new Map();
    for (const record of records) {
      const previous = combined.get(record.id);
      if (!previous || bowlingNewerRecord(record, previous)) combined.set(record.id, record);
    }
    return [...combined.values()];
  };
  return bowlingNormalizeState({
    sessions: pick([...remoteState.sessions, ...localState.sessions]),
    balls: pick([...remoteState.balls, ...localState.balls]),
    leagues: pick([...remoteState.leagues, ...localState.leagues]),
    deletedSessionIds: tombstones
  });
}

function loadBowlingState() {
  try {
    const saved = localStorage.getItem(bowlingStorageKey);
    if (saved === null) return bowlingNormalizeState({});
    const parsed = JSON.parse(saved);
    if (!bowlingValidState(parsed)) throw new TypeError("Saved bowling data has an unexpected format.");
    return bowlingNormalizeState(parsed);
  } catch (error) {
    console.error("Could not load bowling data.", error);
    if (typeof showNotice === "function") showNotice("Saved bowling data could not be read. New sessions can still be logged.");
    return bowlingNormalizeState({});
  }
}

function bowlingGetState() {
  if (!bowlingState) bowlingState = loadBowlingState();
  return bowlingState;
}

function bowlingPersist() {
  try {
    localStorage.setItem(bowlingStorageKey, JSON.stringify(bowlingState));
    return true;
  } catch (error) {
    console.error("Could not save bowling data.", error);
    if (typeof showNotice === "function") showNotice("Your browser couldn’t save this bowling change. Check your storage settings and try again.");
    return false;
  }
}

// Replaces state from account sync without stamping new edit times.
function bowlingReplaceState(value) {
  bowlingState = bowlingNormalizeState(value);
  bowlingPersist();
}

function bowlingCommit(mutate) {
  const next = structuredClone(bowlingGetState());
  mutate(next, new Date().toISOString());
  bowlingState = bowlingNormalizeState(next);
  const saved = bowlingPersist();
  bowlingOnChange?.();
  return saved;
}

function bowlingScores(session) {
  return session.games.map((game) => game.score).filter((score) => score !== null);
}

function bowlingSeriesSummary(session) {
  const scores = bowlingScores(session);
  const total = scores.reduce((sum, score) => sum + score, 0);
  return {
    scores,
    total,
    average: scores.length ? total / scores.length : null,
    complete: session.games.length === 3 && scores.length === 3
  };
}

function bowlingOverall(sessions) {
  const scores = sessions.flatMap(bowlingScores);
  const series = sessions.map(bowlingSeriesSummary).filter((summary) => summary.complete);
  return {
    games: scores.length,
    average: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    high: scores.length ? Math.max(...scores) : null,
    highSeries: series.length ? Math.max(...series.map((summary) => summary.total)) : null
  };
}

function bowlingFormatAverage(value) {
  if (value === null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function bowlingFormatDate(value, options = { weekday: "short", month: "short", day: "numeric", year: "numeric" }) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, options).format(new Date(year, month - 1, day));
}

function bowlingTypeLabel(type) {
  return bowlingSessionTypes.find(([value]) => value === type)?.[1] || "League";
}

function bowlingBallSnapshot(ball) {
  return ball ? { id: ball.id, name: ball.name, layout: ball.layout, surface: ball.surface } : null;
}

function bowlingBallDetails(ref) {
  return [ref.layout, ref.surface].filter(Boolean).join(" · ");
}

function bowlingParseScore(text) {
  const value = String(text ?? "").trim();
  if (!value) return { valid: true, score: null };
  if (!/^\d{1,3}$/.test(value)) return { valid: false, score: null };
  const score = Number(value);
  return score <= 300 ? { valid: true, score } : { valid: false, score: null };
}

// A new session picks the active league that bowls on today's weekday, else the league from the last session.
function bowlingDefaultLeagueId(state = bowlingGetState()) {
  const active = state.leagues.filter((league) => !league.archived);
  const weekday = new Date().getDay();
  const tonight = active.filter((league) => league.night === weekday);
  if (tonight.length === 1) return tonight[0].id;
  const recent = state.sessions.find((session) => session.league)?.league?.id;
  return active.some((league) => league.id === recent) ? recent : "";
}

function bowlingLeagueRef(state, leagueId, previous) {
  if (!leagueId) return null;
  const league = state.leagues.find((item) => item.id === leagueId);
  return league ? { id: league.id, name: league.name } : previous?.id === leagueId ? previous : null;
}

// Shows a league's current name, so renaming it in the League tracker updates past sessions.
function bowlingLeagueName(state, ref) {
  return ref ? state.leagues.find((league) => league.id === ref.id)?.name || ref.name : "";
}

function bowlingNewDraft() {
  return {
    id: null,
    date: bowlingToday(),
    leagueId: bowlingDefaultLeagueId(),
    center: bowlingGetState().leagues.find((league) => league.id === bowlingDefaultLeagueId())?.center || "",
    type: "league",
    startBallId: "",
    notes: "",
    games: [1, 2, 3].map(() => ({ id: bowlingId("game"), score: "", adjustments: [] }))
  };
}

function bowlingDraftFromSession(session) {
  return {
    id: session.id,
    date: session.date,
    leagueId: session.league?.id || "",
    center: session.center,
    type: session.type,
    startBallId: session.startBall?.id || "",
    notes: session.notes,
    games: session.games.map((game) => ({
      id: game.id,
      score: game.score === null ? "" : String(game.score),
      adjustments: game.adjustments.map((adjustment) => ({
        id: adjustment.id,
        ballId: adjustment.ball?.id || "",
        move: adjustment.move,
        result: adjustment.result
      }))
    }))
  };
}

function bowlingSessionUsesBall(session, ballId) {
  return session.startBall?.id === ballId ||
    session.games.some((game) => game.adjustments.some((adjustment) => adjustment.ball?.id === ballId));
}

// Every ball known from the arsenal or from recorded sessions, active first.
function bowlingKnownBalls(state) {
  const known = new Map(state.balls.map((ball) => [ball.id, { ...ball }]));
  for (const session of state.sessions) {
    const refs = [session.startBall, ...session.games.flatMap((game) => game.adjustments.map((adjustment) => adjustment.ball))];
    for (const ref of refs) {
      if (ref && !known.has(ref.id)) known.set(ref.id, { ...ref, notes: "", archived: true, recordedOnly: true });
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const all = [...known.values()];
  return [...all.filter((ball) => !ball.archived).sort(byName), ...all.filter((ball) => ball.archived).sort(byName)];
}

function bowlingSessionMatches(session, filters) {
  if (filters.type !== "all" && session.type !== filters.type) return false;
  if (filters.ball !== "all" && !bowlingSessionUsesBall(session, filters.ball)) return false;
  const query = filters.query.trim().toLocaleLowerCase();
  if (!query) return true;
  const haystack = [
    session.league?.name, session.center, session.notes, session.startBall?.name, bowlingTypeLabel(session.type),
    ...session.games.flatMap((game) => game.adjustments.flatMap((adjustment) => [adjustment.ball?.name, adjustment.move, adjustment.result]))
  ].filter(Boolean).join(" ").toLocaleLowerCase();
  return haystack.includes(query);
}

// Cells for the guide grid on the home page.
function bowlingGuideCells() {
  const { sessions } = bowlingGetState();
  const overall = bowlingOverall(sessions);
  const latest = sessions[0];
  const latestSummary = latest ? bowlingSeriesSummary(latest) : null;
  return [
    latest
      ? { title: latestSummary.scores.length ? `${latestSummary.total} series` : "No scores yet", note: `${bowlingTypeLabel(latest.type)} · ${bowlingFormatDate(latest.date, { month: "short", day: "numeric" })}` }
      : { title: "", note: "" },
    overall.games ? { title: `${bowlingFormatAverage(overall.average)} average`, note: `${overall.games} game${overall.games === 1 ? "" : "s"} bowled` } : { title: "", note: "" },
    overall.games ? { title: `${overall.high} high game`, note: overall.highSeries === null ? "" : `${overall.highSeries} best series` } : { title: "", note: "" }
  ];
}

function bowlingRefresh(focusId) {
  if (!bowlingRoot?.isConnected) return;
  const activeId = focusId || document.activeElement?.id;
  const previous = bowlingRoot;
  previous.bowlingObserver?.disconnect();
  previous.querySelector(".bowling-catalog")?.bowlingCatalogObserver?.disconnect();
  const next = createBowlingChannel();
  previous.replaceWith(next);
  if (activeId) document.getElementById(activeId)?.focus({ preventScroll: !focusId });
}

function bowlingField(labelText, control, hint) {
  const field = element("div", "field");
  const label = element("label", "", labelText);
  label.htmlFor = control.id;
  field.append(label, control);
  if (hint) field.append(hint);
  return field;
}

function bowlingInput(id, value, { type = "text", maxLength, placeholder, list } = {}) {
  const input = document.createElement("input");
  input.id = id;
  input.type = type;
  input.value = value || "";
  if (maxLength) input.maxLength = maxLength;
  if (placeholder) input.placeholder = placeholder;
  if (list) input.setAttribute("list", list);
  return input;
}

function bowlingBallSelect(id, selectedId, emptyLabel, state, snapshot) {
  const select = document.createElement("select");
  select.id = id;
  const none = element("option", "", emptyLabel);
  none.value = "";
  select.append(none);
  const balls = state.balls.slice();
  if (selectedId && snapshot?.id === selectedId && !balls.some((ball) => ball.id === selectedId)) {
    balls.push({ ...snapshot, archived: true });
  }
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const active = balls.filter((ball) => !ball.archived).sort(byName);
  const retired = balls.filter((ball) => ball.archived).sort(byName);
  const addOption = (parent, ball) => {
    const option = element("option", "", ball.name);
    option.value = ball.id;
    option.selected = ball.id === selectedId;
    parent.append(option);
  };
  active.forEach((ball) => addOption(select, ball));
  if (retired.length) {
    const group = document.createElement("optgroup");
    group.label = "Retired";
    retired.forEach((ball) => addOption(group, ball));
    select.append(group);
  }
  return select;
}

function bowlingDatalist(id, values) {
  const list = document.createElement("datalist");
  list.id = id;
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    list.append(option);
  }
  return list;
}

function bowlingDraftTotals() {
  const parsed = bowlingDraft.games.map((game) => bowlingParseScore(game.score));
  const scores = parsed.filter((item) => item.valid && item.score !== null).map((item) => item.score);
  const total = scores.reduce((sum, score) => sum + score, 0);
  return { total, scores, average: scores.length ? total / scores.length : null, games: bowlingDraft.games.length };
}

function createBowlingSessionForm(state) {
  if (!bowlingDraft) bowlingDraft = bowlingNewDraft();
  const draft = bowlingDraft;
  const editing = draft.id ? state.sessions.find((session) => session.id === draft.id) : null;
  if (draft.id && !editing) {
    bowlingDraft = bowlingNewDraft();
    return createBowlingSessionForm(state);
  }
  const panel = element("section", "bowling-panel bowling-log");
  panel.id = "bowling-log";
  panel.setAttribute("aria-labelledby", "bowling-log-title");
  const title = element("h3", "", editing ? "Edit session" : "Log session");
  title.id = "bowling-log-title";
  title.tabIndex = -1;
  const form = element("form", "bowling-form");
  form.noValidate = true;

  const meta = element("div", "bowling-form-grid");
  const date = bowlingInput("bowling-date", draft.date, { type: "date" });
  date.required = true;
  date.addEventListener("input", () => { draft.date = date.value; });
  const type = document.createElement("select");
  type.id = "bowling-type";
  for (const [value, label] of bowlingSessionTypes) {
    const option = element("option", "", label);
    option.value = value;
    option.selected = draft.type === value;
    type.append(option);
  }
  type.addEventListener("change", () => { draft.type = type.value; });
  const center = bowlingInput("bowling-center", draft.center, { maxLength: bowlingLimits.center, placeholder: "Optional", list: "bowling-center-list" });
  center.autocomplete = "off";
  center.addEventListener("input", () => { draft.center = center.value; });
  const centers = [...new Set(state.sessions.map((session) => session.center).filter(Boolean))];
  // Archived leagues only appear when editing a session that used one.
  const leagueOptions = state.leagues.filter((item) => !item.archived || (editing && item.id === draft.leagueId)).map((item) => [item.id, item.name]);
  if (!editing && !leagueOptions.some(([id]) => id === draft.leagueId)) draft.leagueId = "";
  if (draft.leagueId && !leagueOptions.some(([id]) => id === draft.leagueId) && editing?.league?.id === draft.leagueId) {
    leagueOptions.push([editing.league.id, editing.league.name]);
  }
  const league = bowlingSelect("bowling-league", [["", state.leagues.length ? "No league" : "No leagues yet"], ...leagueOptions], draft.leagueId);
  league.addEventListener("change", () => {
    draft.leagueId = league.value;
    const chosen = state.leagues.find((item) => item.id === league.value);
    if (chosen) {
      draft.type = "league";
      type.value = "league";
      if (!center.value.trim() && chosen.center) center.value = draft.center = chosen.center;
    }
  });
  const manage = element("a", "bowling-field-link", state.leagues.length ? "Manage leagues" : "Add your league in League tracker");
  manage.href = "#bowling/leagues";
  const leagueField = bowlingField("League", league, manage);
  leagueField.classList.add("bowling-field-wide");
  const startBall = bowlingBallSelect("bowling-start-ball", draft.startBallId, state.balls.length ? "No ball selected" : "Add balls to your arsenal", state, editing?.startBall);
  startBall.addEventListener("change", () => { draft.startBallId = startBall.value; });
  meta.append(
    bowlingField("Date", date),
    bowlingField("Session type", type),
    leagueField,
    bowlingField("Bowling center", center),
    bowlingField("Starting ball", startBall),
    bowlingDatalist("bowling-center-list", centers)
  );

  const totals = element("p", "bowling-live-totals");
  totals.setAttribute("aria-live", "polite");
  function updateTotals() {
    const summary = bowlingDraftTotals();
    totals.replaceChildren();
    const series = element("strong", "", summary.scores.length ? String(summary.total) : "—");
    totals.append(element("span", "", "Series "), series, element("span", "", ` · Avg ${bowlingFormatAverage(summary.average)} · ${summary.scores.length} of ${summary.games} game${summary.games === 1 ? "" : "s"} scored`));
  }

  const games = element("ol", "bowling-games");
  games.setAttribute("aria-label", "Games");
  draft.games.forEach((game, gameIndex) => {
    const item = element("li", "bowling-game");
    const head = element("div", "bowling-game-head");
    const scoreId = `bowling-score-${game.id}`;
    const scoreField = element("div", "field bowling-score-field");
    const scoreLabel = element("label", "", `Game ${gameIndex + 1}`);
    scoreLabel.htmlFor = scoreId;
    const score = bowlingInput(scoreId, game.score, { placeholder: "Score" });
    score.inputMode = "numeric";
    score.autocomplete = "off";
    score.enterKeyHint = "next";
    score.maxLength = 3;
    score.dataset.bowlingScore = "true";
    const error = element("small", "bowling-field-error", "");
    error.id = `${scoreId}-error`;
    score.setAttribute("aria-describedby", error.id);
    const showValidity = () => {
      const valid = bowlingParseScore(score.value).valid;
      score.toggleAttribute("aria-invalid", !valid);
      if (!valid) score.setAttribute("aria-invalid", "true");
      error.textContent = valid ? "" : "Use a whole number from 0 to 300, or leave blank.";
    };
    score.addEventListener("input", () => {
      game.score = score.value;
      showValidity();
      updateTotals();
    });
    if (game.score) showValidity();
    scoreField.append(scoreLabel, score, error);
    const actions = element("div", "bowling-game-actions");
    const addAdjustment = element("button", "secondary", "+ Adjustment");
    addAdjustment.type = "button";
    addAdjustment.setAttribute("aria-label", `Add adjustment to game ${gameIndex + 1}`);
    addAdjustment.addEventListener("click", () => {
      const adjustment = { id: bowlingId("adj"), ballId: "", move: "", result: "" };
      game.adjustments.push(adjustment);
      bowlingRefresh(`bowling-adj-${adjustment.id}-ball`);
    });
    actions.append(addAdjustment);
    if (draft.games.length > 1) {
      const remove = element("button", "secondary bowling-icon-button", "✕");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove game ${gameIndex + 1}`);
      remove.title = "Remove game";
      remove.addEventListener("click", () => {
        draft.games.splice(gameIndex, 1);
        bowlingRefresh("bowling-add-game");
      });
      actions.append(remove);
    }
    head.append(scoreField, actions);
    item.append(head);
    if (game.adjustments.length) {
      const list = element("ul", "bowling-adjustment-inputs");
      game.adjustments.forEach((adjustment, adjustmentIndex) => {
        const row = element("li", "bowling-adjustment-input");
        const label = `Game ${gameIndex + 1} adjustment ${adjustmentIndex + 1}`;
        row.setAttribute("aria-label", label);
        const snapshot = editing?.games.find((saved) => saved.id === game.id)?.adjustments.find((saved) => saved.id === adjustment.id)?.ball;
        const ball = bowlingBallSelect(`bowling-adj-${adjustment.id}-ball`, adjustment.ballId, "No ball change", state, snapshot);
        ball.addEventListener("change", () => { adjustment.ballId = ball.value; });
        const move = bowlingInput(`bowling-adj-${adjustment.id}-move`, adjustment.move, { maxLength: bowlingLimits.move, placeholder: "e.g. Moved 2 boards right", list: "bowling-move-list" });
        move.addEventListener("input", () => { adjustment.move = move.value; });
        const result = bowlingInput(`bowling-adj-${adjustment.id}-result`, adjustment.result, { maxLength: bowlingLimits.result, placeholder: "e.g. Ball read sooner", list: "bowling-result-list" });
        result.addEventListener("input", () => { adjustment.result = result.value; });
        const remove = element("button", "secondary bowling-icon-button", "Remove");
        remove.type = "button";
        remove.setAttribute("aria-label", `Remove ${label.toLowerCase()}`);
        remove.addEventListener("click", () => {
          game.adjustments.splice(adjustmentIndex, 1);
          bowlingRefresh(`bowling-score-${game.id}`);
        });
        row.append(
          bowlingField("Switch to", ball),
          bowlingField("Move / release", move),
          bowlingField("What happened", result),
          remove
        );
        list.append(row);
      });
      item.append(list);
    }
    games.append(item);
  });

  const gameControls = element("div", "bowling-game-controls");
  const addGame = element("button", "secondary", "+ Add game");
  addGame.type = "button";
  addGame.id = "bowling-add-game";
  addGame.disabled = draft.games.length >= bowlingMaxGames;
  addGame.addEventListener("click", () => {
    const game = { id: bowlingId("game"), score: "", adjustments: [] };
    draft.games.push(game);
    bowlingRefresh(`bowling-score-${game.id}`);
  });
  gameControls.append(addGame, totals);

  const notes = document.createElement("textarea");
  notes.id = "bowling-notes";
  notes.rows = 2;
  notes.maxLength = bowlingLimits.notes;
  notes.placeholder = "Lane conditions, pairs, what to try next week";
  notes.value = draft.notes;
  notes.addEventListener("input", () => { draft.notes = notes.value; });

  const footer = element("div", "bowling-form-footer");
  const save = element("button", "", editing ? "Save changes" : "Save session");
  save.type = "submit";
  save.id = "bowling-save";
  footer.append(save);
  if (editing) {
    const cancel = element("button", "secondary", "Cancel edit");
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      bowlingDraft = bowlingNewDraft();
      bowlingStatus.form = "";
      bowlingRefresh("bowling-log-title");
    });
    footer.append(cancel);
  } else if (draft.games.some((game) => game.score || game.adjustments.length) || draft.notes || draft.center) {
    const clear = element("button", "secondary", "Clear");
    clear.type = "button";
    clear.addEventListener("click", () => {
      bowlingDraft = bowlingNewDraft();
      bowlingStatus.form = "";
      bowlingRefresh("bowling-date");
    });
    footer.append(clear);
  }
  const status = element("p", `bowling-status${bowlingStatus.formError ? " error" : ""}`, bowlingStatus.form);
  status.id = "bowling-form-status";
  status.tabIndex = -1;
  status.setAttribute("role", "status");
  footer.append(status);

  form.append(
    meta, games, gameControls, bowlingField("Session notes", notes), footer,
    bowlingDatalist("bowling-move-list", bowlingMoveSuggestions),
    bowlingDatalist("bowling-result-list", bowlingResultSuggestions)
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    bowlingSaveDraft(form);
  });
  updateTotals();
  panel.append(title, form);
  return panel;
}

function bowlingSetFormStatus(message, isError) {
  bowlingStatus.form = message;
  bowlingStatus.formError = isError;
  const status = document.getElementById("bowling-form-status");
  if (status) {
    status.textContent = message;
    status.classList.toggle("error", isError);
  }
}

function bowlingSaveDraft(form) {
  const draft = bowlingDraft;
  const state = bowlingGetState();
  const dateInput = form.querySelector("#bowling-date");
  if (!bowlingValidDate(draft.date)) {
    dateInput?.setAttribute("aria-invalid", "true");
    bowlingSetFormStatus("Choose a valid date.", true);
    dateInput?.focus();
    return;
  }
  dateInput?.removeAttribute("aria-invalid");
  const invalidGame = draft.games.find((game) => !bowlingParseScore(game.score).valid);
  if (invalidGame) {
    bowlingSetFormStatus("Fix the highlighted score: whole numbers from 0 to 300, or blank for unfinished games.", true);
    document.getElementById(`bowling-score-${invalidGame.id}`)?.focus();
    return;
  }
  const existing = draft.id ? state.sessions.find((session) => session.id === draft.id) : null;
  const ballsById = new Map(state.balls.map((ball) => [ball.id, ball]));
  // Keep the ball details recorded at the time unless a different ball is chosen.
  const snapshotFor = (ballId, previous) => {
    if (!ballId) return null;
    if (previous?.id === ballId) return previous;
    return bowlingBallSnapshot(ballsById.get(ballId)) || previous || null;
  };
  const games = draft.games.map((game) => {
    const savedGame = existing?.games.find((saved) => saved.id === game.id);
    const score = bowlingParseScore(game.score).score;
    // Editing a tracked game's total by hand drops its frames, since they no longer add up.
    const frames = savedGame?.frames && savedGame.score === score ? { frames: savedGame.frames } : {};
    return {
      ...frames,
      id: game.id,
      score,
      adjustments: game.adjustments.map((adjustment) => {
        const savedAdjustment = savedGame?.adjustments.find((saved) => saved.id === adjustment.id);
        return {
          id: adjustment.id,
          ball: snapshotFor(adjustment.ballId, savedAdjustment?.ball),
          move: adjustment.move.trim(),
          result: adjustment.result.trim()
        };
      }).filter((adjustment) => adjustment.ball || adjustment.move || adjustment.result)
    };
  });
  const saved = bowlingCommit((next, now) => {
    const session = {
      id: existing?.id || bowlingId("session"),
      date: draft.date,
      type: draft.type,
      league: bowlingLeagueRef(state, draft.leagueId, existing?.league),
      center: draft.center.trim(),
      startBall: snapshotFor(draft.startBallId, existing?.startBall),
      notes: draft.notes.trim(),
      games,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    next.sessions = next.sessions.filter((item) => item.id !== session.id);
    next.sessions.push(session);
  });
  bowlingDraft = bowlingNewDraft();
  bowlingStatus.form = saved ? (existing ? "Session updated." : "Session saved.") : "Saved for this visit only; browser storage is unavailable.";
  bowlingStatus.formError = !saved;
  bowlingRefresh("bowling-form-status");
}

function createBowlingDashboard(state) {
  const panel = element("section", "bowling-panel bowling-dashboard");
  panel.setAttribute("aria-labelledby", "bowling-dashboard-title");
  const head = element("div", "bowling-panel-head");
  const title = element("h3", "", "League night dashboard");
  title.id = "bowling-dashboard-title";
  const logButton = element("button", "bowling-log-jump", "Log session");
  logButton.type = "button";
  logButton.addEventListener("click", bowlingJumpToLog);
  const actions = element("div", "bowling-head-actions");
  actions.append(createBowlingScorerLink(), logButton);
  head.append(title, actions);
  const overall = bowlingOverall(state.sessions);
  const metrics = element("div", "bowling-metrics");
  for (const [label, value, note] of [
    ["Average", bowlingFormatAverage(overall.average), "Per scored game"],
    ["Games bowled", String(overall.games), `${state.sessions.length} session${state.sessions.length === 1 ? "" : "s"}`],
    ["High game", overall.high === null ? "—" : String(overall.high), ""],
    ["High series", overall.highSeries === null ? "—" : String(overall.highSeries), "Three-game series"]
  ]) {
    const metric = element("div", "bowling-metric");
    metric.append(element("span", "", label), element("strong", "", value));
    if (note) metric.append(element("small", "", note));
    metrics.append(metric);
  }
  panel.append(head, metrics);
  const tracked = bowlingFrameStats(state.sessions);
  if (tracked.games) {
    const line = element("p", "bowling-tracked-line");
    const spares = tracked.chances ? ` · ${bowlingPercent(tracked.spares, tracked.chances)} of spares converted` : "";
    line.append(`From ${tracked.games} tracked game${tracked.games === 1 ? "" : "s"}: ${bowlingPercent(tracked.strikes, tracked.firstBalls)} strikes${spares}. `);
    const link = element("a", "", "See spares and leaves");
    link.href = "#bowling/scorer";
    line.append(link);
    panel.append(line);
  }
  panel.append(createBowlingTrend(state));
  return panel;
}

function createBowlingTrend(state) {
  const wrapper = element("figure", "bowling-trend");
  const series = state.sessions
    .map((session) => ({ session, summary: bowlingSeriesSummary(session) }))
    .filter((item) => item.summary.complete)
    .sort((a, b) => a.session.date.localeCompare(b.session.date) || bowlingTime(a.session.createdAt) - bowlingTime(b.session.createdAt));
  const caption = element("figcaption", "");
  caption.append(element("strong", "", "Series trend"), element("span", "", series.length
    ? ` · ${series.length} completed three-game series. Other sessions still count toward your average.`
    : ""));
  wrapper.append(caption);
  if (!series.length) {
    wrapper.append(element("p", "bowling-empty", "Your trend appears after you log a three-game series with all three scores."));
    return wrapper;
  }
  // A narrower drawing on phones keeps axis labels legible after scaling.
  const width = matchMedia("(max-width: 560px)").matches ? 360 : 640;
  const height = 190;
  const pad = { top: 16, right: 18, bottom: 28, left: 44 };
  const totals = series.map((item) => item.summary.total);
  let min = Math.floor((Math.min(...totals) - 20) / 50) * 50;
  let max = Math.ceil((Math.max(...totals) + 20) / 50) * 50;
  min = Math.max(0, min);
  max = Math.min(900, Math.max(max, min + 50));
  const x = (index) => series.length === 1
    ? pad.left + (width - pad.left - pad.right) / 2
    : pad.left + index * (width - pad.left - pad.right) / (series.length - 1);
  const y = (value) => pad.top + (max - value) * (height - pad.top - pad.bottom) / (max - min);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "bowling-chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Series totals over time, ${series.length} series from ${totals[0]} to ${totals[totals.length - 1]}`);
  const svgNode = (tag, attributes, text) => {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const step = (max - min) / 2;
  for (const value of [min, min + step, max]) {
    svg.append(
      svgNode("line", { x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value), class: "bowling-chart-grid" }),
      svgNode("text", { x: pad.left - 8, y: y(value) + 4, "text-anchor": "end", class: "bowling-chart-axis" }, String(Math.round(value)))
    );
  }
  if (series.length > 1) {
    svg.append(svgNode("polyline", {
      points: series.map((item, index) => `${x(index)},${y(item.summary.total)}`).join(" "),
      class: "bowling-chart-line"
    }));
  }
  const labelIndexes = new Set([0, series.length - 1]);
  const tooltip = element("div", "bowling-chart-tooltip");
  tooltip.hidden = true;
  series.forEach((item, index) => {
    const label = `${bowlingFormatDate(item.session.date)}: ${item.summary.total} series (${item.summary.scores.join(", ")})`;
    const point = svgNode("circle", { cx: x(index), cy: y(item.summary.total), r: 5, class: "bowling-chart-point", tabindex: "0", "aria-label": label });
    const hit = svgNode("circle", { cx: x(index), cy: y(item.summary.total), r: 14, class: "bowling-chart-hit" });
    const show = () => {
      tooltip.textContent = label;
      tooltip.hidden = false;
      tooltip.style.left = `${x(index) / width * 100}%`;
      tooltip.style.top = `${y(item.summary.total) / height * 100}%`;
    };
    const hide = () => { tooltip.hidden = true; };
    for (const node of [hit, point]) {
      node.addEventListener("pointerenter", show);
      node.addEventListener("pointerleave", hide);
    }
    point.addEventListener("focus", show);
    point.addEventListener("blur", hide);
    svg.append(hit, point);
    if (labelIndexes.has(index)) {
      svg.append(svgNode("text", {
        x: x(index), y: height - 8,
        "text-anchor": series.length === 1 ? "middle" : index === 0 ? "start" : "end",
        class: "bowling-chart-axis"
      }, bowlingFormatDate(item.session.date, { month: "short", day: "numeric" })));
    }
  });
  const plot = element("div", "bowling-chart-plot");
  plot.append(svg, tooltip);
  const details = element("details", "bowling-chart-data");
  details.append(element("summary", "", "Show series data"));
  const table = element("table", "");
  const headRow = element("tr", "");
  ["Date", "Games", "Series"].forEach((text) => headRow.append(element("th", "", text)));
  const thead = element("thead", "");
  thead.append(headRow);
  const tbody = element("tbody", "");
  for (const item of series.slice().reverse()) {
    const row = element("tr", "");
    row.append(
      element("td", "", bowlingFormatDate(item.session.date, { month: "short", day: "numeric", year: "numeric" })),
      element("td", "", item.summary.scores.join(" · ")),
      element("td", "", String(item.summary.total))
    );
    tbody.append(row);
  }
  table.append(thead, tbody);
  details.append(table);
  wrapper.append(plot, details);
  return wrapper;
}

function bowlingBallLine(prefix, ref, ballsById) {
  const line = element("p", "bowling-ball-line");
  line.append(element("span", "bowling-ball-label", prefix), element("strong", "", ref.name));
  const details = bowlingBallDetails(ref);
  if (details) line.append(element("span", "bowling-ball-specs", details));
  const current = ballsById.get(ref.id);
  if (current?.archived) line.append(element("span", "bowling-badge", "Retired"));
  return line;
}

function createBowlingSessionCard(session, ballsById) {
  const card = element("article", "bowling-session");
  card.dataset.sessionId = session.id;
  const summary = bowlingSeriesSummary(session);
  const head = element("header", "bowling-session-head");
  const when = element("div", "bowling-session-when");
  const time = element("time", "", bowlingFormatDate(session.date));
  time.dateTime = session.date;
  when.append(time, element("span", `bowling-badge bowling-type-${session.type}`, bowlingTypeLabel(session.type)));
  if (session.league) {
    const league = element("a", "bowling-league-name", bowlingLeagueName(bowlingGetState(), session.league));
    league.href = "#bowling/leagues";
    when.append(league);
  }
  if (session.center) when.append(element("span", "bowling-center", session.center));
  const total = element("div", "bowling-session-total");
  total.append(
    element("strong", "", summary.scores.length ? String(summary.total) : "—"),
    element("span", "", `${summary.complete ? "Series" : "Total"} · avg ${bowlingFormatAverage(summary.average)} · ${summary.scores.length}/${session.games.length} scored`)
  );
  head.append(when, total);
  const scores = element("ol", "bowling-score-chips");
  scores.setAttribute("aria-label", "Game scores");
  session.games.forEach((game, index) => {
    const chip = element("li", game.score === null ? "unscored" : "");
    chip.append(element("span", "", `G${index + 1}`), element("strong", "", game.score === null ? "—" : String(game.score)));
    scores.append(chip);
  });
  card.append(head, scores);
  session.games.forEach((game, index) => {
    if (!game.frames) return;
    const details = element("details", "bowling-session-frames");
    details.append(element("summary", "", `Game ${index + 1} frame by frame`),
      createBowlingScoresheet(game.frames, { label: `Game ${index + 1} scoresheet` }));
    card.append(details);
  });
  if (session.startBall) card.append(bowlingBallLine("Started with", session.startBall, ballsById));
  const adjustments = session.games.flatMap((game, index) => game.adjustments.map((adjustment) => ({ adjustment, index })));
  if (adjustments.length) {
    const list = element("ul", "bowling-adjustments");
    list.setAttribute("aria-label", "Adjustments");
    for (const { adjustment, index } of adjustments) {
      const item = element("li", "");
      item.append(element("span", "bowling-adjustment-game", `G${index + 1}`));
      const body = element("div", "bowling-adjustment-body");
      if (adjustment.ball) {
        const ball = element("span", "bowling-adjustment-ball");
        ball.append(document.createTextNode("Switched to "), element("strong", "", adjustment.ball.name));
        const details = bowlingBallDetails(adjustment.ball);
        if (details) ball.append(element("span", "bowling-ball-specs", details));
        body.append(ball);
      }
      if (adjustment.move) body.append(element("span", "bowling-adjustment-move", adjustment.move));
      if (adjustment.result) body.append(element("span", "bowling-adjustment-result", `→ ${adjustment.result}`));
      item.append(body);
      list.append(item);
    }
    card.append(list);
  }
  if (session.notes) card.append(element("p", "bowling-session-notes", session.notes));
  const footer = element("div", "item-footer bowling-session-actions");
  const edit = element("button", "secondary", "Edit");
  edit.type = "button";
  edit.setAttribute("aria-label", `Edit session from ${bowlingFormatDate(session.date)}`);
  edit.addEventListener("click", () => {
    bowlingDraft = bowlingDraftFromSession(session);
    bowlingStatus.form = "";
    bowlingRefresh("bowling-log-title");
    document.getElementById("bowling-log")?.scrollIntoView({ block: "start", behavior: bowlingScrollBehavior() });
  });
  const remove = element("button", "secondary bowling-delete", bowlingPendingDelete === session.id ? "Confirm delete" : "Delete");
  remove.type = "button";
  remove.id = `bowling-delete-${session.id}`;
  remove.setAttribute("aria-label", bowlingPendingDelete === session.id
    ? `Confirm deleting session from ${bowlingFormatDate(session.date)}`
    : `Delete session from ${bowlingFormatDate(session.date)}`);
  remove.addEventListener("click", () => {
    if (bowlingPendingDelete !== session.id) {
      bowlingPendingDelete = session.id;
      bowlingRefresh(remove.id);
      return;
    }
    bowlingPendingDelete = null;
    bowlingCommit((next) => {
      next.sessions = next.sessions.filter((item) => item.id !== session.id);
      next.deletedSessionIds = [...new Set([...next.deletedSessionIds, session.id])];
    });
    if (bowlingDraft?.id === session.id) bowlingDraft = bowlingNewDraft();
    bowlingRefresh("bowling-history-title");
  });
  remove.addEventListener("blur", () => {
    // Deferred so the blur caused by re-rendering this card (button detached) is ignored.
    setTimeout(() => {
      if (!remove.isConnected || bowlingPendingDelete !== session.id) return;
      bowlingPendingDelete = null;
      remove.textContent = "Delete";
      remove.setAttribute("aria-label", `Delete session from ${bowlingFormatDate(session.date)}`);
    }, 0);
  });
  footer.append(edit, remove);
  card.append(footer);
  return card;
}

function createBowlingHistory(state) {
  const panel = element("section", "bowling-panel bowling-history");
  panel.setAttribute("aria-labelledby", "bowling-history-title");
  const title = element("h3", "", "History");
  title.id = "bowling-history-title";
  title.tabIndex = -1;
  const known = bowlingKnownBalls(state);
  if (bowlingFilters.ball !== "all" && !known.some((ball) => ball.id === bowlingFilters.ball)) bowlingFilters.ball = "all";
  const filters = element("div", "bowling-filters");
  const type = document.createElement("select");
  type.id = "bowling-filter-type";
  for (const [value, label] of [["all", "All session types"], ...bowlingSessionTypes]) {
    const option = element("option", "", label);
    option.value = value;
    option.selected = bowlingFilters.type === value;
    type.append(option);
  }
  const ball = document.createElement("select");
  ball.id = "bowling-filter-ball";
  const allBalls = element("option", "", "Any ball used");
  allBalls.value = "all";
  ball.append(allBalls);
  for (const item of known) {
    const option = element("option", "", item.archived ? `${item.name} (retired)` : item.name);
    option.value = item.id;
    option.selected = bowlingFilters.ball === item.id;
    ball.append(option);
  }
  const query = bowlingInput("bowling-filter-query", bowlingFilters.query, { type: "search", placeholder: "e.g. read sooner, boards" });
  filters.append(
    bowlingField("Session type", type),
    bowlingField("Ball (start or switch)", ball),
    bowlingField("Search notes & adjustments", query)
  );
  const count = element("p", "bowling-history-count");
  count.setAttribute("aria-live", "polite");
  const list = element("div", "bowling-session-list");
  const ballsById = new Map(state.balls.map((item) => [item.id, item]));
  function renderList() {
    const matches = state.sessions.filter((session) => bowlingSessionMatches(session, bowlingFilters));
    const filtered = bowlingFilters.type !== "all" || bowlingFilters.ball !== "all" || bowlingFilters.query.trim();
    list.replaceChildren();
    count.textContent = filtered
      ? `Showing ${matches.length} of ${state.sessions.length} session${state.sessions.length === 1 ? "" : "s"}`
      : state.sessions.length ? `${state.sessions.length} session${state.sessions.length === 1 ? "" : "s"}, newest first` : "";
    if (!state.sessions.length) {
      const empty = element("div", "bowling-empty");
      empty.append(element("strong", "", "No sessions yet."), element("span", "", " Log tonight’s series and your scores, ball changes, and lane moves will show up here."));
      list.append(empty);
      return;
    }
    if (!matches.length) {
      const empty = element("div", "bowling-empty");
      const clear = element("button", "secondary", "Clear filters");
      clear.type = "button";
      clear.addEventListener("click", () => {
        bowlingFilters = { type: "all", ball: "all", query: "" };
        bowlingRefresh("bowling-filter-type");
      });
      empty.append(element("span", "", "No sessions match these filters. "), clear);
      list.append(empty);
      return;
    }
    matches.forEach((session) => list.append(createBowlingSessionCard(session, ballsById)));
  }
  type.addEventListener("change", () => { bowlingFilters.type = type.value; renderList(); });
  ball.addEventListener("change", () => { bowlingFilters.ball = ball.value; renderList(); });
  query.addEventListener("input", () => { bowlingFilters.query = query.value; renderList(); });
  renderList();
  panel.append(title, ...(state.sessions.length ? [filters] : []), count, list);
  return panel;
}

function createBowlingArsenal(state) {
  const panel = element("section", "bowling-panel bowling-arsenal");
  panel.setAttribute("aria-labelledby", "bowling-arsenal-title");
  const title = element("h3", "", "Arsenal");
  title.id = "bowling-arsenal-title";
  title.tabIndex = -1;
  const draft = bowlingBallDraft || { id: null, name: "", layout: "", surface: "", notes: "" };
  const editing = draft.id ? state.balls.find((ball) => ball.id === draft.id) : null;
  const form = element("form", "bowling-ball-form");
  form.noValidate = true;
  form.setAttribute("aria-label", editing ? `Edit ${editing.name}` : "Add a ball");
  const name = bowlingInput("bowling-ball-name", draft.name, { maxLength: bowlingLimits.ballName, placeholder: "e.g. Black Venom" });
  name.required = true;
  const layout = bowlingInput("bowling-ball-layout", draft.layout, { maxLength: bowlingLimits.layout, placeholder: "e.g. 5 × 4.5 × 3.5" });
  const surface = bowlingInput("bowling-ball-surface", draft.surface, { maxLength: bowlingLimits.surface, placeholder: "e.g. 4000 grit + polish" });
  const notes = bowlingInput("bowling-ball-notes", draft.notes, { maxLength: bowlingLimits.ballNotes, placeholder: "Optional" });
  const keepDraft = () => {
    bowlingBallDraft = { id: draft.id, name: name.value, layout: layout.value, surface: surface.value, notes: notes.value };
  };
  [name, layout, surface, notes].forEach((input) => input.addEventListener("input", keepDraft));
  const actions = element("div", "bowling-form-footer");
  const save = element("button", "", editing ? "Save ball" : "Add ball");
  save.type = "submit";
  actions.append(save);
  if (editing) {
    const cancel = element("button", "secondary", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      bowlingBallDraft = null;
      bowlingStatus.ball = "";
      bowlingRefresh("bowling-ball-name");
    });
    actions.append(cancel);
  }
  const status = element("p", `bowling-status${bowlingStatus.ballError ? " error" : ""}`, bowlingStatus.ball);
  status.id = "bowling-ball-status";
  status.setAttribute("role", "status");
  actions.append(status);
  form.append(
    element("p", "bowling-form-title", editing ? `Editing ${editing.name}` : "Add a ball"),
    bowlingField("Ball name", name),
    bowlingField("Layout", layout),
    bowlingField("Surface", surface),
    bowlingField("Notes", notes),
    actions
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const ballName = name.value.trim();
    if (!ballName) {
      name.setAttribute("aria-invalid", "true");
      bowlingStatus.ball = "Enter a ball name.";
      bowlingStatus.ballError = true;
      status.textContent = bowlingStatus.ball;
      status.classList.add("error");
      name.focus();
      return;
    }
    bowlingCommit((next, now) => {
      const previous = editing ? next.balls.find((ball) => ball.id === editing.id) : null;
      const ball = {
        id: previous?.id || bowlingId("ball"),
        name: ballName,
        layout: layout.value.trim(),
        surface: surface.value.trim(),
        notes: notes.value.trim(),
        archived: previous?.archived || false,
        catalog: previous?.catalog || null,
        createdAt: previous?.createdAt || now,
        updatedAt: now
      };
      next.balls = next.balls.filter((item) => item.id !== ball.id);
      next.balls.push(ball);
    });
    bowlingBallDraft = null;
    bowlingStatus.ball = editing ? `${ballName} updated. Past sessions keep the details recorded that night.` : `${ballName} added to your arsenal.`;
    bowlingStatus.ballError = false;
    bowlingRefresh("bowling-ball-name");
  });

  const missingStarters = bowlingStarterBalls.filter(([id]) => !state.balls.some((ball) => ball.id === id));
  const starters = element("div", "bowling-starters");
  if (missingStarters.length) {
    starters.append(element("span", "", state.balls.length ? "Quick add:" : "Start with:"));
    for (const [id, starterName] of missingStarters) {
      const add = element("button", "secondary", `+ ${starterName}`);
      add.type = "button";
      add.addEventListener("click", () => {
        bowlingCommit((next, now) => {
          if (next.balls.some((ball) => ball.id === id)) return;
          next.balls.push({ id, name: starterName, layout: "", surface: "", notes: "", archived: false, createdAt: now, updatedAt: now });
        });
        bowlingStatus.ball = `${starterName} added. Add its layout and surface whenever you like.`;
        bowlingStatus.ballError = false;
        bowlingRefresh("bowling-arsenal-title");
      });
      starters.append(add);
    }
  }

  const list = element("ul", "bowling-ball-list");
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const ordered = [...state.balls.filter((ball) => !ball.archived).sort(byName), ...state.balls.filter((ball) => ball.archived).sort(byName)];
  for (const ball of ordered) {
    const item = element("li", `bowling-ball${ball.archived ? " archived" : ""}`);
    const info = element("div", "bowling-ball-info");
    const heading = element("strong", "", ball.name);
    info.append(heading);
    if (ball.archived) info.append(element("span", "bowling-badge", "Retired"));
    const specs = [ball.layout && `Layout ${ball.layout}`, ball.surface && `Surface ${ball.surface}`].filter(Boolean).join(" · ");
    info.append(element("small", "", specs || "No layout or surface recorded"));
    if (ball.notes) info.append(element("small", "", ball.notes));
    if (ball.catalog) info.append(element("small", "bowling-ball-catalog", bowlingCatalogSummary(ball.catalog)));
    const used = state.sessions.filter((session) => bowlingSessionUsesBall(session, ball.id)).length;
    if (used) info.append(element("small", "", `Used in ${used} session${used === 1 ? "" : "s"}`));
    const buttons = element("div", "item-footer");
    if (!ball.catalog) {
      const find = element("a", "bowling-find-specs", "Find specs");
      find.href = "#bowling/balls";
      find.setAttribute("aria-label", `Find ${ball.name} in the ball database`);
      find.addEventListener("click", () => {
        bowlingCatalogFilters = { ...bowlingCatalogDefaults, query: ball.name };
        bowlingCatalogLimit = 30;
      });
      buttons.append(find);
    }
    const edit = element("button", "secondary", "Edit");
    edit.type = "button";
    edit.setAttribute("aria-label", `Edit ${ball.name}`);
    edit.addEventListener("click", () => {
      bowlingBallDraft = { id: ball.id, name: ball.name, layout: ball.layout, surface: ball.surface, notes: ball.notes };
      bowlingStatus.ball = "";
      bowlingRefresh("bowling-ball-name");
    });
    const archive = element("button", "secondary", ball.archived ? "Restore" : "Retire");
    archive.type = "button";
    archive.id = `bowling-archive-${ball.id}`;
    archive.setAttribute("aria-label", `${ball.archived ? "Restore" : "Retire"} ${ball.name}`);
    archive.addEventListener("click", () => {
      bowlingCommit((next, now) => {
        const target = next.balls.find((itemBall) => itemBall.id === ball.id);
        if (target) {
          target.archived = !ball.archived;
          target.updatedAt = now;
        }
      });
      bowlingStatus.ball = ball.archived ? `${ball.name} is back in your active arsenal.` : `${ball.name} retired. Past sessions still show it.`;
      bowlingStatus.ballError = false;
      bowlingRefresh(archive.id);
    });
    buttons.append(edit, archive);
    item.append(info, buttons);
    list.append(item);
  }
  const children = [title];
  if (!state.balls.length) children.push(element("p", "bowling-empty", "Your arsenal is empty. Add the balls you carry so you can track starts and switches."));
  if (missingStarters.length) children.push(starters);
  if (state.balls.length) children.push(list);
  children.push(form);
  panel.append(...children);
  return panel;
}

function bowlingScrollBehavior() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function bowlingJumpToLog() {
  const log = document.getElementById("bowling-log");
  if (!log) return;
  log.scrollIntoView({ block: "start", behavior: bowlingScrollBehavior() });
  document.getElementById("bowling-date")?.focus({ preventScroll: true });
}

// ---------- Ball database and release calendar ----------

const bowlingCatalogUrl = "data/bowling-balls.json";
const bowlingCatalogDefaults = { query: "", brand: "all", cover: "all", symmetry: "all", year: "all" };
let bowlingCatalogFilters = { ...bowlingCatalogDefaults };
let bowlingCatalogLimit = 30;
let bowlingCatalogPromise = null;
let bowlingCatalog = null;
let bowlingCatalogFailed = false;
let bowlingCatalogStatus = "";
let bowlingCalendarState = { month: "", day: "", brand: "all" };

function bowlingValidCatalogBall(ball) {
  return ball && typeof ball === "object" && typeof ball.id === "string" && typeof ball.name === "string" && ball.name &&
    typeof ball.brand === "string" && bowlingValidDate(ball.releaseDate) &&
    typeof ball.url === "string" && ball.url.startsWith("https://");
}

function bowlingLoadCatalog() {
  if (!bowlingCatalogPromise) {
    bowlingCatalogFailed = false;
    bowlingCatalogPromise = fetch(bowlingCatalogUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Ball data request failed (${response.status}).`);
        return response.json();
      })
      .then((data) => {
        if (!data || !Array.isArray(data.balls)) throw new TypeError("Ball data has an unexpected format.");
        bowlingCatalog = {
          generatedAt: typeof data.generatedAt === "string" ? data.generatedAt : "",
          sources: Array.isArray(data.sources) ? data.sources : [],
          missingBrands: Array.isArray(data.missingBrands) ? data.missingBrands : [],
          notes: Array.isArray(data.notes) ? data.notes.filter((note) => typeof note === "string") : [],
          minimumReleaseDate: bowlingValidDate(data.minimumReleaseDate) ? data.minimumReleaseDate : "2020-01-01",
          balls: data.balls.filter(bowlingValidCatalogBall)
            .map((ball) => ({ ...ball, rg: bowlingSpecNumber(ball.rg), diff: bowlingSpecNumber(ball.diff), intDiff: bowlingSpecNumber(ball.intDiff) }))
            .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name))
        };
        return bowlingCatalog;
      })
      .catch((error) => {
        console.error("Could not load the bowling ball database.", error);
        bowlingCatalogPromise = null;
        bowlingCatalogFailed = true;
        throw error;
      });
  }
  return bowlingCatalogPromise;
}

// Some sources (Bowling.com for Motiv) give only a release month.
function bowlingReleaseLabel(ball, style = "short") {
  if (ball.releaseDatePrecision === "month") {
    return bowlingFormatDate(ball.releaseDate, { month: style === "long" ? "long" : "short", year: "numeric" });
  }
  return bowlingFormatDate(ball.releaseDate, { month: style === "long" ? "long" : "short", day: "numeric", year: "numeric" });
}

function bowlingFormatSpec(value) {
  return value === null || value === undefined ? "—" : value.toFixed(3);
}

function bowlingCoverLabel(type) {
  return bowlingCoverTypes.find(([value]) => value === type)?.[1] || "";
}

function bowlingCatalogSummary(catalog) {
  const parts = [catalog.brand, bowlingCoverLabel(catalog.coverType),
    catalog.symmetry ? (catalog.symmetry === "asymmetric" ? "Asymmetric" : "Symmetric") : ""];
  if (catalog.rg !== null) parts.push(`RG ${bowlingFormatSpec(catalog.rg)}`);
  if (catalog.diff !== null) parts.push(`Diff ${bowlingFormatSpec(catalog.diff)}`);
  if (catalog.symmetry === "asymmetric" && catalog.intDiff !== null) parts.push(`Int. diff ${bowlingFormatSpec(catalog.intDiff)}`);
  const summary = parts.filter(Boolean).join(" · ");
  return catalog.weight && catalog.rg !== null ? `${summary} (${catalog.weight} lb)` : summary;
}

function bowlingCatalogSnapshot(ball) {
  return bowlingNormalizeCatalogRef({ ...ball, id: ball.id });
}

function bowlingCatalogMatches(ball, filters) {
  if (filters.brand !== "all" && ball.brand !== filters.brand) return false;
  if (filters.cover !== "all" && ball.coverType !== filters.cover) return false;
  if (filters.symmetry !== "all" && ball.symmetry !== filters.symmetry) return false;
  if (filters.year !== "all" && !ball.releaseDate.startsWith(filters.year)) return false;
  const words = filters.query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [ball.brand, ball.name, ball.core, ball.coverstock, ball.coverTypeLabel].filter(Boolean).join(" ").toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

function bowlingSelect(id, options, value) {
  const select = document.createElement("select");
  select.id = id;
  for (const [optionValue, label] of options) {
    const option = element("option", "", label);
    option.value = optionValue;
    option.selected = optionValue === value;
    select.append(option);
  }
  return select;
}

function bowlingCatalogImage(ball, className) {
  if (!ball.image || !ball.image.startsWith("https://")) return element("span", `${className} is-empty`);
  const image = element("img", className);
  image.src = ball.image;
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => image.replaceWith(element("span", `${className} is-empty`)), { once: true });
  return image;
}

function bowlingExternalLink(text, url, label) {
  const link = element("a", "bowling-external", text);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  if (label) link.setAttribute("aria-label", label);
  return link;
}

function bowlingAddCatalogBall(ball) {
  const catalog = bowlingCatalogSnapshot(ball);
  const state = bowlingGetState();
  const sameName = state.balls.find((item) => !item.catalog && item.name.toLocaleLowerCase() === ball.name.toLocaleLowerCase());
  bowlingCommit((next, now) => {
    if (sameName) {
      const target = next.balls.find((item) => item.id === sameName.id);
      if (target) {
        target.catalog = catalog;
        target.updatedAt = now;
      }
      return;
    }
    next.balls.push({
      id: bowlingId("ball"), name: ball.name.slice(0, bowlingLimits.ballName), layout: "",
      surface: (ball.finish || "").slice(0, bowlingLimits.surface), notes: "", archived: false,
      catalog, createdAt: now, updatedAt: now
    });
  });
  bowlingCatalogStatus = sameName
    ? `Linked specs to ${sameName.name} in your arsenal.`
    : `${ball.name} added to your arsenal${ball.finish ? " with its factory finish as the surface. Update it if the ball has been resurfaced" : ""}.`;
}

function bowlingSourceNote(catalog) {
  const note = element("div", "bowling-catalog-note");
  const generated = Date.parse(catalog.generatedAt);
  const refreshed = Number.isFinite(generated)
    ? ` Last refreshed ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(generated))}.`
    : "";
  note.append(element("p", "", `Specs and release dates come from manufacturer websites, back to ${bowlingFormatDate(catalog.minimumReleaseDate, { month: "long", year: "numeric" })}, and are refreshed daily.${refreshed} RG and differential are for the weight shown (15 lb where listed; Storm, Roto Grip and 900 Global list 16 lb). Intermediate differential is shown for asymmetric balls only.`));
  const problems = catalog.sources.filter((source) => source.status && source.status !== "ok");
  for (const source of problems) {
    note.append(element("p", "bowling-catalog-warning", `${source.brand}: ${source.message || "Not refreshed."}`));
  }
  for (const text of catalog.notes) note.append(element("p", "", text));
  for (const missing of catalog.missingBrands) {
    if (missing?.brand) note.append(element("p", "", `${missing.brand} isn’t included: ${missing.reason || "its data is unavailable."}`));
  }
  return note;
}

function createBowlingCatalogLoading(panel, build) {
  if (bowlingCatalog) {
    build(bowlingCatalog);
    return;
  }
  const status = element("p", "bowling-empty", bowlingCatalogFailed ? "The ball database couldn’t be loaded." : "Loading the ball database…");
  status.setAttribute("role", "status");
  panel.append(status);
  if (bowlingCatalogFailed) {
    const retry = element("button", "secondary", "Try again");
    retry.type = "button";
    retry.addEventListener("click", () => {
      bowlingCatalogFailed = false;
      bowlingRefresh();
      bowlingLoadCatalog().then(() => bowlingRefresh(), () => bowlingRefresh());
    });
    panel.append(retry);
    return;
  }
  bowlingLoadCatalog().then(() => bowlingRefresh(), () => bowlingRefresh());
}

function createBowlingCatalogView() {
  const panel = element("section", "bowling-panel bowling-catalog");
  panel.setAttribute("aria-labelledby", "bowling-catalog-title");
  const title = element("h3", "", "Ball database");
  title.id = "bowling-catalog-title";
  panel.append(title, element("p", "bowling-panel-intro", "Look up a ball’s RG, differential, intermediate differential and cover type, then add it to your arsenal."));
  createBowlingCatalogLoading(panel, (catalog) => {
    const state = bowlingGetState();
    const brands = [...new Set(catalog.balls.map((ball) => ball.brand))].sort();
    const years = [...new Set(catalog.balls.map((ball) => ball.releaseDate.slice(0, 4)))].sort().reverse();
    for (const [key, values] of [["brand", brands], ["year", years]]) {
      if (bowlingCatalogFilters[key] !== "all" && !values.includes(bowlingCatalogFilters[key])) bowlingCatalogFilters[key] = "all";
    }
    const filters = element("div", "bowling-catalog-filters");
    const query = bowlingInput("bowling-catalog-query", bowlingCatalogFilters.query, { type: "search", placeholder: "Ball, core or coverstock" });
    query.autocomplete = "off";
    const brand = bowlingSelect("bowling-catalog-brand", [["all", "All brands"], ...brands.map((item) => [item, item])], bowlingCatalogFilters.brand);
    const cover = bowlingSelect("bowling-catalog-cover", [["all", "All cover types"], ...bowlingCoverTypes], bowlingCatalogFilters.cover);
    const symmetry = bowlingSelect("bowling-catalog-symmetry", [["all", "Any core"], ["symmetric", "Symmetric"], ["asymmetric", "Asymmetric"]], bowlingCatalogFilters.symmetry);
    const year = bowlingSelect("bowling-catalog-year", [["all", "Any year"], ...years.map((item) => [item, item])], bowlingCatalogFilters.year);
    filters.append(
      bowlingField("Search", query), bowlingField("Brand", brand), bowlingField("Cover type", cover),
      bowlingField("Core", symmetry), bowlingField("Released", year)
    );
    const status = element("p", "bowling-status", bowlingCatalogStatus);
    status.setAttribute("role", "status");
    const count = element("p", "bowling-history-count");
    count.setAttribute("aria-live", "polite");
    const list = element("div", "bowling-catalog-list");
    // Infinite scroll: a marker after the list loads the next page when it nears the viewport.
    // The button is only shown where IntersectionObserver isn't available.
    const sentinel = element("div", "bowling-catalog-sentinel");
    sentinel.setAttribute("aria-hidden", "true");
    const more = element("button", "secondary bowling-catalog-more", "");
    more.type = "button";
    const autoLoad = "IntersectionObserver" in window;
    const linked = new Set(state.balls.map((ball) => ball.catalog?.id).filter(Boolean));
    let matches = [];
    let shownCount = 0;

    function showMore() {
      const next = matches.slice(shownCount, bowlingCatalogLimit);
      for (const ball of next) list.append(createBowlingCatalogCard(ball, linked.has(ball.id), state));
      shownCount += next.length;
      const remaining = matches.length - shownCount;
      sentinel.hidden = remaining <= 0;
      more.hidden = autoLoad || remaining <= 0;
      more.textContent = `Show ${Math.min(30, remaining)} more`;
    }

    function renderResults() {
      matches = catalog.balls.filter((ball) => bowlingCatalogMatches(ball, bowlingCatalogFilters));
      shownCount = 0;
      count.textContent = `${matches.length} ball${matches.length === 1 ? "" : "s"}`;
      list.replaceChildren();
      if (!matches.length) {
        const empty = element("div", "bowling-empty");
        const clear = element("button", "secondary", "Clear filters");
        clear.type = "button";
        clear.addEventListener("click", () => {
          bowlingCatalogFilters = { ...bowlingCatalogDefaults };
          bowlingCatalogLimit = 30;
          bowlingRefresh("bowling-catalog-query");
        });
        empty.append(element("span", "", catalog.balls.length ? "No balls match. Check the spelling or clear the filters. " : "No balls are available yet. "), clear);
        list.append(empty);
      }
      showMore();
    }

    const update = () => {
      bowlingCatalogFilters = { query: query.value, brand: brand.value, cover: cover.value, symmetry: symmetry.value, year: year.value };
      bowlingCatalogLimit = 30;
      renderResults();
    };
    query.addEventListener("input", update);
    [brand, cover, symmetry, year].forEach((select) => select.addEventListener("change", update));
    const loadNext = () => {
      if (shownCount >= matches.length) return;
      bowlingCatalogLimit = shownCount + 30;
      showMore();
      // The observer only reports changes, so keep filling while the marker is still near the viewport.
      if (autoLoad && sentinel.isConnected && sentinel.getBoundingClientRect().top < innerHeight + 600) requestAnimationFrame(loadNext);
    };
    more.addEventListener("click", () => {
      const first = shownCount;
      loadNext();
      list.children[first]?.querySelector("a, button")?.focus();
    });
    if (autoLoad) {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadNext();
      }, { rootMargin: "0px 0px 600px 0px" });
      observer.observe(sentinel);
      panel.bowlingCatalogObserver = observer;
    }
    renderResults();
    panel.append(filters, status, count, list, sentinel, more, bowlingSourceNote(catalog));
  });
  return panel;
}

function createBowlingCatalogCard(ball, inArsenal, state) {
  const card = element("article", "bowling-catalog-ball");
  card.append(bowlingCatalogImage(ball, "bowling-catalog-image"));
  const body = element("div", "bowling-catalog-body");
  const heading = element("div", "bowling-catalog-heading");
  heading.append(element("h4", "", ball.name), element("span", "bowling-badge", ball.brand));
  if (ball.coverType) heading.append(element("span", `bowling-badge bowling-cover-${ball.coverType}`, bowlingCoverLabel(ball.coverType)));
  if (ball.discontinued) heading.append(element("span", "bowling-badge", "Discontinued"));
  const meta = element("p", "bowling-catalog-meta", `Released ${bowlingReleaseLabel(ball)}${ball.source ? ` · Specs from ${ball.source} (retailer)` : ""}`);
  const specs = element("dl", "bowling-catalog-specs");
  const addSpec = (label, value, note) => {
    const item = element("div", "");
    item.append(element("dt", "", label), element("dd", "", value));
    if (note) item.lastChild.append(element("small", "", note));
    specs.append(item);
  };
  addSpec("RG", bowlingFormatSpec(ball.rg), ball.rg !== null && ball.weight ? `${ball.weight} lb` : "");
  addSpec("Diff", bowlingFormatSpec(ball.diff));
  addSpec("Int. diff", ball.symmetry === "asymmetric" ? bowlingFormatSpec(ball.intDiff) : "—", ball.symmetry === "symmetric" ? "symmetric" : "");
  const details = element("p", "bowling-catalog-meta");
  details.textContent = [ball.core && `Core: ${ball.core}${ball.symmetry ? ` (${ball.symmetry})` : ""}`, ball.coverstock && `Cover: ${ball.coverstock}`].filter(Boolean).join(" · ");
  const actions = element("div", "item-footer");
  const sameName = state.balls.find((item) => !item.catalog && item.name.toLocaleLowerCase() === ball.name.toLocaleLowerCase());
  if (inArsenal) {
    const badge = element("span", "bowling-badge bowling-in-arsenal", "In your arsenal");
    // Focus lands here after adding, so the page stays where the bowler was scrolled.
    badge.id = `bowling-catalog-in-${ball.id}`;
    badge.tabIndex = -1;
    actions.append(badge);
  } else {
    const add = element("button", "secondary", sameName ? `Add specs to ${sameName.name}` : "Add to arsenal");
    add.type = "button";
    add.id = `bowling-catalog-add-${ball.id}`;
    add.setAttribute("aria-label", sameName ? `Add ${ball.brand} ${ball.name} specs to ${sameName.name} in your arsenal` : `Add ${ball.brand} ${ball.name} to your arsenal`);
    add.addEventListener("click", () => {
      bowlingAddCatalogBall(ball);
      bowlingRefresh(`bowling-catalog-in-${ball.id}`);
    });
    actions.append(add);
  }
  const productPage = !/\/products\/equipment\/bowling-balls\/?$/.test(ball.url);
  if (ball.source) {
    actions.append(bowlingExternalLink(`${ball.source} page ↗`, ball.url, `${ball.brand} ${ball.name} on ${ball.source}`));
  } else {
    actions.append(bowlingExternalLink(productPage ? "Manufacturer page ↗" : `${ball.brand === "Storm" ? "Storm" : "Storm Products"} ball catalog ↗`, ball.url,
      productPage ? `${ball.brand} ${ball.name} on the manufacturer’s site` : "Storm’s bowling ball catalog"));
  }
  body.append(heading, meta, specs);
  if (ball.rg === null) body.append(element("p", "bowling-catalog-meta", "The manufacturer doesn’t list RG or differential for this ball."));
  if (details.textContent) body.append(details);
  body.append(actions);
  card.append(body);
  return card;
}

function bowlingMonthKey(date) {
  return date.slice(0, 7);
}

function bowlingShiftMonth(month, delta) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(year, monthIndex - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function createBowlingReleaseItem(ball) {
  const item = element("li", "game-calendar-release bowling-release");
  item.append(bowlingCatalogImage(ball, "bowling-release-image"));
  const copy = element("div", "game-calendar-release-copy");
  copy.append(bowlingExternalLink(ball.name, ball.url, `${ball.brand} ${ball.name} on the manufacturer’s site`));
  const facts = [ball.brand, bowlingCoverLabel(ball.coverType), ball.symmetry === "asymmetric" ? "Asymmetric" : ball.symmetry === "symmetric" ? "Symmetric" : ""];
  copy.append(element("small", "", facts.filter(Boolean).join(" · ")));
  if (ball.rg !== null) {
    copy.append(element("small", "", `RG ${bowlingFormatSpec(ball.rg)} · Diff ${bowlingFormatSpec(ball.diff)}${ball.symmetry === "asymmetric" && ball.intDiff !== null ? ` · Int. diff ${bowlingFormatSpec(ball.intDiff)}` : ""}`));
  }
  item.append(copy);
  return item;
}

function createBowlingReleaseView() {
  const wrapper = element("div", "bowling-releases");
  const panel = element("section", "bowling-panel game-release-calendar bowling-calendar");
  panel.setAttribute("aria-labelledby", "bowling-calendar-title");
  wrapper.append(panel);
  createBowlingCatalogLoading(panel, (catalog) => {
    const today = bowlingToday();
    const brands = [...new Set(catalog.balls.map((ball) => ball.brand))].sort();
    if (bowlingCalendarState.brand !== "all" && !brands.includes(bowlingCalendarState.brand)) bowlingCalendarState.brand = "all";
    const firstMonth = bowlingMonthKey(catalog.minimumReleaseDate);
    const latest = catalog.balls[0]?.releaseDate || today;
    const lastMonth = [bowlingMonthKey(latest), bowlingMonthKey(today)].sort().pop();
    if (!bowlingCalendarState.month || bowlingCalendarState.month < firstMonth || bowlingCalendarState.month > lastMonth) {
      bowlingCalendarState.month = bowlingMonthKey(today) < firstMonth ? firstMonth : bowlingMonthKey(today) > lastMonth ? lastMonth : bowlingMonthKey(today);
      bowlingCalendarState.day = "";
    }
    const header = element("div", "game-calendar-header");
    const titleBlock = element("div");
    const title = element("h3", "", "Bowling ball release calendar");
    title.id = "bowling-calendar-title";
    titleBlock.append(title, element("p", "", "Release dates from manufacturer websites."));
    const nav = element("div", "game-calendar-nav");
    const previous = element("button", "", "Previous");
    previous.type = "button";
    previous.setAttribute("aria-label", "Show previous month");
    const picker = element("div", "game-calendar-month-picker");
    picker.setAttribute("aria-live", "polite");
    const monthNames = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(2026, index, 1)));
    const monthSelect = bowlingSelect("bowling-calendar-month", monthNames.map((name, index) => [String(index + 1).padStart(2, "0"), name]), "");
    monthSelect.setAttribute("aria-label", "Select month");
    const yearOptions = [];
    for (let year = Number(firstMonth.slice(0, 4)); year <= Number(lastMonth.slice(0, 4)); year++) yearOptions.push([String(year), String(year)]);
    const yearSelect = bowlingSelect("bowling-calendar-year", yearOptions, "");
    yearSelect.setAttribute("aria-label", "Select year");
    picker.append(monthSelect, yearSelect);
    const next = element("button", "", "Next");
    next.type = "button";
    next.setAttribute("aria-label", "Show next month");
    nav.append(previous, picker, next);
    header.append(titleBlock, nav);
    const brand = bowlingSelect("bowling-calendar-brand", [["all", "All brands"], ...brands.map((item) => [item, item])], bowlingCalendarState.brand);
    const brandField = bowlingField("Brand", brand);
    brandField.classList.add("bowling-calendar-brand");
    const grid = element("div", "game-calendar-grid");
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", "Release dates");
    const releases = element("section", "game-calendar-releases");
    releases.setAttribute("aria-live", "polite");
    panel.append(header, brandField, grid, releases, bowlingSourceNote(catalog));

    const filtered = () => catalog.balls.filter((ball) => bowlingCalendarState.brand === "all" || ball.brand === bowlingCalendarState.brand);
    const monthOnly = (month) => filtered().filter((ball) => ball.releaseDatePrecision === "month" && ball.releaseDate.startsWith(`${month}-`));
    function byDate() {
      const map = new Map();
      for (const ball of filtered()) {
        if (ball.releaseDatePrecision === "month") continue;
        if (!map.has(ball.releaseDate)) map.set(ball.releaseDate, []);
        map.get(ball.releaseDate).push(ball);
      }
      return map;
    }
    function defaultDay(map) {
      const days = [...map.keys()].filter((date) => date.startsWith(`${bowlingCalendarState.month}-`)).sort();
      return days.find((date) => date >= today) || days[0] || `${bowlingCalendarState.month}-01`;
    }
    function renderReleases(map) {
      releases.replaceChildren();
      const list = map.get(bowlingCalendarState.day) || [];
      const undated = monthOnly(bowlingCalendarState.month);
      releases.append(element("h4", "", bowlingFormatDate(bowlingCalendarState.day, { weekday: "long", month: "long", day: "numeric", year: "numeric" })));
      if (list.length) {
        const items = element("ul", "game-calendar-release-list");
        list.forEach((ball) => items.append(createBowlingReleaseItem(ball)));
        releases.append(items);
      } else {
        const monthCount = [...map.keys()].filter((date) => date.startsWith(`${bowlingCalendarState.month}-`)).length;
        releases.append(element("p", "game-calendar-status", monthCount ? "No releases listed for this date. Pick a highlighted day."
          : undated.length ? "No exact release dates listed this month." : "No releases listed this month."));
      }
      if (undated.length) {
        releases.append(element("h4", "bowling-month-heading", `Also released in ${bowlingFormatDate(`${bowlingCalendarState.month}-01`, { month: "long", year: "numeric" })} (exact day not listed)`));
        const items = element("ul", "game-calendar-release-list");
        undated.forEach((ball) => items.append(createBowlingReleaseItem(ball)));
        releases.append(items);
      }
    }
    function renderMonth(focusDay) {
      const map = byDate();
      if (!bowlingCalendarState.day.startsWith(`${bowlingCalendarState.month}-`)) bowlingCalendarState.day = defaultDay(map);
      const [year, month] = bowlingCalendarState.month.split("-").map(Number);
      monthSelect.value = String(month).padStart(2, "0");
      yearSelect.value = String(year);
      grid.replaceChildren();
      for (const weekday of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
        const label = element("span", "game-calendar-weekday", weekday);
        label.setAttribute("role", "columnheader");
        grid.append(label);
      }
      const firstWeekday = new Date(year, month - 1, 1).getDay();
      for (let index = 0; index < firstWeekday; index++) {
        const blank = element("span");
        blank.setAttribute("role", "gridcell");
        grid.append(blank);
      }
      const daysInMonth = new Date(year, month, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const date = `${bowlingCalendarState.month}-${String(day).padStart(2, "0")}`;
        const dayBalls = map.get(date) || [];
        const button = element("button", `game-calendar-day${date === today ? " is-today" : ""}`);
        button.type = "button";
        button.dataset.date = date;
        button.setAttribute("role", "gridcell");
        button.setAttribute("aria-pressed", String(date === bowlingCalendarState.day));
        button.setAttribute("aria-label", `${bowlingFormatDate(date, { month: "long", day: "numeric", year: "numeric" })}${dayBalls.length ? `, ${dayBalls.length} release${dayBalls.length === 1 ? "" : "s"}` : ""}`);
        button.append(element("span", "game-calendar-day-number", String(day)));
        if (dayBalls.length) button.append(element("span", "game-calendar-day-count", `${dayBalls.length} ball${dayBalls.length === 1 ? "" : "s"}`));
        button.addEventListener("click", () => {
          bowlingCalendarState.day = date;
          renderMonth(date);
        });
        grid.append(button);
      }
      previous.disabled = bowlingCalendarState.month <= firstMonth;
      next.disabled = bowlingCalendarState.month >= lastMonth;
      renderReleases(map);
      if (focusDay) grid.querySelector(`[data-date="${focusDay}"]`)?.focus();
    }
    const goTo = (month) => {
      bowlingCalendarState.month = month < firstMonth ? firstMonth : month > lastMonth ? lastMonth : month;
      bowlingCalendarState.day = "";
      renderMonth();
    };
    previous.addEventListener("click", () => goTo(bowlingShiftMonth(bowlingCalendarState.month, -1)));
    next.addEventListener("click", () => goTo(bowlingShiftMonth(bowlingCalendarState.month, 1)));
    monthSelect.addEventListener("change", () => goTo(`${yearSelect.value}-${monthSelect.value}`));
    yearSelect.addEventListener("change", () => goTo(`${yearSelect.value}-${monthSelect.value}`));
    brand.addEventListener("change", () => {
      bowlingCalendarState.brand = brand.value;
      bowlingCalendarState.day = "";
      renderMonth();
      renderUpcoming();
    });
    renderMonth();

    const side = element("section", "bowling-panel bowling-upcoming");
    side.setAttribute("aria-labelledby", "bowling-upcoming-title");
    wrapper.append(side);
    function renderUpcoming() {
      side.replaceChildren();
      const thisMonth = bowlingMonthKey(today);
      const isUpcoming = (ball) => ball.releaseDatePrecision === "month" ? bowlingMonthKey(ball.releaseDate) >= thisMonth : ball.releaseDate >= today;
      const upcoming = filtered().filter(isUpcoming).sort((a, b) => a.releaseDate.localeCompare(b.releaseDate)).slice(0, 12);
      const recent = filtered().filter((ball) => !isUpcoming(ball)).slice(0, 8);
      for (const [id, heading, list, empty] of [
        ["bowling-upcoming-title", "Upcoming releases", upcoming, "No upcoming releases announced yet. Manufacturers usually list new balls a few weeks ahead."],
        ["bowling-recent-title", "Recently released", recent, "No recent releases."]
      ]) {
        const title = element("h3", "", heading);
        title.id = id;
        side.append(title);
        if (!list.length) {
          side.append(element("p", "bowling-empty", empty));
          continue;
        }
        const items = element("ul", "game-calendar-release-list");
        for (const ball of list) {
          const item = createBowlingReleaseItem(ball);
          const date = element("button", "secondary bowling-release-date", bowlingReleaseLabel(ball));
          date.type = "button";
          date.setAttribute("aria-label", `Show ${bowlingReleaseLabel(ball, "long")} on the calendar`);
          date.addEventListener("click", () => {
            bowlingCalendarState.month = bowlingMonthKey(ball.releaseDate);
            bowlingCalendarState.day = ball.releaseDatePrecision === "month" ? "" : ball.releaseDate;
            renderMonth(ball.releaseDatePrecision === "month" ? undefined : ball.releaseDate);
            if (ball.releaseDatePrecision === "month") releases.querySelector(".bowling-month-heading")?.scrollIntoView({ block: "nearest" });
          });
          item.append(date);
          items.append(item);
        }
        side.append(items);
      }
    }
    renderUpcoming();
  });
  return wrapper;
}

function bowlingView() {
  const match = /^#bowling\/(scorer|balls|releases|leagues)$/.exec(location.hash);
  return match ? match[1] : "log";
}

function createBowlingTabs(active) {
  const nav = element("nav", "bowling-tabs");
  nav.setAttribute("aria-label", "Bowling sections");
  for (const [view, label, href] of [["log", "League night", "#bowling"], ["scorer", "Score tracker", "#bowling/scorer"], ["balls", "Ball database", "#bowling/balls"], ["releases", "Release calendar", "#bowling/releases"], ["leagues", "League tracker", "#bowling/leagues"]]) {
    const link = element("a", "", label);
    link.href = href;
    if (view === active) link.setAttribute("aria-current", "page");
    nav.append(link);
  }
  return nav;
}

function createBowlingChannel() {
  const view = bowlingView();
  if (view !== "log") {
    const root = element("div", "bowling");
    root.append(createBowlingTabs(view), view === "scorer" ? createBowlingScorerView()
      : view === "leagues" ? createBowlingLeagueView()
      : view === "balls" ? createBowlingCatalogView() : createBowlingReleaseView());
    bowlingRoot = root;
    return root;
  }
  const state = bowlingGetState();
  const root = element("div", "bowling");
  const layout = element("div", "bowling-layout");
  const log = createBowlingSessionForm(state);
  layout.append(log, createBowlingHistory(state), createBowlingArsenal(state));
  const fab = element("button", `bowling-fab${bowlingFabHidden ? " is-hidden" : ""}`, "Log session");
  fab.type = "button";
  fab.tabIndex = bowlingFabHidden ? -1 : 0;
  fab.toggleAttribute("aria-hidden", bowlingFabHidden);
  fab.addEventListener("click", bowlingJumpToLog);
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(([entry]) => {
      bowlingFabHidden = entry.isIntersecting;
      fab.classList.toggle("is-hidden", entry.isIntersecting);
      fab.tabIndex = entry.isIntersecting ? -1 : 0;
      fab.toggleAttribute("aria-hidden", entry.isIntersecting);
    });
    observer.observe(log);
    root.bowlingObserver = observer;
  }
  root.append(createBowlingTabs(view), createBowlingDashboard(state), layout, fab);
  bowlingRoot = root;
  return root;
}
