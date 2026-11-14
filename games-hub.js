// Video Games channel: game log with catalog lookup, time to beat, critic scores and price checks,
// a three-year release calendar, and a sidebar with free games, news and trailers.
// Loaded as a classic script before the main app script; it uses the app's element(), entries,
// saveEntries(), showNotice() and createRedditWidget() at call time, so game entries keep syncing.
const gamesFavoritesKey = "seven-channels.game-release-favorites.v2";
const gamesLegacyFavoritesKey = "seven-channels.game-release-favorites.v1";
const gamesStatuses = [["now", "Playing"], ["next", "Backlog"], ["done", "Finished"]];
const gamesPlatformSuggestions = ["PC", "PS5", "PS4", "Xbox Series X|S", "Xbox One", "Switch 2", "Switch", "Steam Deck", "iOS", "Android", "Mac"];
const gamesCoverUrl = (id, size = "t_cover_small") => `https://images.igdb.com/igdb/image/upload/${size}/${encodeURIComponent(id)}.jpg`;
let gamesRoot = null;
let gamesEditingId = null;
let gamesDraft = null;
let gamesBacklogSort = "added";
let gamesStatus = "";
let gamesStatusError = false;
let gamesCatalogPromise = null;
let gamesCatalog = null;
let gamesCatalogMissing = false;
// The catalog is built during the Pages deploy and isn't committed, so previews of a branch borrow the live site's copy.
const GAMES_LIVE_CATALOG = "https://siballin.github.io/Seven-Channels/data/games-catalog/";
let gamesCatalogBase = "data/games-catalog/";
const gamesShardCache = new Map();
const gamesPriceCache = new Map();
let gamesStoresPromise = null;
let gamesCalendarState = { month: "", day: "", platform: "all", query: "" };
const gamesDataCache = new Map();

function gamesView() {
  return /^#games\/releases$/.test(location.hash) ? "releases" : "log";
}

function gamesToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function gamesFetchJson(path) {
  if (!gamesDataCache.has(path)) {
    const request = fetch(path).then((response) => {
      if (!response.ok) throw new Error(`${path} request failed (${response.status}).`);
      return response.json();
    });
    request.catch(() => gamesDataCache.delete(path));
    gamesDataCache.set(path, request);
  }
  return gamesDataCache.get(path);
}

function gamesRefresh(focusId) {
  if (!gamesRoot?.isConnected) return;
  const activeId = focusId || document.activeElement?.id;
  const previous = gamesRoot;
  const next = createGamesHub();
  previous.replaceWith(next);
  if (activeId) document.getElementById(activeId)?.focus({ preventScroll: !focusId });
}

function gamesSafeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username ? parsed.href : "";
  } catch {
    return "";
  }
}

function gamesLink(text, url, className = "") {
  const href = gamesSafeUrl(url);
  if (!href) return element("span", className, text);
  const link = element("a", className, text);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function gamesFormatDate(value, options = { month: "short", day: "numeric", year: "numeric" }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, options).format(new Date(year, month - 1, day));
}

function gamesTabs(active) {
  const nav = element("nav", "games-tabs");
  nav.setAttribute("aria-label", "Video Games sections");
  for (const [view, label, href] of [["log", "My games", "#games"], ["releases", "Release calendar", "#games/releases"]]) {
    const link = element("a", "", label);
    link.href = href;
    if (view === active) link.setAttribute("aria-current", "page");
    nav.append(link);
  }
  return nav;
}

// ---------- Entries ----------

function gamesEntries() {
  return (typeof entries !== "undefined" ? entries : []).filter((entry) => entry.channel === "games");
}

function gamesNumber(value, min, max) {
  const number = Number(value);
  return value !== "" && value !== null && value !== undefined && Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function gamesValidDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function gamesNewDraft() {
  return { id: null, title: "", status: "next", platform: "", hours: "", rating: "", started: "", finished: "", note: "", game: null };
}

function gamesDraftFrom(entry) {
  return {
    id: entry.id, title: entry.title, status: entry.status, platform: entry.platform || "",
    hours: entry.hours ?? "", rating: entry.rating ?? "", started: entry.started || "", finished: entry.finished || "",
    note: entry.note || "", game: entry.game || null
  };
}

function gamesSave(draft) {
  const title = draft.title.trim().slice(0, 100);
  if (!title) return "Enter a game title.";
  const hours = draft.hours === "" ? null : gamesNumber(draft.hours, 0, 100000);
  if (draft.hours !== "" && hours === null) return "Hours played must be a number from 0 to 100,000.";
  const rating = draft.rating === "" ? null : gamesNumber(draft.rating, 1, 10);
  const finished = draft.status === "done" ? gamesValidDate(draft.finished) : "";
  const record = {
    channel: "games", title, note: draft.note.trim().slice(0, 180), status: draft.status,
    platform: draft.platform.trim().slice(0, 40), hours, rating, started: gamesValidDate(draft.started), finished,
    game: draft.game || null
  };
  if (draft.id) {
    entries = entries.map((entry) => entry.id === draft.id ? { ...entry, ...record } : entry);
  } else {
    const id = globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    entries = [{ id, created: new Date().toLocaleDateString(), ...record }, ...entries];
  }
  return saveEntries() ? "" : "Saved for this visit only; browser storage is unavailable.";
}

// ---------- Catalog (IGDB) ----------

function gamesLoadCatalog() {
  if (!gamesCatalogPromise) {
    const request = (base) => fetch(`${base}index.json`).then((response) => {
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Catalog request failed (${response.status}).`);
      gamesCatalogBase = base;
      return response.json();
    });
    const onLiveSite = location.hostname === new URL(GAMES_LIVE_CATALOG).hostname;
    gamesCatalogPromise = request(gamesCatalogBase)
      .then((data) => data || onLiveSite ? data : request(GAMES_LIVE_CATALOG).catch(() => null))
      .then((data) => {
      if (!data) gamesCatalogMissing = true;
      if (data && Array.isArray(data.games)) {
        gamesCatalog = {
          shards: data.shards || 64, generatedAt: data.generatedAt || "",
          games: data.games.map(([id, name, year, cover]) => ({ id, name, year, cover, key: gamesSearchKey(name) }))
        };
      }
      return gamesCatalog;
    }).catch((error) => {
      console.error("Could not load the game catalog.", error);
      gamesCatalogPromise = null;
      return null;
    });
  }
  return gamesCatalogPromise;
}

function gamesSearchKey(text) {
  return String(text || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function gamesSearch(query, limit = 8) {
  const key = gamesSearchKey(query);
  if (!gamesCatalog || key.length < 2) return [];
  const words = key.split(" ");
  const scored = [];
  for (const game of gamesCatalog.games) {
    if (!words.every((word) => game.key.includes(word))) continue;
    const score = (game.key === key ? 0 : game.key.startsWith(key) ? 1 : 2) * 10000 - (game.year || 0);
    scored.push([score, game]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, game]) => game);
}

function gamesDetails(id) {
  const shard = Number(id) % (gamesCatalog?.shards || 64);
  const path = `${gamesCatalogBase}details-${String(shard).padStart(2, "0")}.json`;
  if (!gamesShardCache.has(path)) gamesShardCache.set(path, gamesFetchJson(path));
  return gamesShardCache.get(path).then((shardData) => shardData[String(id)] || null);
}

// Fields copied onto the entry so cards work offline and keep their details if the catalog changes.
function gamesSnapshot(id, details) {
  return {
    id, name: details.name, cover: details.cover || "", released: details.released || "", platforms: details.platforms || [],
    genres: (details.genres || []).slice(0, 4), url: details.url || "",
    ...(Number.isFinite(details.criticScore) ? { criticScore: details.criticScore, criticCount: details.criticCount } : {}),
    ...(details.timeToBeat ? { timeToBeat: details.timeToBeat } : {})
  };
}

// ---------- Prices (CheapShark) ----------

function gamesStores() {
  if (!gamesStoresPromise) {
    gamesStoresPromise = fetch("https://www.cheapshark.com/api/1.0/stores").then((response) => response.ok ? response.json() : [])
      .then((stores) => new Map(stores.map((store) => [store.storeID, store.storeName]))).catch(() => new Map());
  }
  return gamesStoresPromise;
}

function gamesCheckPrice(title) {
  const key = gamesSearchKey(title);
  if (!gamesPriceCache.has(key)) {
    const request = fetch(`https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(title)}&limit=10`)
      .then((response) => {
        if (!response.ok) throw new Error(`Price lookup failed (${response.status}).`);
        return response.json();
      })
      .then(async (results) => {
        // Prefer an exact title match; otherwise the closest-named result.
        const match = results.find((item) => gamesSearchKey(item.external) === key)
          || results.find((item) => gamesSearchKey(item.external).startsWith(key)) || null;
        if (!match) return { found: false };
        return {
          found: true, name: match.external, price: Number(match.cheapest), store: "",
          dealUrl: match.cheapestDealID ? `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(match.cheapestDealID)}` : "",
          gameId: match.gameID
        };
      })
      .then(async (result) => {
        if (!result.found || !result.gameId) return result;
        // The game detail lists every current deal with its store and discount.
        const response = await fetch(`https://www.cheapshark.com/api/1.0/games?id=${encodeURIComponent(result.gameId)}`);
        if (!response.ok) return result;
        const detail = await response.json();
        const stores = await gamesStores();
        const best = (detail.deals || []).slice().sort((a, b) => Number(a.price) - Number(b.price))[0];
        if (!best) return result;
        return {
          ...result, price: Number(best.price), retail: Number(best.retailPrice), savings: Math.round(Number(best.savings) || 0),
          store: stores.get(String(best.storeID)) || "", dealUrl: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(best.dealID)}`,
          lowest: detail.cheapestPriceEver ? Number(detail.cheapestPriceEver.price) : null
        };
      })
      .catch((error) => {
        gamesPriceCache.delete(key);
        throw error;
      });
    gamesPriceCache.set(key, request);
  }
  return gamesPriceCache.get(key);
}

function gamesPriceLine(container, entry) {
  container.replaceChildren(element("small", "games-price-status", "Checking prices…"));
  gamesCheckPrice(entry.game?.name || entry.title).then((result) => {
    container.replaceChildren();
    if (!result.found) {
      container.append(element("small", "games-price-status", "No PC store prices found."));
      return;
    }
    const money = (value) => Number.isFinite(value) ? value.toLocaleString(undefined, { style: "currency", currency: "USD" }) : "";
    const line = element("small", "games-price");
    line.append(element("strong", "", result.price === 0 ? "Free" : money(result.price)));
    if (result.store) line.append(` at ${result.store}`);
    if (result.savings) line.append(element("span", "games-badge games-badge-deal", `−${result.savings}%`));
    if (Number.isFinite(result.lowest)) line.append(element("span", "games-price-low", ` · lowest ever ${money(result.lowest)}`));
    container.append(line);
    if (result.dealUrl) container.append(gamesLink("View deal ↗", result.dealUrl, "games-external"));
  }).catch(() => {
    container.replaceChildren(element("small", "games-price-status", "Prices couldn’t be loaded. Try again later."));
  });
}

// ---------- My games ----------

function gamesTimeText(ttb) {
  if (!ttb) return "";
  const parts = [["main", "Main"], ["extra", "+Extras"], ["complete", "Completionist"]]
    .filter(([key]) => Number.isFinite(ttb[key])).map(([key, label]) => `${label} ${ttb[key] < 10 ? ttb[key].toFixed(1) : Math.round(ttb[key])}h`);
  return parts.join(" · ");
}

function gamesDashboard(list) {
  const year = new Date().getFullYear();
  const playing = list.filter((entry) => entry.status === "now");
  const backlog = list.filter((entry) => entry.status === "next");
  const finished = list.filter((entry) => entry.status === "done");
  const finishedThisYear = finished.filter((entry) => (entry.finished || "").startsWith(String(year))).length;
  const hours = list.reduce((sum, entry) => sum + (Number.isFinite(entry.hours) ? entry.hours : 0), 0);
  const rated = list.filter((entry) => Number.isFinite(entry.rating));
  const backlogHours = backlog.reduce((sum, entry) => sum + (entry.game?.timeToBeat?.main || 0), 0);
  const withEstimate = backlog.filter((entry) => entry.game?.timeToBeat?.main).length;
  const section = element("section", "games-panel games-dashboard");
  section.setAttribute("aria-label", "Game log summary");
  const grid = element("div", "games-metrics");
  for (const [label, value, note] of [
    ["Playing", String(playing.length), playing[0]?.title || "Nothing right now"],
    ["Backlog", String(backlog.length), withEstimate ? `~${Math.round(backlogHours)}h of main stories${withEstimate < backlog.length ? ` (${withEstimate} of ${backlog.length} estimated)` : ""}` : ""],
    [`Finished in ${year}`, String(finishedThisYear), `${finished.length} finished in all`],
    ["Hours played", hours ? Math.round(hours).toLocaleString() : "0", "From the hours you log"],
    ["Average rating", rated.length ? (rated.reduce((sum, entry) => sum + entry.rating, 0) / rated.length).toFixed(1) : "—", rated.length ? `${rated.length} rated, out of 10` : "Rate games out of 10"]
  ]) {
    const metric = element("div", "games-metric");
    metric.append(element("span", "", label), element("strong", "", value));
    if (note) metric.append(element("small", "", note));
    grid.append(metric);
  }
  section.append(grid);
  return section;
}

function gamesField(label, control) {
  const field = element("div", "field");
  const text = element("label", "", label);
  text.htmlFor = control.id;
  field.append(text, control);
  return field;
}

function gamesInput(id, value, attrs = {}) {
  const input = document.createElement("input");
  input.id = id;
  input.value = value ?? "";
  Object.assign(input, attrs);
  return input;
}

function gamesForm(list) {
  if (!gamesDraft) gamesDraft = gamesNewDraft();
  const draft = gamesDraft;
  const editing = draft.id ? list.find((entry) => entry.id === draft.id) : null;
  if (draft.id && !editing) {
    gamesDraft = gamesNewDraft();
    return gamesForm(list);
  }
  const panel = element("section", "games-panel games-form-panel");
  panel.setAttribute("aria-labelledby", "games-form-title");
  const title = element("h3", "", editing ? `Edit ${editing.title}` : "Add a game");
  title.id = "games-form-title";
  title.tabIndex = -1;
  const form = element("form", "games-form");
  form.noValidate = true;

  // Title with catalog search-as-you-type (a combobox listing matches with cover and year).
  const titleWrap = element("div", "field games-title-field");
  const titleLabel = element("label", "", "Game");
  titleLabel.htmlFor = "games-title";
  const titleInput = gamesInput("games-title", draft.title, { maxLength: 100, autocomplete: "off", placeholder: "Search or type a title" });
  titleInput.setAttribute("role", "combobox");
  titleInput.setAttribute("aria-autocomplete", "list");
  titleInput.setAttribute("aria-expanded", "false");
  titleInput.setAttribute("aria-controls", "games-suggestions");
  const suggestions = element("ul", "games-suggestions");
  suggestions.id = "games-suggestions";
  suggestions.setAttribute("role", "listbox");
  suggestions.hidden = true;
  const catalogNote = element("small", "games-catalog-note", "");
  titleWrap.append(titleLabel, titleInput, suggestions, catalogNote);
  let active = -1;
  let shown = [];
  const closeSuggestions = () => {
    suggestions.hidden = true;
    titleInput.setAttribute("aria-expanded", "false");
    titleInput.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const pick = (game) => {
    closeSuggestions();
    gamesDetails(game.id).then((details) => {
      draft.title = game.name;
      draft.game = details ? gamesSnapshot(game.id, details) : { id: game.id, name: game.name, cover: game.cover || "" };
      if (!draft.platform && draft.game.platforms?.length === 1) draft.platform = draft.game.platforms[0];
      gamesRefresh("games-platform");
    }).catch(() => {
      draft.title = game.name;
      gamesRefresh("games-title");
    });
  };
  const renderSuggestions = () => {
    shown = gamesSearch(titleInput.value);
    suggestions.replaceChildren();
    shown.forEach((game, index) => {
      const item = element("li", "games-suggestion");
      item.id = `games-suggestion-${index}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(index === active));
      if (game.cover) {
        const img = element("img", "");
        img.src = gamesCoverUrl(game.cover, "t_thumb");
        img.alt = "";
        img.addEventListener("error", () => img.replaceWith(element("span", "games-cover-empty")), { once: true });
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        item.append(img);
      } else item.append(element("span", "games-cover-empty"));
      item.append(element("span", "", game.name), element("small", "", game.year ? String(game.year) : ""));
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        pick(game);
      });
      suggestions.append(item);
    });
    const open = shown.length > 0;
    suggestions.hidden = !open;
    titleInput.setAttribute("aria-expanded", String(open));
  };
  titleInput.addEventListener("focus", () => {
    gamesLoadCatalog().then(() => {
      catalogNote.textContent = gamesCatalog ? "" : gamesCatalogMissing ? "Game lookup isn’t set up yet, so details are typed in by hand." : "";
    });
  });
  titleInput.addEventListener("input", () => {
    draft.title = titleInput.value;
    if (draft.game && gamesSearchKey(draft.game.name) !== gamesSearchKey(titleInput.value)) draft.game = null;
    active = -1;
    gamesLoadCatalog().then(renderSuggestions);
  });
  titleInput.addEventListener("keydown", (event) => {
    if (suggestions.hidden) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = (active + (event.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
      [...suggestions.children].forEach((item, index) => item.setAttribute("aria-selected", String(index === active)));
      titleInput.setAttribute("aria-activedescendant", `games-suggestion-${active}`);
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      pick(shown[active]);
    } else if (event.key === "Escape") {
      closeSuggestions();
    }
  });
  titleInput.addEventListener("blur", () => setTimeout(closeSuggestions, 150));

  const status = document.createElement("select");
  status.id = "games-status";
  for (const [value, label] of gamesStatuses) status.append(new Option(label, value, false, value === draft.status));
  status.addEventListener("change", () => {
    draft.status = status.value;
    if (draft.status === "done" && !draft.finished) draft.finished = gamesToday();
    gamesRefresh("games-status");
  });
  const platform = gamesInput("games-platform", draft.platform, { maxLength: 40, placeholder: "e.g. PS5" });
  platform.setAttribute("list", "games-platform-list");
  const platformList = element("datalist", "");
  platformList.id = "games-platform-list";
  [...new Set([...(draft.game?.platforms || []), ...gamesPlatformSuggestions])].forEach((name) => platformList.append(new Option(name)));
  platform.addEventListener("input", () => { draft.platform = platform.value; });
  const hours = gamesInput("games-hours", draft.hours, { type: "number", min: "0", step: "0.5", inputMode: "decimal", placeholder: "Optional" });
  hours.addEventListener("input", () => { draft.hours = hours.value; });
  const rating = document.createElement("select");
  rating.id = "games-rating";
  rating.append(new Option("Not rated", ""));
  for (let score = 10; score >= 1; score--) rating.append(new Option(`${score} / 10`, String(score), false, String(draft.rating) === String(score)));
  rating.addEventListener("change", () => { draft.rating = rating.value; });
  const started = gamesInput("games-started", draft.started, { type: "date" });
  started.addEventListener("input", () => { draft.started = started.value; });
  const finished = gamesInput("games-finished", draft.finished, { type: "date" });
  finished.addEventListener("input", () => { draft.finished = finished.value; });
  const note = gamesInput("games-note", draft.note, { maxLength: 180, placeholder: "Optional" });
  note.addEventListener("input", () => { draft.note = note.value; });

  const grid = element("div", "games-form-grid");
  grid.append(gamesField("Status", status), gamesField("Platform", platform), gamesField("Hours played", hours),
    gamesField("Your rating", rating), gamesField("Started", started));
  if (draft.status === "done") grid.append(gamesField("Finished", finished));
  grid.append(gamesField("Note", note), platformList);

  const preview = draft.game ? gamesPreview(draft.game) : null;
  const footer = element("div", "games-form-footer");
  const save = element("button", "", editing ? "Save changes" : "Add game");
  save.type = "submit";
  save.id = "games-save";
  footer.append(save);
  if (editing || draft.title) {
    const cancel = element("button", "secondary", editing ? "Cancel edit" : "Clear");
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      gamesDraft = gamesNewDraft();
      gamesStatus = "";
      gamesRefresh("games-title");
    });
    footer.append(cancel);
  }
  const message = element("p", `games-status${gamesStatusError ? " error" : ""}`, gamesStatus);
  message.id = "games-form-status";
  message.setAttribute("role", "status");
  message.tabIndex = -1;
  footer.append(message);
  form.append(titleWrap, ...(preview ? [preview] : []), grid, footer);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const error = gamesSave(draft);
    if (error && !error.startsWith("Saved")) {
      gamesStatus = error;
      gamesStatusError = true;
      message.textContent = error;
      message.classList.add("error");
      (draft.title.trim() ? hours : titleInput).focus();
      return;
    }
    gamesStatus = error || (editing ? `${draft.title.trim()} updated.` : `${draft.title.trim()} added to ${gamesStatuses.find(([v]) => v === draft.status)[1].toLowerCase()}.`);
    gamesStatusError = Boolean(error);
    gamesDraft = gamesNewDraft();
    gamesRefresh("games-form-status");
  });
  panel.append(title, form);
  return panel;
}

function gamesCover(game, className = "games-cover") {
  if (!game?.cover) return element("span", `${className} games-cover-empty`);
  const img = element("img", className);
  img.src = gamesCoverUrl(game.cover);
  img.alt = "";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => img.replaceWith(element("span", `${className} games-cover-empty`)), { once: true });
  return img;
}

function gamesFacts(game) {
  const facts = element("div", "games-facts");
  if (Number.isFinite(game.criticScore)) {
    const score = element("span", `games-score ${game.criticScore >= 85 ? "is-high" : game.criticScore >= 70 ? "is-mid" : "is-low"}`, `Critics ${game.criticScore}`);
    score.title = `Average of ${game.criticCount} critic reviews (IGDB)`;
    facts.append(score);
  }
  const time = gamesTimeText(game.timeToBeat);
  if (time) facts.append(element("span", "", `⏱ ${time}`));
  if (game.released) facts.append(element("span", "", gamesFormatDate(game.released)));
  if (game.genres?.length) facts.append(element("span", "", game.genres.slice(0, 3).join(", ")));
  return facts;
}

function gamesPreview(game) {
  const card = element("div", "games-preview");
  card.append(gamesCover(game, "games-cover games-cover-large"));
  const body = element("div", "games-preview-body");
  body.append(element("strong", "", game.name), gamesFacts(game));
  if (game.platforms?.length) body.append(element("small", "", game.platforms.join(", ")));
  card.append(body);
  return card;
}

function gamesCard(entry) {
  const card = element("article", "games-card");
  card.append(gamesCover(entry.game));
  const body = element("div", "games-card-body");
  body.append(element("h4", "", entry.title));
  const mine = [entry.platform, Number.isFinite(entry.hours) ? `${entry.hours}h played` : "", Number.isFinite(entry.rating) ? `Rated ${entry.rating}/10` : "",
    entry.status === "done" && entry.finished ? `Finished ${gamesFormatDate(entry.finished)}` : "",
    entry.status === "now" && entry.started ? `Started ${gamesFormatDate(entry.started)}` : ""].filter(Boolean);
  if (mine.length) body.append(element("p", "games-mine", mine.join(" · ")));
  if (entry.game) body.append(gamesFacts(entry.game));
  if (entry.note) body.append(element("p", "games-note", entry.note));
  const price = element("div", "games-price-line");
  const actions = element("div", "item-footer");
  const edit = element("button", "secondary", "Edit");
  edit.type = "button";
  edit.setAttribute("aria-label", `Edit ${entry.title}`);
  edit.addEventListener("click", () => {
    gamesDraft = gamesDraftFrom(entry);
    gamesStatus = "";
    gamesRefresh("games-form-title");
    document.getElementById("games-form-title")?.scrollIntoView({ block: "start" });
  });
  const move = document.createElement("select");
  move.setAttribute("aria-label", `Move ${entry.title}`);
  for (const [value, label] of gamesStatuses) move.append(new Option(label, value, false, value === entry.status));
  move.addEventListener("change", () => {
    entries = entries.map((item) => item.id === entry.id ? { ...item, status: move.value, ...(move.value === "done" && !item.finished ? { finished: gamesToday() } : {}) } : item);
    saveEntries();
    gamesRefresh();
  });
  const remove = element("button", "secondary", "Remove");
  remove.type = "button";
  remove.setAttribute("aria-label", `Remove ${entry.title}`);
  remove.addEventListener("click", () => {
    entries = entries.filter((item) => item.id !== entry.id);
    saveEntries();
    gamesRefresh();
  });
  actions.append(edit, move);
  if (entry.status !== "done") {
    const check = element("button", "secondary", "Check price");
    check.type = "button";
    check.setAttribute("aria-label", `Check PC prices for ${entry.title}`);
    check.addEventListener("click", () => gamesPriceLine(price, entry));
    actions.append(check);
  }
  actions.append(remove);
  body.append(price, actions);
  card.append(body);
  return card;
}

function gamesSorted(list, status) {
  const items = list.filter((entry) => entry.status === status);
  if (status === "done") return items.sort((a, b) => (b.finished || "").localeCompare(a.finished || ""));
  if (status !== "next" || gamesBacklogSort === "added") return items;
  const value = (entry) => gamesBacklogSort === "short" ? (entry.game?.timeToBeat?.main ?? Infinity) : -(entry.game?.criticScore ?? -1);
  return items.sort((a, b) => value(a) - value(b) || a.title.localeCompare(b.title));
}

function gamesLists(list) {
  const wrap = element("section", "games-lists");
  wrap.setAttribute("aria-label", "Your games");
  for (const [status, label] of gamesStatuses) {
    const column = element("section", "games-panel games-column");
    const head = element("div", "games-column-head");
    const items = gamesSorted(list, status);
    head.append(element("h3", "", `${label} `));
    head.firstChild.append(element("span", "games-count", String(items.length)));
    if (status === "next" && items.length > 1) {
      const sort = document.createElement("select");
      sort.id = "games-backlog-sort";
      sort.setAttribute("aria-label", "Sort backlog");
      for (const [value, text] of [["added", "Recently added"], ["short", "Shortest to beat"], ["score", "Highest critic score"]]) sort.append(new Option(text, value, false, value === gamesBacklogSort));
      sort.addEventListener("change", () => {
        gamesBacklogSort = sort.value;
        gamesRefresh("games-backlog-sort");
      });
      head.append(sort);
    }
    column.append(head);
    if (!items.length) column.append(element("p", "games-empty", status === "now" ? "Nothing in progress." : status === "next" ? "Your backlog is empty." : "No finished games yet."));
    items.forEach((entry) => column.append(gamesCard(entry)));
    wrap.append(column);
  }
  return wrap;
}

// ---------- Sidebar ----------

function gamesRelativeDate(iso) {
  const time = Date.parse(iso || "");
  if (!Number.isFinite(time)) return "";
  const days = Math.floor((Date.now() - time) / 86400000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? `${days} days ago` : new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function gamesSidebar() {
  const side = element("aside", "games-sidebar");
  const free = element("section", "games-panel games-side-section");
  free.append(element("h3", "", "Free on Epic"));
  const news = element("section", "games-panel games-side-section");
  news.append(element("h3", "", "Gaming news"));
  const trailers = element("section", "games-panel games-side-section");
  trailers.append(element("h3", "", "New trailers"));
  side.append(free, trailers, news);
  if (typeof createRedditWidget === "function") side.append(createRedditWidget("games"));
  gamesFetchJson("data/games-sidebar.json").then((data) => {
    const stamp = (block) => {
      const time = Date.parse(block?.fetchedAt || "");
      return Number.isFinite(time) ? `Updated ${new Date(time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
    };
    const fill = (section, block, render, empty) => {
      const items = block?.items || [];
      if (!items.length) {
        section.append(element("p", "games-empty", empty));
        return;
      }
      const list = element("ul", "games-side-list");
      items.forEach((item) => list.append(render(item)));
      section.append(list, element("small", "games-side-meta", [stamp(block), block.unavailable?.length ? `${block.unavailable.join(", ")} unavailable` : ""].filter(Boolean).join(" · ")));
    };
    fill(free, data.freeGames, (game) => {
      const item = element("li", "games-free");
      if (game.image) {
        const img = element("img", "");
        img.src = game.image;
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.addEventListener("error", () => img.replaceWith(element("span", "games-free-image games-cover-empty")), { once: true });
        item.append(img);
      }
      const copy = element("div", "");
      copy.append(gamesLink(game.title, game.url));
      const until = gamesFormatDate((game.end || "").slice(0, 10), { month: "short", day: "numeric" });
      const from = gamesFormatDate((game.start || "").slice(0, 10), { month: "short", day: "numeric" });
      copy.append(element("small", game.state === "now" ? "games-free-now" : "", game.state === "now" ? `Free now · until ${until}` : `Free ${from} – ${until}`));
      item.append(copy);
      return item;
    }, "No free games listed right now.");
    fill(trailers, data.trailers, (video) => {
      const item = element("li", "games-trailer");
      const link = gamesLink("", video.url, "games-trailer-link");
      if (video.videoId) {
        const img = element("img", "");
        img.src = `https://i.ytimg.com/vi/${encodeURIComponent(video.videoId)}/mqdefault.jpg`;
        img.alt = "";
        img.addEventListener("error", () => img.remove(), { once: true });
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        link.append(img);
      }
      link.append(element("span", "", video.title));
      item.append(link, element("small", "", [video.channel, gamesRelativeDate(video.published)].filter(Boolean).join(" · ")));
      return item;
    }, "No trailers loaded yet.");
    fill(news, data.news, (story) => {
      const item = element("li", "games-news");
      item.append(gamesLink(story.title, story.url), element("small", "", [story.source, gamesRelativeDate(story.published)].filter(Boolean).join(" · ")));
      return item;
    }, "No news loaded yet.");
  }).catch(() => {
    for (const section of [free, trailers, news]) section.append(element("p", "games-empty", "Couldn’t load this section."));
  });
  return side;
}

// ---------- Release calendar ----------

function gamesReadFavorites(releases) {
  let favorites = [];
  try {
    const saved = JSON.parse(localStorage.getItem(gamesFavoritesKey) || "null");
    if (Array.isArray(saved)) favorites = saved.filter((item) => item && typeof item.url === "string");
    else {
      // Older versions stored only links; keep them and fill in details from the calendar.
      const legacy = JSON.parse(localStorage.getItem(gamesLegacyFavoritesKey) || "[]");
      const byUrl = new Map(releases.map((release) => [release.url, release]));
      favorites = (Array.isArray(legacy) ? legacy : []).filter((url) => typeof url === "string").map((url) => {
        const release = byUrl.get(url) || {};
        return { url, title: release.title || url, date: release.date || "", platforms: release.platforms || [], cover: release.cover || "" };
      });
      if (favorites.length) gamesWriteFavorites(favorites);
    }
  } catch (error) {
    console.error("Could not read favorite releases.", error);
  }
  // Keep each favorite's date and details current while the release is still listed.
  const byUrl = new Map(releases.map((release) => [release.url, release]));
  return favorites.map((item) => byUrl.has(item.url) ? { ...item, ...gamesFavoriteFrom(byUrl.get(item.url)) } : item);
}

function gamesFavoriteFrom(release) {
  return { url: release.url, title: release.title, date: release.date, platforms: release.platforms || [], cover: release.cover || "" };
}

function gamesWriteFavorites(favorites) {
  try {
    localStorage.setItem(gamesFavoritesKey, JSON.stringify(favorites));
    localStorage.setItem(gamesLegacyFavoritesKey, JSON.stringify(favorites.map((item) => item.url)));
  } catch (error) {
    console.error("Could not save favorite releases.", error);
    if (typeof showNotice === "function") showNotice("Your favorite releases couldn’t be saved on this device.");
  }
}

function gamesReleaseItem(release, favorites, onToggle) {
  const item = element("li", `game-calendar-release${favorites.has(release.url) ? " is-favorite" : ""}`);
  const cover = release.cover && release.cover.startsWith("https://static.gameinformer.com/") ? element("img", "game-calendar-cover") : element("span", "");
  if (cover.tagName === "IMG") {
    cover.src = release.cover;
    cover.alt = "";
    cover.loading = "lazy";
    cover.addEventListener("error", () => cover.replaceWith(element("span", "game-calendar-cover games-cover-empty")), { once: true });
  }
  const copy = element("div", "game-calendar-release-copy");
  const row = element("div", "game-calendar-title-row");
  row.append(gamesLink(release.title, release.url));
  if (favorites.has(release.url)) row.append(element("span", "game-calendar-favorite-label", "★ FAVORITE"));
  copy.append(row, element("small", "", [gamesFormatDate(release.date), (release.platforms || []).join(", ")].filter(Boolean).join(" · ")));
  const star = element("button", "game-calendar-favorite", favorites.has(release.url) ? "★" : "☆");
  star.type = "button";
  star.setAttribute("aria-pressed", String(favorites.has(release.url)));
  star.setAttribute("aria-label", `${favorites.has(release.url) ? "Remove" : "Add"} ${release.title} ${favorites.has(release.url) ? "from" : "to"} favorites`);
  star.addEventListener("click", () => onToggle(release, star));
  item.append(cover, copy, star);
  return item;
}

function gamesMonthKey(date) {
  return date.slice(0, 7);
}

function gamesShiftMonth(month, delta) {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(year, index - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function gamesCalendar() {
  const wrapper = element("div", "games-releases");
  const panel = element("section", "games-panel game-release-calendar games-calendar");
  panel.setAttribute("aria-labelledby", "games-calendar-title");
  const status = element("p", "game-calendar-status", "Loading release dates…");
  status.setAttribute("role", "status");
  panel.append(status);
  const side = element("aside", "games-panel games-favorites");
  wrapper.append(panel, side);
  gamesFetchJson("data/game-releases.json").then((data) => {
    const releases = (data.releases || []).filter((release) => /^\d{4}-\d{2}-\d{2}$/.test(release.date || "") && release.title && release.url);
    const today = gamesToday();
    const months = [...new Set(releases.map((release) => gamesMonthKey(release.date)))].sort();
    const firstMonth = months[0] || gamesMonthKey(today);
    const lastMonth = months[months.length - 1] || gamesMonthKey(today);
    let favoriteList = gamesReadFavorites(releases);
    const favoriteUrls = () => new Set(favoriteList.map((item) => item.url));
    const platforms = [...new Set(releases.flatMap((release) => release.platforms || []))].sort((a, b) => a.localeCompare(b));
    if (!gamesCalendarState.month) gamesCalendarState.month = gamesMonthKey(today) < firstMonth ? firstMonth : gamesMonthKey(today) > lastMonth ? lastMonth : gamesMonthKey(today);
    const visible = () => releases.filter((release) =>
      (gamesCalendarState.platform === "all" || (release.platforms || []).includes(gamesCalendarState.platform)));

    const header = element("div", "game-calendar-header");
    const titleBlock = element("div");
    const title = element("h3", "", "Video game release calendar");
    title.id = "games-calendar-title";
    const years = [...new Set(months.map((month) => month.slice(0, 4)))];
    titleBlock.append(title, element("p", "", `Release dates from Game Informer’s ${years.join(", ")} schedules.`));
    const nav = element("div", "game-calendar-nav");
    const previous = element("button", "", "Previous");
    previous.type = "button";
    previous.setAttribute("aria-label", "Show previous month");
    const picker = element("div", "game-calendar-month-picker");
    const monthSelect = document.createElement("select");
    monthSelect.id = "games-calendar-month";
    monthSelect.setAttribute("aria-label", "Select month");
    for (let index = 0; index < 12; index++) monthSelect.append(new Option(new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(2026, index, 1)), String(index + 1).padStart(2, "0")));
    const yearSelect = document.createElement("select");
    yearSelect.id = "games-calendar-year";
    yearSelect.setAttribute("aria-label", "Select year");
    years.forEach((year) => yearSelect.append(new Option(year, year)));
    picker.append(monthSelect, yearSelect);
    const next = element("button", "", "Next");
    next.type = "button";
    next.setAttribute("aria-label", "Show next month");
    nav.append(previous, picker, next);
    header.append(titleBlock, nav);

    const filters = element("div", "games-calendar-filters");
    const platform = document.createElement("select");
    platform.id = "games-calendar-platform";
    platform.append(new Option("All platforms", "all"));
    platforms.forEach((name) => platform.append(new Option(name, name, false, name === gamesCalendarState.platform)));
    const search = document.createElement("input");
    search.id = "games-calendar-search";
    search.type = "search";
    search.placeholder = "Search game titles";
    search.autocomplete = "off";
    search.value = gamesCalendarState.query;
    filters.append(gamesField("Platform", platform), gamesField("Find a release date", search));
    const results = element("ul", "game-calendar-release-list games-search-results");
    results.setAttribute("aria-live", "polite");
    const grid = element("div", "game-calendar-grid");
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", "Release dates");
    const dayList = element("section", "game-calendar-releases");
    dayList.setAttribute("aria-live", "polite");
    const source = gamesLink("Source: Game Informer release schedules ↗", data.sourceUrl || "https://gameinformer.com/", "game-calendar-source");
    const fetched = Date.parse(data.fetchedAt || "");
    panel.replaceChildren(header, filters, results, grid, dayList,
      element("p", "game-calendar-updated", Number.isFinite(fetched) ? `Data refreshed ${new Date(fetched).toLocaleString()}.` : ""), source);

    const toggle = (release, button) => {
      const has = favoriteUrls().has(release.url);
      favoriteList = has ? favoriteList.filter((item) => item.url !== release.url) : [...favoriteList, gamesFavoriteFrom(release)];
      gamesWriteFavorites(favoriteList);
      const id = button?.closest("[data-results]") ? "games-calendar-search" : null;
      renderAll();
      if (id) document.getElementById(id)?.focus();
    };
    const byDate = () => {
      const map = new Map();
      visible().forEach((release) => {
        if (!map.has(release.date)) map.set(release.date, []);
        map.get(release.date).push(release);
      });
      for (const list of map.values()) list.sort((a, b) => Number(favoriteUrls().has(b.url)) - Number(favoriteUrls().has(a.url)));
      return map;
    };
    function renderSearch() {
      results.replaceChildren();
      results.dataset.results = "true";
      const key = gamesSearchKey(gamesCalendarState.query);
      if (key.length < 2) {
        results.hidden = true;
        return;
      }
      const matches = visible().filter((release) => gamesSearchKey(release.title).includes(key)).slice(0, 12);
      results.hidden = false;
      if (!matches.length) results.append(element("li", "game-calendar-status", "No matching releases."));
      matches.forEach((release) => {
        const item = gamesReleaseItem(release, favoriteUrls(), toggle);
        const jump = element("button", "secondary games-jump", "Show on calendar");
        jump.type = "button";
        jump.addEventListener("click", () => {
          gamesCalendarState.month = gamesMonthKey(release.date);
          gamesCalendarState.day = release.date;
          renderMonth(release.date);
        });
        item.querySelector(".game-calendar-release-copy").append(jump);
        results.append(item);
      });
    }
    function renderMonth(focusDay) {
      const map = byDate();
      const prefix = `${gamesCalendarState.month}-`;
      if (!gamesCalendarState.day.startsWith(prefix)) {
        const days = [...map.keys()].filter((date) => date.startsWith(prefix)).sort();
        gamesCalendarState.day = days.find((date) => date >= today) || days[0] || `${prefix}01`;
      }
      const [year, month] = gamesCalendarState.month.split("-").map(Number);
      monthSelect.value = String(month).padStart(2, "0");
      yearSelect.value = String(year);
      grid.replaceChildren();
      ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((weekday) => {
        const label = element("span", "game-calendar-weekday", weekday);
        label.setAttribute("role", "columnheader");
        grid.append(label);
      });
      for (let index = 0; index < new Date(year, month - 1, 1).getDay(); index++) grid.append(element("span"));
      for (let day = 1; day <= new Date(year, month, 0).getDate(); day++) {
        const date = `${prefix}${String(day).padStart(2, "0")}`;
        const dayReleases = map.get(date) || [];
        const favoriteCount = dayReleases.filter((release) => favoriteUrls().has(release.url)).length;
        const button = element("button", `game-calendar-day${favoriteCount ? " has-favorite" : ""}`);
        button.type = "button";
        button.dataset.date = date;
        button.setAttribute("role", "gridcell");
        button.setAttribute("aria-pressed", String(date === gamesCalendarState.day));
        button.setAttribute("aria-label", `${gamesFormatDate(date, { month: "long", day: "numeric", year: "numeric" })}${dayReleases.length ? `, ${dayReleases.length} release${dayReleases.length === 1 ? "" : "s"}` : ""}${favoriteCount ? `, ${favoriteCount} favorite${favoriteCount === 1 ? "" : "s"}` : ""}`);
        button.append(element("span", "game-calendar-day-number", String(day)));
        if (dayReleases.length) button.append(element("span", "game-calendar-day-count", `${dayReleases.length} release${dayReleases.length === 1 ? "" : "s"}${favoriteCount ? ` · ★${favoriteCount}` : ""}`));
        button.addEventListener("click", () => {
          gamesCalendarState.day = date;
          renderMonth(date);
        });
        grid.append(button);
      }
      previous.disabled = gamesCalendarState.month <= firstMonth;
      next.disabled = gamesCalendarState.month >= lastMonth;
      dayList.replaceChildren(element("h4", "", gamesFormatDate(gamesCalendarState.day, { weekday: "long", month: "long", day: "numeric", year: "numeric" })));
      const list = map.get(gamesCalendarState.day) || [];
      if (!list.length) dayList.append(element("p", "game-calendar-status", "No releases listed for this date."));
      else {
        const items = element("ul", "game-calendar-release-list");
        list.forEach((release) => items.append(gamesReleaseItem(release, favoriteUrls(), toggle)));
        dayList.append(items);
      }
      if (focusDay) grid.querySelector(`[data-date="${focusDay}"]`)?.focus();
    }
    function renderFavorites() {
      side.replaceChildren();
      const upcoming = favoriteList.filter((item) => item.date >= today).sort((a, b) => a.date.localeCompare(b.date));
      const past = favoriteList.filter((item) => !item.date || item.date < today).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      const heading = element("h3", "", "Upcoming favorites");
      side.append(heading);
      if (!upcoming.length) side.append(element("p", "games-empty", "Star games on the calendar to keep track of their release dates here."));
      else {
        const list = element("ul", "game-calendar-release-list");
        upcoming.forEach((item) => {
          const row = gamesReleaseItem(item, favoriteUrls(), toggle);
          const days = Math.round((new Date(`${item.date}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86400000);
          row.querySelector(".game-calendar-release-copy").append(element("small", "games-countdown", days === 0 ? "Out today" : days === 1 ? "Tomorrow" : `In ${days} days`));
          list.append(row);
        });
        side.append(list);
      }
      if (past.length) {
        const details = element("details", "games-past-favorites");
        details.append(element("summary", "", `Released favorites (${past.length})`));
        const list = element("ul", "game-calendar-release-list");
        past.forEach((item) => list.append(gamesReleaseItem(item, favoriteUrls(), toggle)));
        details.append(list);
        side.append(details);
      }
    }
    function renderAll() {
      renderMonth();
      renderSearch();
      renderFavorites();
    }
    const goTo = (month) => {
      gamesCalendarState.month = month < firstMonth ? firstMonth : month > lastMonth ? lastMonth : month;
      gamesCalendarState.day = "";
      renderMonth();
    };
    previous.addEventListener("click", () => goTo(gamesShiftMonth(gamesCalendarState.month, -1)));
    next.addEventListener("click", () => goTo(gamesShiftMonth(gamesCalendarState.month, 1)));
    monthSelect.addEventListener("change", () => goTo(`${yearSelect.value}-${monthSelect.value}`));
    yearSelect.addEventListener("change", () => goTo(`${yearSelect.value}-${monthSelect.value}`));
    platform.addEventListener("change", () => {
      gamesCalendarState.platform = platform.value;
      gamesCalendarState.day = "";
      renderAll();
    });
    search.addEventListener("input", () => {
      gamesCalendarState.query = search.value;
      renderSearch();
    });
    renderAll();
  }).catch((error) => {
    console.error("Could not load the release calendar.", error);
    status.textContent = "Release dates couldn’t be loaded. Please try again later.";
  });
  return wrapper;
}

// ---------- Channel ----------

function createGamesHub() {
  const view = gamesView();
  const root = element("div", "games-hub");
  gamesRoot = root;
  root.append(gamesTabs(view));
  if (view === "releases") {
    root.append(gamesCalendar());
    return root;
  }
  const list = gamesEntries();
  const layout = element("div", "games-layout");
  const main = element("div", "games-main");
  main.append(gamesDashboard(list), gamesForm(list), gamesLists(list));
  layout.append(main, gamesSidebar());
  root.append(layout);
  return root;
}
