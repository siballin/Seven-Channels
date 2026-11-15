// Live Events channel (#live): concert discovery (Ticketmaster), followed artists, a private planner, a concert journal,
// a map of shows you've attended (OpenStreetMap via Leaflet) and setlists (setlist.fm snapshot or your own).

let liveRoot = null;
const liveUi = {
  discover: { keyword: "", city: "", countryCode: "", start: "", end: "", genre: "", venue: "", view: "list", page: 0, month: "" },
  results: new Map(),
  status: new Map(),
  pending: new Map(),
  editing: null,
  draft: null,
  confirm: "",
  journalFilter: { year: "all", query: "" },
  mapFilter: { year: "all", country: "all" },
  message: "",
  messageError: false
};
const livePlanColors = { Interested: "var(--le-c1)", Planning: "var(--le-c2)", "Ticket Purchased": "var(--le-c3)", Attending: "var(--le-c4)", Attended: "var(--le-c5)", Cancelled: "var(--muted)" };

function liveRoute() {
  const [view = "", ...rest] = location.hash.replace(/^#live\/?/, "").split("/");
  const id = rest.length ? decodeURIComponent(rest.join("/")) : "";
  return { view: ["discover", "artists", "artist", "event", "planner", "journal", "map", "settings"].includes(view) ? view : "home", id };
}

function liveRefresh(focusId) {
  if (!liveRoot?.isConnected) return;
  const activeId = focusId || document.activeElement?.id;
  const scroll = window.scrollY;
  const previous = liveRoot;
  const next = createLiveEvents();
  previous.replaceWith(next);
  if (!focusId) window.scrollTo(0, scroll);
  if (activeId) document.getElementById(activeId)?.focus({ preventScroll: !focusId });
}

function liveLoad(key, loader) {
  if (liveUi.pending.has(key)) return;
  const hash = location.hash;
  liveUi.status.set(key, { loading: true });
  const promise = Promise.resolve().then(loader).then((value) => {
    liveUi.results.set(key, value);
    liveUi.status.set(key, { done: true, at: Date.now() });
  }).catch((error) => {
    liveUi.status.set(key, { error: error.message || "Something went wrong." });
  }).finally(() => {
    liveUi.pending.delete(key);
    if (location.hash === hash) liveRefresh();
  });
  liveUi.pending.set(key, promise);
}

function liveSetMessage(text, error = false) {
  liveUi.message = text;
  liveUi.messageError = error;
}

// ---------- Building blocks ----------

const leEl = (tag, className, text) => element(tag, className, text);

function leLink(text, href, className = "") {
  const link = leEl("a", className, text);
  link.href = href;
  if (/^https?:/.test(href)) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  return link;
}

function leButton(text, onClick, className = "secondary", id = "") {
  const button = leEl("button", className, text);
  button.type = "button";
  if (id) button.id = id;
  button.addEventListener("click", onClick);
  return button;
}

function lePanel(title, id, className = "") {
  const panel = leEl("section", `le-panel ${className}`.trim());
  const heading = leEl("h3", "", title);
  heading.id = id;
  heading.tabIndex = -1;
  panel.setAttribute("aria-labelledby", id);
  panel.append(heading);
  return panel;
}

function leEmpty(text, action) {
  const box = leEl("div", "le-empty");
  box.append(leEl("p", "", text));
  if (action) box.append(action);
  return box;
}

function leLoading(text) {
  const box = leEl("div", "le-loading");
  box.setAttribute("role", "status");
  box.append(leEl("span", "le-spinner"), leEl("span", "", text));
  return box;
}

function leError(text, retry) {
  const box = leEl("div", "le-error");
  box.setAttribute("role", "alert");
  box.append(leEl("p", "", text));
  if (retry) box.append(leButton("Try again", retry));
  return box;
}

function leField(labelText, control, hint) {
  const field = leEl("div", "field");
  const label = leEl("label", "", labelText);
  label.htmlFor = control.id;
  field.append(label, control);
  if (hint) field.append(leEl("small", "le-hint", hint));
  return field;
}

function leInput(id, value, { type = "text", placeholder = "", list, step } = {}) {
  const input = document.createElement("input");
  input.id = id;
  input.type = type;
  input.value = value ?? "";
  if (placeholder) input.placeholder = placeholder;
  if (list) input.setAttribute("list", list);
  if (step) input.step = step;
  return input;
}

function leSelect(id, options, value) {
  const select = document.createElement("select");
  select.id = id;
  for (const option of options) {
    const [optionValue, label] = Array.isArray(option) ? option : [option, option];
    const node = leEl("option", "", label);
    node.value = optionValue;
    node.selected = optionValue === value;
    select.append(node);
  }
  return select;
}

function leTextarea(id, value, placeholder = "", rows = 3) {
  const area = document.createElement("textarea");
  area.id = id;
  area.value = value ?? "";
  area.placeholder = placeholder;
  area.rows = rows;
  return area;
}

function leImage(src, className, fallback = "♫") {
  const frame = leEl("span", `${className} le-media`);
  frame.dataset.fallback = fallback;
  if (src) {
    const image = document.createElement("img");
    image.src = src;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => image.remove(), { once: true });
    frame.append(image);
  }
  return frame;
}

function leDate(value, options = { weekday: "short", month: "short", day: "numeric", year: "numeric" }) {
  if (!value) return "Date to be announced";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, options).format(date);
}

function leTime(value) {
  if (!value) return "";
  const [hours, minutes] = value.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes));
}

function leDaysUntil(date) {
  if (!date) return null;
  return Math.round((new Date(`${date}T00:00:00`) - new Date(`${liveToday()}T00:00:00`)) / 86400000);
}

function leCountdown(date, className = "le-countdown") {
  const days = leDaysUntil(date);
  if (days === null || days < 0) return null;
  const text = days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`;
  const node = leEl("span", className, text);
  node.title = leDate(date);
  return node;
}

function leConfirm(key, label, onConfirm) {
  const armed = liveUi.confirm === key;
  const id = `le-confirm-${key.replace(/[^\w-]/g, "-")}`;
  const button = leButton(armed ? `Confirm ${label.toLowerCase()}` : label, () => {
    if (!armed) {
      liveUi.confirm = key;
      liveRefresh(id);
      return;
    }
    liveUi.confirm = "";
    onConfirm();
  }, "secondary le-danger", id);
  button.addEventListener("blur", () => setTimeout(() => {
    if (button.isConnected && liveUi.confirm === key) {
      liveUi.confirm = "";
      button.textContent = label;
    }
  }, 0));
  return button;
}

function leSourceBadge(text) {
  const badge = leEl("span", "le-source", text);
  badge.title = text === "Ticketmaster" ? "Verified listing from Ticketmaster's Discovery API" : text === "setlist.fm" ? "From setlist.fm" : "Entered by you";
  return badge;
}

function leStale(key) {
  const status = liveUi.status.get(key);
  const value = liveUi.results.get(key);
  const cachedAt = value?.cachedAt;
  if (!cachedAt) return null;
  const minutes = Math.round((Date.now() - cachedAt) / 60000);
  return minutes >= 60 ? leEl("p", "le-hint le-stale", `Ticketmaster data from ${Math.round(minutes / 60)} hour${minutes >= 120 ? "s" : ""} ago (cached). Dates and availability can change.`) : status?.done ? null : null;
}

function leNeedsKey(what) {
  return leEmpty(`${what} come from Ticketmaster’s official Discovery API, which needs a free API key.`, leLink("Add your key in Live Events settings", "#live/settings", "le-text-link"));
}

// ---------- Shell ----------

function createLiveTabs(active) {
  const nav = leEl("nav", "le-tabs");
  nav.setAttribute("aria-label", "Live Events sections");
  for (const [view, label, href] of [["home", "Dashboard", "#live"], ["discover", "Discover", "#live/discover"], ["artists", "Artists", "#live/artists"], ["planner", "Planner", "#live/planner"],
    ["journal", "Concert journal", "#live/journal"], ["map", "Map", "#live/map"], ["settings", "Settings", "#live/settings"]]) {
    const link = leLink(label, href);
    if (view === active || (view === "artists" && active === "artist")) link.setAttribute("aria-current", "page");
    nav.append(link);
  }
  return nav;
}

function createLiveEvents() {
  liveSeedDefaultFollows();
  const route = liveRoute();
  const root = leEl("div", "live-events");
  root.append(createLiveTabs(route.view));
  if (liveUi.message) {
    const message = leEl("p", `le-message${liveUi.messageError ? " error" : ""}`, liveUi.message);
    message.id = "le-message";
    message.tabIndex = -1;
    message.setAttribute("role", "status");
    root.append(message);
  }
  const views = { home: createLiveDashboard, discover: createLiveDiscover, artists: createLiveArtists, artist: () => createLiveArtist(route.id),
    event: () => createLiveEvent(route.id), planner: createLivePlanner, journal: () => createLiveJournal(route.id), map: createLiveMap, settings: createLiveSettings };
  root.append(views[route.view]());
  liveRoot = root;
  return root;
}

// ---------- Event cards ----------

function leEventCard(event, { compact = false } = {}) {
  const plan = liveGetState().plans.find((item) => item.event.id === event.id);
  const card = leEl("article", `le-event${compact ? " is-compact" : ""}${event.status === "canceled" ? " is-cancelled" : ""}`);
  card.append(leImage(event.image, "le-poster"));
  const body = leEl("div", "le-event-body");
  const title = leLink(event.name || "Untitled event", `#live/event/${encodeURIComponent(event.id)}`, "le-event-title");
  body.append(title);
  const lineup = event.attractions.map((attraction) => attraction.name).join(" · ");
  if (lineup && lineup !== event.name) body.append(leEl("p", "le-lineup", lineup));
  const when = leEl("p", "le-when");
  when.append(`${leDate(event.date)}${event.time ? ` · ${leTime(event.time)} local` : ""}`);
  const countdown = leCountdown(event.date);
  if (countdown) when.append(" ", countdown);
  body.append(when, leEl("p", "le-where", [event.venue.name, [event.venue.city, event.venue.state].filter(Boolean).join(", "), event.venue.country].filter(Boolean).join(" · ")));
  const meta = leEl("p", "le-meta");
  meta.append(leSourceBadge("Ticketmaster"));
  if (event.status && event.status !== "onsale") meta.append(" ", leEl("span", `le-status le-status-${event.status}`, liveStatusLabels[event.status] || event.status));
  if (event.genre) meta.append(` ${event.genre}`);
  if (plan) meta.append(" ", leEl("span", "le-plan-badge", plan.status));
  body.append(meta);
  if (!compact) {
    const actions = leEl("div", "le-actions");
    if (event.url) actions.append(leLink("Tickets ↗", event.url, "le-button"));
    actions.append(lePlanSelect(event, plan));
    body.append(actions);
  }
  card.append(body);
  return card;
}

function lePlanSelect(event, plan) {
  const select = leSelect(`le-plan-${event.id}`, [["", plan ? "Remove from planner" : "Add to planner…"], ...livePlanStatuses.map((status) => [status, status])], plan?.status || "");
  select.setAttribute("aria-label", `Planner status for ${event.name}`);
  select.addEventListener("change", () => {
    if (!select.value) {
      if (plan) liveRemove("plans", plan.id);
      liveSetMessage(`Removed “${event.name}” from your planner.`);
    } else {
      liveUpsert("plans", { ...(plan || { id: liveId("plan") }), event: { ...event, fetchedAt: new Date().toISOString() }, status: select.value });
      liveSetMessage(`“${event.name}” is in your planner as ${select.value}.`);
    }
    liveRefresh(select.id);
  });
  return select;
}

function leEventList(events, { compact = false } = {}) {
  const list = leEl("div", compact ? "le-card-row" : "le-event-list");
  for (const event of events) list.append(leEventCard(event, { compact }));
  return list;
}

// ---------- Dashboard ----------

function liveFollowedEventsLoader() {
  const pending = liveGetState().follows.filter((follow) => follow.following && !follow.tmId && follow.mbid);
  let follows = liveGetState().follows.filter((follow) => follow.following && follow.tmId).slice(0, 12);
  return async () => {
    // Followed artists without a Ticketmaster match are linked when their MusicBrainz ID matches exactly.
    for (const follow of pending.slice(0, 4)) {
      try {
        const linked = await liveResolveFollow(follow);
        if (linked && follows.length < 12) follows = [...follows, linked];
      } catch (error) {
        console.warn(`Could not match ${follow.name} on Ticketmaster.`, error);
      }
    }
    const seen = new Map();
    let cachedAt = Date.now();
    for (const follow of follows) {
      const result = await liveSearchEvents({ attractionId: follow.tmId, size: 20 });
      cachedAt = Math.min(cachedAt, result.cachedAt || Date.now());
      for (const event of result.events) if (!seen.has(event.id)) seen.set(event.id, event);
    }
    return { events: [...seen.values()].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999")), cachedAt };
  };
}

function leSection(key, loader, render, { needsKey = true, what = "Concerts" } = {}) {
  if (needsKey && !liveLocal().ticketmasterKey) return leNeedsKey(what);
  const status = liveUi.status.get(key);
  if (!status) {
    liveLoad(key, loader);
    return leLoading("Loading from Ticketmaster…");
  }
  if (status.loading) return leLoading("Loading from Ticketmaster…");
  if (status.error) return leError(status.error, () => { liveUi.status.delete(key); liveRefresh(); });
  const box = leEl("div", "le-section-body");
  box.append(render(liveUi.results.get(key)));
  const stale = leStale(key);
  if (stale) box.append(stale);
  return box;
}

function createLiveDashboard() {
  const state = liveGetState();
  const today = liveToday();
  const wrap = leEl("div", "le-stack");
  const upcomingPlans = state.plans.filter((plan) => plan.event.date >= today && !["Cancelled", "Attended"].includes(plan.status)).sort((a, b) => a.event.date.localeCompare(b.event.date));
  const counts = new Map();
  for (const entry of state.journal) counts.set(entry.artist.name, [...(counts.get(entry.artist.name) || []), entry]);
  const favorites = [...counts].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const metrics = leEl("div", "le-metrics");
  for (const [label, value, note] of [["Concerts attended", String(state.journal.length), state.journal.length ? `Since ${leDate([...state.journal].sort((a, b) => a.date.localeCompare(b.date))[0].date, { month: "short", year: "numeric" })}` : "Log shows in your journal"],
    ["Upcoming plans", String(upcomingPlans.length), upcomingPlans.filter((plan) => ["Ticket Purchased", "Attending"].includes(plan.status)).length + " with tickets"],
    ["Artists followed", String(state.follows.filter((follow) => follow.following).length), ""],
    ["Most seen live", favorites[0] ? favorites[0][0] : "—", favorites[0] ? `${favorites[0][1].length} show${favorites[0][1].length === 1 ? "" : "s"}` : ""]]) {
    const tile = leEl("div", "le-metric");
    tile.append(leEl("span", "", label), leEl("strong", "", value));
    if (note) tile.append(leEl("small", "", note));
    metrics.append(tile);
  }
  wrap.append(metrics);

  const next = upcomingPlans[0];
  if (next) {
    const hero = leEl("section", "le-hero");
    hero.setAttribute("aria-labelledby", "le-next-title");
    hero.append(leImage(next.event.image || next.event.attractions[0]?.image, "le-hero-poster"));
    const copy = leEl("div", "le-hero-copy");
    copy.append(leEl("span", "le-kicker", "Your next concert"));
    const title = leLink(next.event.attractions[0]?.name || next.event.name, `#live/event/${encodeURIComponent(next.event.id)}`, "le-hero-title");
    title.id = "le-next-title";
    copy.append(title, leEl("p", "le-hint", next.event.name));
    const days = leDaysUntil(next.event.date);
    const big = leEl("p", "le-big-countdown");
    big.append(leEl("strong", "", days === 0 ? "Today" : String(days)), leEl("span", "", days === 0 ? "" : days === 1 ? "day to go" : "days to go"));
    copy.append(big, leEl("p", "", `${leDate(next.event.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${next.event.time ? ` · ${leTime(next.event.time)}` : ""} · ${next.event.venue.name}, ${next.event.venue.city}`),
      leEl("p", "le-meta", `Planner: ${next.status}`));
    hero.append(copy);
    wrap.append(hero);
  }

  const grid = leEl("div", "le-grid");
  const followed = lePanel("Upcoming from artists you follow", "le-followed-title", "le-span-2");
  if (!state.follows.some((follow) => follow.following && (follow.tmId || follow.mbid))) {
    followed.append(leEmpty("Follow artists to see their upcoming shows here.", leLink("Find artists", "#live/artists", "le-text-link")));
  } else {
    followed.append(leSection("followed", liveFollowedEventsLoader(), (value) => {
      const upcoming = value.events.filter((event) => !event.date || event.date >= today);
      return upcoming.length ? leEventList(upcoming.slice(0, 8), { compact: true }) : leEmpty("Ticketmaster lists no upcoming shows for the artists you follow.");
    }));
  }
  grid.append(followed);

  const announced = lePanel("Recently announced", "le-announced-title");
  announced.append(leEl("p", "le-hint", "Followed artists’ shows whose public ticket sale opened in the last 3 weeks or opens soon."));
  if (state.follows.some((follow) => follow.following && (follow.tmId || follow.mbid))) {
    announced.append(leSection("followed", liveFollowedEventsLoader(), (value) => {
      const cutoff = Date.now() - 21 * 86400000;
      const recent = value.events.filter((event) => event.onSale && Date.parse(event.onSale) >= cutoff).sort((a, b) => b.onSale.localeCompare(a.onSale));
      if (!recent.length) return leEmpty("Nothing newly announced for the artists you follow.");
      const list = leEl("ul", "le-simple-list");
      for (const event of recent.slice(0, 6)) {
        const item = leEl("li");
        item.append(leLink(event.name, `#live/event/${encodeURIComponent(event.id)}`), leEl("small", "", `${leDate(event.date)} · ${event.venue.city} · on sale ${leDate(event.onSale, { month: "short", day: "numeric" })}`));
        list.append(item);
      }
      return list;
    }));
  } else {
    announced.append(leEmpty("Follow artists to see new tour dates."));
  }
  grid.append(announced);

  const nearby = lePanel("Near you", "le-nearby-title");
  const place = liveLocal().location;
  if (!place) {
    nearby.append(leEmpty("Choose your city in settings to see concerts nearby. Your location stays in this browser.", leLink("Set your location", "#live/settings", "le-text-link")));
  } else {
    nearby.append(leEl("p", "le-hint", `Within ${place.radius} miles of ${place.label}.`), leSection(`nearby:${place.lat},${place.lon},${place.radius}`,
      () => liveSearchEvents({ latlong: `${place.lat},${place.lon}`, radius: String(place.radius), size: 20 }),
      (value) => (value.events.length ? leEventList(value.events.slice(0, 6), { compact: true }) : leEmpty("No music events found nearby."))));
  }
  grid.append(nearby);

  const past = lePanel("Concerts you’ve been to", "le-past-title");
  const recent = [...state.journal].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  past.append(recent.length ? leJournalList(recent) : leEmpty("Your concert journal is empty.", leLink("Log a concert", "#live/journal", "le-text-link")));
  grid.append(past);

  const loved = lePanel("Favorite artists seen live", "le-favorites-title");
  if (favorites.length) {
    const list = leEl("ol", "le-simple-list");
    for (const [name, entries] of favorites.slice(0, 6)) {
      const rated = entries.filter((entry) => entry.rating);
      const item = leEl("li");
      item.append(leEl("strong", "", name), leEl("small", "", `${entries.length} show${entries.length === 1 ? "" : "s"}${rated.length ? ` · average ${(rated.reduce((sum, entry) => sum + entry.rating, 0) / rated.length).toFixed(1)}/10` : ""}`));
      list.append(item);
    }
    loved.append(list);
  } else {
    loved.append(leEmpty("Artists you see most often appear here once you log shows."));
  }
  grid.append(loved);
  wrap.append(grid);
  return wrap;
}

// ---------- Discover ----------

function createLiveDiscover() {
  const filters = liveUi.discover;
  const wrap = leEl("div", "le-stack");
  const panel = lePanel("Discover concerts", "le-discover-title");
  if (!liveLocal().ticketmasterKey) {
    panel.append(leNeedsKey("Concert listings"));
    wrap.append(panel);
    return wrap;
  }
  const form = leEl("form", "le-filters");
  const keyword = leInput("le-q", filters.keyword, { type: "search", placeholder: "Artist or event" });
  const city = leInput("le-city", filters.city, { placeholder: "e.g. Seoul" });
  const country = leInput("le-country", filters.countryCode, { placeholder: "e.g. US, KR" });
  const start = leInput("le-start", filters.start, { type: "date" });
  const end = leInput("le-end", filters.end, { type: "date" });
  const genre = leSelect("le-genre", [["", "All music"], ...liveGenres.map((value) => [value, value])], filters.genre);
  const venue = leInput("le-venue", filters.venue, { placeholder: "Venue name" });
  const search = leEl("button", "", "Search");
  search.type = "submit";
  form.append(leField("Artist", keyword), leField("City", city), leField("Country code", country), leField("From", start), leField("To", end), leField("Genre", genre), leField("Venue", venue, "Filters the results by venue name."), search);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    Object.assign(filters, { keyword: keyword.value.trim(), city: city.value.trim(), countryCode: country.value.trim().toUpperCase().slice(0, 2), start: start.value, end: end.value, genre: genre.value, venue: venue.value.trim(), page: 0 });
    liveRefresh("le-discover-title");
  });
  panel.append(form);
  const views = leEl("div", "le-segmented");
  views.setAttribute("role", "group");
  views.setAttribute("aria-label", "Results view");
  for (const [value, label] of [["list", "List"], ["calendar", "Calendar"]]) {
    const button = leButton(label, () => { filters.view = value; liveRefresh(`le-view-${value}`); }, value === filters.view ? "is-active" : "secondary", `le-view-${value}`);
    button.setAttribute("aria-pressed", String(value === filters.view));
    views.append(button);
  }
  panel.append(views);
  const key = `discover:${JSON.stringify({ ...filters, view: undefined, month: undefined, venue: undefined })}`;
  panel.append(leSection(key, () => liveSearchEvents({ keyword: filters.keyword, city: filters.city, countryCode: filters.countryCode, start: filters.start, end: filters.end, genre: filters.genre, size: 50, page: filters.page }), (value) => {
    const venueText = filters.venue.toLowerCase();
    const events = value.events.filter((event) => !venueText || event.venue.name.toLowerCase().includes(venueText));
    const box = leEl("div", "le-stack");
    box.append(leEl("p", "le-count", `${events.length} event${events.length === 1 ? "" : "s"} shown · ${value.total} on Ticketmaster for this search`));
    if (!events.length) {
      box.append(leEmpty("No events match. Try a wider date range or a different spelling."));
      return box;
    }
    box.append(filters.view === "calendar" ? leEventCalendar(events) : leEventList(events));
    const pager = leEl("div", "le-actions");
    if (filters.page > 0) pager.append(leButton("‹ Previous page", () => { filters.page -= 1; liveRefresh("le-discover-title"); }));
    if ((filters.page + 1) * 50 < value.total) pager.append(leButton("Next page ›", () => { filters.page += 1; liveRefresh("le-discover-title"); }));
    box.append(pager);
    return box;
  }));
  wrap.append(panel);
  return wrap;
}

function leEventCalendar(events) {
  const months = [...new Set(events.map((event) => event.date.slice(0, 7)).filter(Boolean))].sort();
  const month = months.includes(liveUi.discover.month) ? liveUi.discover.month : months[0];
  const box = leEl("div", "le-calendar-box");
  const head = leEl("div", "le-actions");
  const index = months.indexOf(month);
  const label = leEl("h4", "le-calendar-label", new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00`)));
  head.append(leButton("‹", () => { liveUi.discover.month = months[index - 1]; liveRefresh("le-cal-prev"); }, "secondary", "le-cal-prev"), label,
    leButton("›", () => { liveUi.discover.month = months[index + 1]; liveRefresh("le-cal-next"); }, "secondary", "le-cal-next"));
  head.children[0].disabled = index <= 0;
  head.children[2].disabled = index >= months.length - 1;
  head.children[0].setAttribute("aria-label", "Previous month with events");
  head.children[2].setAttribute("aria-label", "Next month with events");
  box.append(head);
  const first = new Date(`${month}-01T00:00:00`);
  const startDay = new Date(first);
  startDay.setDate(1 - first.getDay());
  const grid = leEl("div", "le-calendar");
  grid.setAttribute("role", "grid");
  grid.setAttribute("aria-label", label.textContent);
  for (let day = 0; day < 7; day++) grid.append(leEl("span", "le-weekday", new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(2026, 10, 1 + day))));
  for (let index2 = 0; index2 < 42; index2++) {
    const date = new Date(startDay);
    date.setDate(startDay.getDate() + index2);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const cell = leEl("div", `le-day${date.getMonth() !== first.getMonth() ? " is-outside" : ""}${key === liveToday() ? " is-today" : ""}`);
    cell.setAttribute("role", "gridcell");
    cell.append(leEl("span", "le-day-number", String(date.getDate())));
    for (const event of events.filter((item) => item.date === key)) {
      const chip = leLink(event.attractions[0]?.name || event.name, `#live/event/${encodeURIComponent(event.id)}`, "le-chip");
      chip.title = `${event.name} · ${event.venue.name}, ${event.venue.city}${event.time ? ` · ${leTime(event.time)}` : ""}`;
      cell.append(chip);
    }
    grid.append(cell);
  }
  box.append(grid);
  return box;
}

// ---------- Artists ----------

function liveFollow(candidate, extra = {}) {
  const id = candidate.tmId ? `tm:${candidate.tmId}` : `mb:${candidate.mbid}`;
  const existing = liveGetState().follows.find((follow) => follow.id === id);
  liveUpsert("follows", { ...(existing || {}), id, name: candidate.name, tmId: candidate.tmId || existing?.tmId || "", mbid: candidate.mbid || existing?.mbid || "", image: candidate.image || existing?.image || "", following: true, ...extra });
  liveUi.status.delete("followed");
  liveSetMessage(`Following ${candidate.name}.`);
}

function leCandidateList(candidates, onPick) {
  const list = leEl("ul", "le-candidates");
  for (const candidate of candidates) {
    const item = leEl("li", "le-candidate");
    item.append(leImage(candidate.image, "le-avatar", (candidate.name || "?")[0]));
    const copy = leEl("div");
    copy.append(leEl("strong", "", candidate.name));
    const details = [candidate.genre, candidate.upcoming !== null && candidate.upcoming !== undefined ? `${candidate.upcoming} upcoming on Ticketmaster` : "", candidate.mbid ? "MusicBrainz ID linked" : "No MusicBrainz link"].filter(Boolean).join(" · ");
    copy.append(leEl("small", "", details));
    if (candidate.mbid) copy.append(leLink("MusicBrainz ↗", `https://musicbrainz.org/artist/${candidate.mbid}`, "le-text-link"));
    item.append(copy, leButton("This one", () => onPick(candidate), "", `le-pick-${candidate.tmId}`));
    list.append(item);
  }
  return list;
}

function createLiveArtists() {
  const state = liveGetState();
  const wrap = leEl("div", "le-stack");
  const following = lePanel("Artists you follow", "le-follows-title");
  const follows = state.follows.filter((follow) => follow.following).sort((a, b) => a.name.localeCompare(b.name));
  if (follows.length) {
    const grid = leEl("div", "le-artist-grid");
    for (const follow of follows) {
      const card = leLink("", `#live/artist/${encodeURIComponent(follow.id)}`, "le-artist-card");
      card.append(leImage(follow.image, "le-artist-photo", follow.name[0]), leEl("strong", "", follow.name), leEl("small", "", [follow.kpopId ? "From K-Pop" : "", follow.tmId ? "Ticketmaster" : "", follow.mbid ? "MusicBrainz" : ""].filter(Boolean).join(" · ")));
      grid.append(card);
    }
    following.append(grid);
  } else {
    following.append(leEmpty("You’re not following anyone yet. Search below, or bring in the artists you follow in K-Pop."));
  }
  wrap.append(following);

  const find = lePanel("Find an artist", "le-find-title");
  if (!liveLocal().ticketmasterKey) {
    find.append(leNeedsKey("Artist matches"));
  } else {
    const form = leEl("form", "le-form-row");
    const input = leInput("le-artist-q", liveUi.discover.artistQuery || "", { type: "search", placeholder: "Artist or group name" });
    const go = leEl("button", "", "Search Ticketmaster");
    go.type = "submit";
    form.append(leField("Artist", input), go);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      liveUi.discover.artistQuery = input.value.trim();
      liveUi.status.delete(`attractions:${liveUi.discover.artistQuery}`);
      liveRefresh("le-artist-q");
    });
    find.append(form, leEl("p", "le-hint", "Ticketmaster lists artists by their own ID, and many link to MusicBrainz too, so similarly named artists stay separate. Check the details before following."));
    const query = liveUi.discover.artistQuery;
    if (query) {
      find.append(leSection(`attractions:${query}`, () => liveSearchAttractions(query), (candidates) => (candidates.length
        ? leCandidateList(candidates, (candidate) => { liveFollow(candidate); liveRefresh("le-message"); })
        : leEmpty("No matching artists on Ticketmaster."))));
    }
  }
  wrap.append(find);

  const kpop = lePanel("Artists you follow in K-Pop", "le-kpop-title");
  const kpopFollows = typeof kpopArtistFollows !== "undefined" && Array.isArray(kpopArtistFollows) ? kpopArtistFollows.filter((artist) => artist.followed) : [];
  if (!kpopFollows.length) {
    kpop.append(leEmpty("Follow artists in the K-Pop channel and they’ll be listed here to bring over."));
  } else {
    kpop.append(leEl("p", "le-hint", "K-Pop follows use a different ID, so pick each artist’s Ticketmaster match yourself. Once confirmed, the match is stored by Ticketmaster ID."));
    const list = leEl("ul", "le-simple-list");
    for (const artist of kpopFollows) {
      const linked = state.follows.find((follow) => follow.kpopId === artist.id && follow.following);
      const item = leEl("li", "le-kpop-row");
      item.append(leEl("strong", "", artist.name));
      if (linked) {
        item.append(leLink(`Matched: ${linked.name}`, `#live/artist/${encodeURIComponent(linked.id)}`, "le-text-link"));
      } else if (liveLocal().ticketmasterKey) {
        const key = `kpopmatch:${artist.id}`;
        if (liveUi.status.has(key)) {
          item.append(leSection(key, () => liveSearchAttractions(artist.name.replace(/\s*\([^)]*\)\s*/g, " ").trim()), (candidates) => (candidates.length
            ? leCandidateList(candidates.slice(0, 5), (candidate) => { liveFollow(candidate, { kpopId: artist.id }); liveRefresh("le-message"); })
            : leEmpty(`No Ticketmaster artist found for ${artist.name}.`))));
        } else {
          item.append(leButton("Find on Ticketmaster", () => { liveLoad(key, () => liveSearchAttractions(artist.name.replace(/\s*\([^)]*\)\s*/g, " ").trim())); liveRefresh(); }, "secondary", `le-kpop-${artist.id}`));
        }
      } else {
        item.append(leEl("small", "le-hint", "Add a Ticketmaster key to match"));
      }
      list.append(item);
    }
    kpop.append(list);
  }
  wrap.append(kpop);
  return wrap;
}

function createLiveArtist(id) {
  const follow = liveGetState().follows.find((item) => item.id === id);
  const wrap = leEl("div", "le-stack");
  // A MusicBrainz-only follow that has since been matched to Ticketmaster lives under its new ID.
  const moved = !follow && id.startsWith("mb:") ? liveGetState().follows.find((item) => item.mbid === id.slice(3) && item.following) : null;
  if (moved) {
    setTimeout(() => location.replace(`#live/artist/${encodeURIComponent(moved.id)}`), 0);
    wrap.append(leLoading(`Opening ${moved.name}…`));
    return wrap;
  }
  if (!follow) {
    wrap.append(leEmpty("You’re not following this artist.", leLink("Your artists", "#live/artists", "le-text-link")));
    return wrap;
  }
  const head = leEl("section", "le-panel le-artist-head");
  head.setAttribute("aria-labelledby", "le-artist-name");
  head.append(leImage(follow.image, "le-artist-hero", follow.name[0]));
  const copy = leEl("div", "le-stack-tight");
  const name = leEl("h3", "", follow.name);
  name.id = "le-artist-name";
  name.tabIndex = -1;
  copy.append(name);
  const links = leEl("div", "le-actions");
  if (follow.mbid) links.append(leLink("MusicBrainz ↗", `https://musicbrainz.org/artist/${follow.mbid}`, "le-text-link"), leLink("Music Lab profile", `#music/person/${follow.mbid}`, "le-text-link"));
  links.append(leConfirm(`unfollow-${follow.id}`, "Unfollow", () => {
    liveUpsert("follows", { ...follow, following: false });
    liveUi.status.delete("followed");
    liveSetMessage(`Unfollowed ${follow.name}.`);
    location.hash = "#live/artists";
  }));
  copy.append(links);
  head.append(copy);
  wrap.append(head);

  const shows = lePanel("Upcoming shows", "le-artist-shows-title");
  if (follow.tmId) {
    shows.append(leSection(`artist:${follow.tmId}`, () => liveSearchEvents({ attractionId: follow.tmId, size: 50 }), (value) => {
      if (!value.events.length) return leEmpty(`Ticketmaster lists no upcoming shows for ${follow.name}.`);
      const box = leEl("div", "le-stack");
      const soon = value.events.filter((event) => event.onSale && Date.parse(event.onSale) > Date.now());
      if (soon.length) {
        const note = leEl("p", "le-banner");
        note.append(leEl("strong", "", "Tour announcement: "), `${soon.length} show${soon.length === 1 ? "" : "s"} go${soon.length === 1 ? "es" : ""} on sale from ${leDate(soon.map((event) => event.onSale).sort()[0], { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}.`);
        box.append(note);
      }
      box.append(leEventList(value.events));
      return box;
    }));
  } else if (!liveLocal().ticketmasterKey) {
    shows.append(leNeedsKey("Upcoming shows"));
  } else if (follow.mbid) {
    shows.append(leSection(`link:${follow.id}`, async () => {
      const linked = await liveResolveFollow(follow);
      return { linked, candidates: linked ? [] : await liveSearchAttractions(follow.name) };
    }, ({ linked, candidates }) => {
      if (linked) {
        setTimeout(() => { location.replace(`#live/artist/${encodeURIComponent(linked.id)}`); }, 0);
        return leLoading(`Matched ${follow.name} on Ticketmaster by MusicBrainz ID…`);
      }
      const box = leEl("div", "le-stack");
      box.append(leEl("p", "le-hint", candidates.length
        ? `No Ticketmaster artist carries ${follow.name}’s MusicBrainz ID, so pick the right one to see their shows.`
        : `Ticketmaster has no artist named ${follow.name} right now.`));
      if (candidates.length) box.append(leCandidateList(candidates.slice(0, 5), (candidate) => {
        liveRemove("follows", follow.id);
        liveFollow({ ...candidate, mbid: candidate.mbid || follow.mbid }, { kpopId: follow.kpopId });
        location.hash = `#live/artist/${encodeURIComponent(`tm:${candidate.tmId}`)}`;
      }));
      return box;
    }));
  } else {
    shows.append(leEmpty("This artist isn’t matched to Ticketmaster, so upcoming shows can’t be listed."));
  }
  wrap.append(shows);

  const setlists = lePanel("Recent setlists", "le-artist-setlists-title");
  if (!liveSetlists) {
    liveLoadSetlists().then(() => liveRefresh());
    setlists.append(leLoading("Loading setlists…"));
  } else if (!follow.mbid) {
    setlists.append(leEmpty("setlist.fm identifies artists by MusicBrainz ID, which this match doesn’t have."));
  } else {
    const recent = liveSetlistsFor(follow.mbid);
    if (recent.length) {
      const list = leEl("ul", "le-simple-list");
      for (const setlist of recent.slice(0, 8)) {
        const item = leEl("li");
        const count = setlist.sets.reduce((sum, set) => sum + set.songs.length, 0);
        item.append(leLink(`${leDate(setlist.date)} · ${setlist.venue.name}, ${setlist.venue.city}`, setlist.url), leEl("small", "", `${count} songs${setlist.tour ? ` · ${setlist.tour}` : ""} · setlist.fm`));
        list.append(item);
      }
      setlists.append(list);
    } else {
      setlists.append(leEmpty("No setlists for this artist in the daily setlist.fm snapshot yet."));
    }
    const config = leEl("details", "le-details");
    config.append(leEl("summary", "", "Add this artist to the setlist snapshot"));
    const line = JSON.stringify({ name: follow.name, mbid: follow.mbid });
    const code = leEl("code", "le-code", line);
    config.append(leEl("p", "le-hint", "The daily build fetches setlists for artists listed in scripts/live_events_artists.json (it needs the SETLISTFM_API_KEY repository secret). Add this line to its artists list:"), code,
      leButton("Copy", async () => { try { await navigator.clipboard.writeText(line); liveSetMessage("Copied."); } catch { liveSetMessage("Copy didn’t work; select the text instead.", true); } liveRefresh("le-message"); }));
    setlists.append(config);
  }
  setlists.append(leEl("p", "le-hint le-attribution", "Setlists: setlist.fm"));
  wrap.append(setlists);
  return wrap;
}

// ---------- Event page ----------

function createLiveEvent(id) {
  const wrap = leEl("div", "le-stack");
  const plan = liveGetState().plans.find((item) => item.event.id === id);
  let event = liveUi.results.get(`event:${id}`) || null;
  const status = liveUi.status.get(`event:${id}`);
  if (!event && liveLocal().ticketmasterKey && !status) liveLoad(`event:${id}`, () => liveGetEvent(id));
  if (!event) event = plan?.event || null;
  if (!event) {
    if (!liveLocal().ticketmasterKey) wrap.append(leNeedsKey("Event details"));
    else if (status?.error) wrap.append(leError(status.error, () => { liveUi.status.delete(`event:${id}`); liveRefresh(); }));
    else wrap.append(leLoading("Loading this event from Ticketmaster…"));
    return wrap;
  }
  const fresh = liveUi.results.has(`event:${id}`);
  const head = leEl("section", "le-panel le-event-head");
  head.setAttribute("aria-labelledby", "le-event-name");
  head.append(leImage(event.image, "le-event-poster"));
  const copy = leEl("div", "le-stack-tight");
  const title = leEl("h3", "", event.name);
  title.id = "le-event-name";
  title.tabIndex = -1;
  copy.append(title);
  const meta = leEl("p", "le-meta");
  meta.append(leSourceBadge("Ticketmaster"), fresh ? " Live listing" : ` Saved with your plan ${leDate(plan?.event.fetchedAt || "", { month: "short", day: "numeric" })}; may be out of date`);
  if (event.status && event.status !== "onsale") meta.append(" ", leEl("span", `le-status le-status-${event.status}`, liveStatusLabels[event.status] || event.status));
  copy.append(meta);
  const when = leEl("p", "le-when");
  when.append(`${leDate(event.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${event.time ? ` · ${leTime(event.time)} local time` : ""}${event.timezone ? ` (${event.timezone})` : ""}`);
  const countdown = leCountdown(event.date);
  if (countdown) when.append(" ", countdown);
  copy.append(when, leEl("p", "le-where", [event.venue.name, event.venue.address, [event.venue.city, event.venue.state].filter(Boolean).join(", "), event.venue.country].filter(Boolean).join(" · ")));
  const actions = leEl("div", "le-actions");
  if (event.url) actions.append(leLink("Official tickets ↗", event.url, "le-button"));
  actions.append(leButton("Copy link to this page", async () => {
    try { await navigator.clipboard.writeText(location.href); liveSetMessage("Link copied. Others need their own Ticketmaster key to load it."); } catch { liveSetMessage("Copy didn’t work; use the address bar.", true); }
    liveRefresh("le-message");
  }));
  copy.append(actions);
  head.append(copy);
  wrap.append(head);

  const lineup = lePanel("Lineup", "le-lineup-title");
  if (event.attractions.length) {
    const list = leEl("ul", "le-lineup-list");
    event.attractions.forEach((attraction, index) => {
      const item = leEl("li");
      item.append(leImage(attraction.image, "le-avatar", attraction.name[0]));
      const text = leEl("div");
      text.append(leEl("strong", "", attraction.name), leEl("small", "", index === 0 ? "Headliner" : "Also on the bill"));
      item.append(text);
      const followed = liveGetState().follows.find((follow) => follow.tmId === attraction.id && follow.following);
      if (followed) item.append(leLink("Following", `#live/artist/${encodeURIComponent(followed.id)}`, "le-text-link"));
      else if (attraction.id) item.append(leButton("Follow", () => { liveFollow({ tmId: attraction.id, name: attraction.name, mbid: attraction.mbid, image: attraction.image }); liveRefresh("le-message"); }));
      list.append(item);
    });
    lineup.append(list);
  } else {
    lineup.append(leEmpty("Ticketmaster doesn’t list performers for this event."));
  }
  if (event.info) lineup.append(leEl("p", "le-info", event.info));
  if (event.priceRanges?.length) lineup.append(leEl("p", "le-hint", `Listed price range: ${event.priceRanges.map((range) => `${range.min}–${range.max} ${range.currency}`).join(", ")}`));
  wrap.append(lineup);

  const venue = lePanel("Venue", "le-venue-title");
  if (event.venue.coords) {
    const mapBox = leEl("div", "le-map le-map-small");
    venue.append(mapBox);
    leRenderMap(mapBox, [{ coords: event.venue.coords, title: event.venue.name, lines: [event.venue.city] }], { zoom: 14 });
    venue.append(leEl("p", "le-hint", "Venue location from Ticketmaster. Map © OpenStreetMap contributors."));
  } else {
    venue.append(leEmpty("Ticketmaster doesn’t give a location for this venue, so it isn’t mapped."));
  }
  wrap.append(venue);
  wrap.append(createLivePlanForm(event, plan));

  const setlist = lePanel("Setlist", "le-event-setlist-title");
  if (!liveSetlists) liveLoadSetlists().then(() => liveRefresh());
  const entry = liveGetState().journal.find((item) => item.eventId === event.id);
  const fromSnapshot = liveFindSetlist(event.attractions[0]?.mbid, event.date);
  if (entry?.setlist) {
    setlist.append(leSetlistView(entry.setlist));
  } else if (fromSnapshot) {
    setlist.append(leSetlistView(liveSetlistFromSnapshot(fromSnapshot)));
  } else {
    setlist.append(leEmpty(event.date && event.date > liveToday() ? "Setlists appear after the show, once someone adds one to setlist.fm or you log it in your journal." : "No setlist for this show yet. You can add one in your concert journal."));
  }
  wrap.append(setlist);
  return wrap;
}

function leSetlistView(setlist) {
  const box = leEl("div", "le-setlist");
  let encore = -1;
  let list = null;
  for (const song of setlist.songs) {
    if (song.encore !== encore) {
      encore = song.encore;
      box.append(leEl("h4", "", encore ? (encore === 1 ? "Encore" : `Encore ${encore}`) : "Main set"));
      list = leEl("ol", "le-songs");
      box.append(list);
    }
    list.append(leEl("li", "", song.name));
  }
  const source = leEl("p", "le-hint le-attribution");
  if (setlist.source === "setlist.fm") {
    source.append("Setlist from ", leLink("setlist.fm", setlist.url || "https://www.setlist.fm/"), setlist.edited ? " (edited by you)" : "", setlist.tour ? ` · ${setlist.tour}` : "");
  } else {
    source.append("Setlist entered by you");
  }
  box.append(source);
  return box;
}

// ---------- Planner ----------

function createLivePlanForm(event, plan) {
  const panel = lePanel("Your plans (private)", `le-plan-form-${event.id}`);
  panel.append(leEl("p", "le-hint", "Only you see this: it’s saved in your browser and your own synced account."));
  const form = leEl("form", "le-form-grid");
  const status = leSelect("le-p-status", livePlanStatuses.map((value) => [value, value]), plan?.status || "Interested");
  const price = leInput("le-p-price", plan?.price ?? "", { type: "number", step: "0.01" });
  const expenses = leInput("le-p-expenses", plan?.expenses ?? "", { type: "number", step: "0.01" });
  const currency = leInput("le-p-currency", plan?.currency || "", { placeholder: "USD" });
  const seat = leInput("le-p-seat", plan?.seat || "", { placeholder: "Section, row, seat" });
  const friends = leInput("le-p-friends", plan?.friends || "", { placeholder: "Who’s going" });
  const travel = leTextarea("le-p-travel", plan?.travel || "", "Flights, trains, parking");
  const hotel = leTextarea("le-p-hotel", plan?.hotel || "", "Where you’re staying");
  const notes = leTextarea("le-p-notes", plan?.notes || "", "Anything else");
  const wide = (field) => { field.classList.add("le-wide"); return field; };
  form.append(leField("Status", status), leField("Ticket price", price), leField("Currency", currency), leField("Estimated trip expenses", expenses), leField("Seat", seat), leField("Friends attending", friends),
    wide(leField("Travel notes", travel)), wide(leField("Hotel notes", hotel)), wide(leField("Notes", notes)));
  const actions = leEl("div", "le-actions le-wide");
  const save = leEl("button", "", plan ? "Save plan" : "Add to planner");
  save.type = "submit";
  actions.append(save);
  if (plan) {
    actions.append(leConfirm(`plan-${plan.id}`, "Remove", () => {
      liveRemove("plans", plan.id);
      liveSetMessage("Removed from your planner.");
      liveRefresh("le-message");
    }));
    const journal = plan.journalId ? liveGetState().journal.find((entry) => entry.id === plan.journalId) : null;
    if (journal) actions.append(leLink("Open journal entry", `#live/journal/${encodeURIComponent(journal.id)}`, "le-text-link"));
    else if (plan.status === "Attended" || (event.date && event.date <= liveToday())) actions.append(leButton("Add to concert journal", () => liveJournalFromEvent(event, plan)));
  }
  form.append(actions);
  form.addEventListener("submit", (submitEvent) => {
    submitEvent.preventDefault();
    const number = (input) => (input.value === "" ? null : Number(input.value));
    liveUpsert("plans", { ...(plan || { id: liveId("plan") }), event: { ...event, fetchedAt: plan?.event.fetchedAt && !liveUi.results.has(`event:${event.id}`) ? plan.event.fetchedAt : new Date().toISOString() },
      status: status.value, price: number(price), expenses: number(expenses), currency: currency.value, seat: seat.value, friends: friends.value, travel: travel.value, hotel: hotel.value, notes: notes.value });
    liveSetMessage(plan ? "Plan saved." : `Added “${event.name}” to your planner.`);
    liveRefresh("le-message");
  });
  panel.append(form);
  return panel;
}

function liveJournalFromEvent(event, plan) {
  const id = liveId("show");
  liveUpsert("journal", { id, date: event.date || liveToday(), artist: { name: event.attractions[0]?.name || event.name, mbid: event.attractions[0]?.mbid || "", tmId: event.attractions[0]?.id || "" },
    venue: event.venue.name, city: event.venue.city, country: event.venue.country, tour: event.name !== event.attractions[0]?.name ? event.name : "",
    seat: plan?.seat || "", price: plan?.price ?? null, currency: plan?.currency || "", lineup: event.attractions.slice(1).map((attraction) => attraction.name),
    coords: event.venue.coords, eventId: event.id });
  if (plan) liveUpsert("plans", { ...plan, status: "Attended", journalId: id });
  liveUi.editing = { id };
  liveSetMessage("Added to your concert journal. Fill in your rating, favorite moment and setlist.");
  location.hash = `#live/journal/${encodeURIComponent(id)}`;
}

function createLivePlanner() {
  const state = liveGetState();
  const wrap = leEl("div", "le-stack");
  const panel = lePanel("Event planner", "le-planner-title");
  if (!state.plans.length) {
    panel.append(leEmpty("Your planner is empty. Add concerts from Discover or an artist’s page.", leLink("Discover concerts", "#live/discover", "le-text-link")));
    wrap.append(panel);
    return wrap;
  }
  const today = liveToday();
  const upcoming = state.plans.filter((plan) => !["Cancelled", "Attended"].includes(plan.status) && (!plan.event.date || plan.event.date >= today));
  const spend = upcoming.reduce((sum, plan) => sum + (plan.price || 0) + (plan.expenses || 0), 0);
  const currencies = [...new Set(upcoming.map((plan) => plan.currency).filter(Boolean))];
  panel.append(leEl("p", "le-hint", `${upcoming.length} upcoming${spend ? ` · about ${spend.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currencies.length === 1 ? currencies[0] : ""} planned on tickets and travel${currencies.length > 1 ? " (mixed currencies)" : ""}` : ""}.`));
  for (const status of livePlanStatuses) {
    const plans = state.plans.filter((plan) => plan.status === status).sort((a, b) => (a.event.date || "9999").localeCompare(b.event.date || "9999"));
    if (!plans.length) continue;
    const group = leEl("section", "le-plan-group");
    group.style.setProperty("--le-plan", livePlanColors[status]);
    const heading = leEl("h4", "", `${status} (${plans.length})`);
    group.append(heading);
    for (const plan of plans) {
      const row = leEl("article", "le-plan");
      row.append(leImage(plan.event.image, "le-plan-poster"));
      const copy = leEl("div", "le-stack-tight");
      copy.append(leLink(plan.event.name, `#live/event/${encodeURIComponent(plan.event.id)}`, "le-event-title"));
      const when = leEl("p", "le-when", `${leDate(plan.event.date)} · ${plan.event.venue.name}, ${plan.event.venue.city}`);
      const countdown = plan.status !== "Attended" && plan.status !== "Cancelled" ? leCountdown(plan.event.date) : null;
      if (countdown) when.append(" ", countdown);
      copy.append(when);
      const extras = [plan.seat && `Seat ${plan.seat}`, plan.price !== null && `Ticket ${plan.price}${plan.currency ? ` ${plan.currency}` : ""}`, plan.expenses !== null && `Trip ~${plan.expenses}${plan.currency ? ` ${plan.currency}` : ""}`, plan.friends && `With ${plan.friends}`].filter(Boolean).join(" · ");
      if (extras) copy.append(leEl("p", "le-hint", extras));
      row.append(copy, lePlanSelect(plan.event, plan));
      group.append(row);
    }
    panel.append(group);
  }
  wrap.append(panel);
  return wrap;
}

// ---------- Journal ----------

function leJournalList(entries) {
  const list = leEl("ul", "le-journal-list");
  for (const entry of entries) {
    const item = leEl("li");
    const link = leLink("", `#live/journal/${encodeURIComponent(entry.id)}`, "le-journal-item");
    link.append(leEl("strong", "", entry.artist.name), leEl("span", "", `${leDate(entry.date)} · ${[entry.venue, entry.city].filter(Boolean).join(", ")}`),
      leEl("small", "", [entry.rating ? `${entry.rating}/10` : "", entry.setlist ? `${entry.setlist.songs.length}-song setlist` : "", entry.coords ? "" : "not on map"].filter(Boolean).join(" · ")));
    item.append(link);
    list.append(item);
  }
  return list;
}

function createLiveJournal(id) {
  const state = liveGetState();
  const wrap = leEl("div", "le-stack");
  if (id === "new" || liveUi.editing?.id === id || (id && !state.journal.some((entry) => entry.id === id) && id !== "new")) {
    if (id && id !== "new" && !state.journal.some((entry) => entry.id === id)) {
      wrap.append(leEmpty("This journal entry doesn’t exist (it may have been deleted).", leLink("Your journal", "#live/journal", "le-text-link")));
      return wrap;
    }
    wrap.append(createLiveJournalForm(id === "new" ? null : state.journal.find((entry) => entry.id === id)));
    return wrap;
  }
  if (id) {
    wrap.append(createLiveJournalEntry(state.journal.find((entry) => entry.id === id)));
    return wrap;
  }
  const panel = lePanel("Concert journal", "le-journal-title");
  const filters = liveUi.journalFilter;
  const years = [...new Set(state.journal.map((entry) => entry.date.slice(0, 4)))].sort().reverse();
  const head = leEl("div", "le-panel-head");
  const toolbar = leEl("div", "le-filters");
  const search = leInput("le-j-search", filters.query, { type: "search", placeholder: "Artist, venue, city, song" });
  const year = leSelect("le-j-year", [["all", "All years"], ...years.map((value) => [value, value])], filters.year);
  toolbar.append(leField("Search", search), leField("Year", year));
  head.append(toolbar, leLink("Log a concert", "#live/journal/new", "le-button"));
  const count = leEl("p", "le-count");
  count.setAttribute("aria-live", "polite");
  const results = leEl("div");
  const render = () => {
    const words = filters.query.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = state.journal.filter((entry) => (filters.year === "all" || entry.date.startsWith(filters.year))
      && words.every((word) => `${entry.artist.name} ${entry.venue} ${entry.city} ${entry.country} ${entry.tour} ${entry.lineup.join(" ")} ${entry.setlist?.songs.map((song) => song.name).join(" ") || ""} ${entry.notes}`.toLowerCase().includes(word)))
      .sort((a, b) => b.date.localeCompare(a.date));
    count.textContent = `${rows.length} of ${state.journal.length} concert${state.journal.length === 1 ? "" : "s"}`;
    results.replaceChildren(rows.length ? leJournalList(rows) : leEmpty(state.journal.length ? "No concerts match." : "Log the shows you’ve been to: who, where, your seat, rating, favorite moment, photos and the setlist."));
  };
  search.addEventListener("input", () => { filters.query = search.value; render(); });
  year.addEventListener("change", () => { filters.year = year.value; render(); });
  render();
  panel.append(head, count, results);
  wrap.append(panel);
  return wrap;
}

function createLiveJournalEntry(entry) {
  const panel = lePanel(`${entry.artist.name} · ${leDate(entry.date)}`, "le-entry-title", "le-entry");
  const meta = leEl("p", "le-meta");
  meta.append(leSourceBadge("Your entry"), ` ${[entry.venue, entry.city, entry.country].filter(Boolean).join(", ")}`);
  panel.append(meta);
  const facts = leEl("dl", "le-facts");
  for (const [label, value] of [["Tour", entry.tour], ["Seat", entry.seat], ["Ticket", entry.price !== null ? `${entry.price}${entry.currency ? ` ${entry.currency}` : ""}` : ""], ["Rating", entry.rating ? `${entry.rating}/10` : ""],
    ["Favorite performance", entry.favorite], ["Also on the bill", entry.lineup.join(", ")]]) {
    if (!value) continue;
    facts.append(leEl("dt", "", label), leEl("dd", "", value));
  }
  panel.append(facts);
  if (entry.notes) panel.append(leEl("p", "le-notes", entry.notes));
  if (entry.photos.length) {
    const photos = leEl("div", "le-photos");
    entry.photos.forEach((url, index) => {
      const link = leLink("", url, "le-photo");
      const image = document.createElement("img");
      image.src = url;
      image.alt = `Photo ${index + 1} from ${entry.artist.name}`;
      image.loading = "lazy";
      image.addEventListener("error", () => image.replaceWith(leEl("span", "", `Photo link ${index + 1} ↗`)), { once: true });
      link.append(image);
      photos.append(link);
    });
    panel.append(photos);
  }
  if (entry.setlist) {
    panel.append(leEl("h4", "", "Setlist"), leSetlistView(entry.setlist));
  }
  if (entry.coords) {
    const map = leEl("div", "le-map le-map-small");
    panel.append(map);
    leRenderMap(map, [{ coords: entry.coords, title: entry.venue || entry.city, lines: [entry.artist.name] }], { zoom: 13 });
    panel.append(leEl("p", "le-hint", `Location from ${entry.coords.source === "ticketmaster" ? "Ticketmaster" : "OpenStreetMap"}. Map © OpenStreetMap contributors.`));
  }
  const actions = leEl("div", "le-actions");
  actions.append(leButton("Edit", () => { liveUi.editing = { id: entry.id }; liveRefresh("le-j-date"); }, "", "le-edit-entry"), leLink("All concerts", "#live/journal", "le-text-link"));
  if (entry.eventId) actions.append(leLink("Event page", `#live/event/${encodeURIComponent(entry.eventId)}`, "le-text-link"));
  actions.append(leConfirm(`entry-${entry.id}`, "Delete", () => {
    liveRemove("journal", entry.id);
    liveSetMessage("Journal entry deleted.");
    location.hash = "#live/journal";
  }));
  panel.append(actions);
  return panel;
}

function createLiveJournalForm(entry) {
  const draft = entry || {};
  const panel = lePanel(entry ? "Edit concert" : "Log a concert", "le-journal-form-title");
  const form = leEl("form", "le-form-grid");
  form.noValidate = true;
  const follows = liveGetState().follows;
  const date = leInput("le-j-date", draft.date || liveToday(), { type: "date" });
  const artist = leInput("le-j-artist", draft.artist?.name || "", { list: "le-j-artists", placeholder: "Who you saw" });
  const venue = leInput("le-j-venue", draft.venue || "");
  const city = leInput("le-j-city", draft.city || "");
  const country = leInput("le-j-country", draft.country || "");
  const tour = leInput("le-j-tour", draft.tour || "");
  const seat = leInput("le-j-seat", draft.seat || "");
  const price = leInput("le-j-price", draft.price ?? "", { type: "number", step: "0.01" });
  const currency = leInput("le-j-currency", draft.currency || "", { placeholder: "USD" });
  const rating = leSelect("le-j-rating", [["", "Not rated"], ...Array.from({ length: 10 }, (_, index) => [String(index + 1), `${index + 1} / 10`])], draft.rating ? String(draft.rating) : "");
  const favorite = leInput("le-j-favorite", draft.favorite || "", { placeholder: "Best song or moment" });
  const lineup = leInput("le-j-lineup", (draft.lineup || []).join(", "), { placeholder: "Openers, guests (comma-separated)" });
  const photos = leTextarea("le-j-photos", (draft.photos || []).join("\n"), "One photo or album link per line (e.g. Google Photos, Instagram)", 2);
  const notes = leTextarea("le-j-notes", draft.notes || "", "How it was");
  const setlistText = leTextarea("le-j-setlist", liveSetlistText(draft.setlist?.songs), "One song per line. Type “Encore” on its own line before encore songs.", 8);
  const artistList = document.createElement("datalist");
  artistList.id = "le-j-artists";
  for (const follow of follows) {
    const option = document.createElement("option");
    option.value = follow.name;
    artistList.append(option);
  }
  const wide = (field) => { field.classList.add("le-wide"); return field; };
  form.append(leField("Date", date), leField("Artist", artist), leField("Venue", venue), leField("City", city), leField("Country", country), leField("Tour", tour), leField("Seat or section", seat),
    leField("Ticket price", price), leField("Currency", currency), leField("Your rating", rating), leField("Favorite performance", favorite), wide(leField("Other artists on the bill", lineup)),
    wide(leField("Photos", photos, "Links only; photos stay wherever you host them.")), wide(leField("Notes", notes)), artistList);
  // Setlist with optional setlist.fm import
  let setlistSource = draft.setlist?.source === "setlist.fm" ? { ...draft.setlist } : null;
  const setlistField = wide(leField("Setlist", setlistText));
  const setlistNote = leEl("p", "le-hint");
  const updateNote = () => {
    setlistNote.replaceChildren();
    if (setlistSource) setlistNote.append("Imported from ", leLink("setlist.fm", setlistSource.url || "https://www.setlist.fm/"), ". Edits you make are kept and marked as yours.");
    else setlistNote.append("Entered by you.");
  };
  updateNote();
  setlistField.append(setlistNote, leButton("Find this show on setlist.fm", async () => {
    await liveLoadSetlists();
    const follow = follows.find((item) => item.name.toLowerCase() === artist.value.trim().toLowerCase() && item.mbid);
    const found = liveFindSetlist(draft.artist?.mbid || follow?.mbid, date.value);
    if (!found) {
      setlistNote.textContent = follow?.mbid || draft.artist?.mbid ? "No setlist.fm setlist for that artist and date in the daily snapshot." : "setlist.fm lookups need a followed artist with a MusicBrainz ID that’s in the setlist snapshot.";
      return;
    }
    const imported = liveSetlistFromSnapshot(found);
    setlistText.value = liveSetlistText(imported.songs);
    setlistSource = imported;
    if (!tour.value && imported.tour) tour.value = imported.tour;
    updateNote();
  }, "secondary", "le-j-find-setlist"));
  form.append(setlistField);
  // Location: from a linked Ticketmaster event, or an OpenStreetMap lookup you choose.
  let coords = draft.coords || null;
  const locationField = leEl("div", "field le-wide");
  locationField.append(leEl("span", "le-label", "Map location"));
  const locationText = leEl("p", "le-hint");
  const results = leEl("ul", "le-simple-list");
  const showLocation = () => {
    locationText.textContent = coords ? `${coords.label || "Pinned"} (from ${coords.source === "ticketmaster" ? "Ticketmaster" : "OpenStreetMap"})` : "Not on the map yet.";
  };
  showLocation();
  locationField.append(locationText, leButton("Look up venue on OpenStreetMap", async () => {
    results.replaceChildren(leLoading("Searching OpenStreetMap…"));
    try {
      const rows = await liveGeocode([venue.value, city.value, country.value].filter(Boolean).join(", "));
      results.replaceChildren();
      if (!rows.length) results.append(leEl("li", "le-hint", "No places found. Check the venue and city spelling."));
      for (const row of rows) {
        const item = leEl("li");
        item.append(leEl("span", "", row.label), leButton("Use this", () => {
          coords = { lat: row.lat, lon: row.lon, source: "openstreetmap", label: row.label };
          if (!city.value && row.city) city.value = row.city;
          if (!country.value && row.country) country.value = row.country;
          results.replaceChildren();
          showLocation();
        }));
        results.append(item);
      }
    } catch (error) {
      results.replaceChildren(leEl("li", "le-error", error.message));
    }
  }, "secondary", "le-j-geocode"), leButton("Remove location", () => { coords = null; showLocation(); }, "secondary"), results,
  leEl("small", "le-hint", "Search results © OpenStreetMap contributors. Nothing is pinned unless you pick a result."));
  form.append(locationField);
  const error = leEl("p", "le-message error le-wide");
  error.setAttribute("role", "alert");
  const actions = leEl("div", "le-actions le-wide");
  const save = leEl("button", "", entry ? "Save" : "Add to journal");
  save.type = "submit";
  actions.append(save, leButton("Cancel", () => {
    liveUi.editing = null;
    if (entry) liveRefresh("le-entry-title");
    else location.hash = "#live/journal";
  }));
  form.append(error, actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const problem = !liveDate(date.value) ? [date, "Pick the date of the show."] : !artist.value.trim() ? [artist, "Who did you see?"] : null;
    if (problem) {
      error.textContent = problem[1];
      problem[0].setAttribute("aria-invalid", "true");
      problem[0].focus();
      return;
    }
    const songs = liveParseSetlist(setlistText.value);
    let setlist = null;
    if (songs.length) {
      const changed = setlistSource && liveSetlistText(songs) !== liveSetlistText(setlistSource.songs);
      setlist = setlistSource ? { ...setlistSource, songs, edited: Boolean(changed || setlistSource.edited) } : { songs, source: "manual" };
    }
    const follow = follows.find((item) => item.name.toLowerCase() === artist.value.trim().toLowerCase());
    const id = entry?.id || liveId("show");
    liveUpsert("journal", { ...(entry || {}), id, date: date.value,
      artist: { name: artist.value.trim(), mbid: entry?.artist.name === artist.value.trim() ? entry.artist.mbid : follow?.mbid || "", tmId: entry?.artist.name === artist.value.trim() ? entry.artist.tmId : follow?.tmId || "" },
      venue: venue.value, city: city.value, country: country.value, tour: tour.value, seat: seat.value, price: price.value === "" ? null : Number(price.value), currency: currency.value,
      rating: rating.value ? Number(rating.value) : null, favorite: favorite.value, lineup: lineup.value.split(",").map((name) => name.trim()).filter(Boolean),
      photos: photos.value.split(/\s+/).filter(Boolean), notes: notes.value, setlist, coords });
    liveUi.editing = null;
    liveSetMessage(entry ? "Saved." : "Concert added to your journal.");
    if (location.hash === `#live/journal/${encodeURIComponent(id)}`) liveRefresh("le-message");
    else location.hash = `#live/journal/${encodeURIComponent(id)}`;
  });
  panel.append(form);
  return panel;
}

// ---------- Map ----------

let liveLeafletPromise = null;

function liveLoadLeaflet() {
  if (window.L?.map) return Promise.resolve(window.L);
  if (!liveLeafletPromise) {
    liveLeafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.append(css);
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      script.onload = () => (window.L?.map ? resolve(window.L) : reject(new Error("The map library didn’t load.")));
      script.onerror = () => reject(new Error("The map couldn’t load. Check your connection."));
      document.head.append(script);
    }).catch((error) => {
      liveLeafletPromise = null;
      throw error;
    });
  }
  return liveLeafletPromise;
}

// points: [{ coords, title, lines: [], href }]
function leRenderMap(container, points, { zoom = 4 } = {}) {
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", "Map");
  container.append(leLoading("Loading map…"));
  liveLoadLeaflet().then((L) => {
    if (!container.isConnected) return;
    container.replaceChildren();
    const map = L.map(container, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors" }).addTo(map);
    const bounds = [];
    for (const point of points) {
      const marker = L.marker([point.coords.lat, point.coords.lon], { title: point.title, alt: point.title }).addTo(map);
      const popup = leEl("div", "le-popup");
      popup.append(leEl("strong", "", point.title));
      for (const line of point.lines) {
        if (line && typeof line === "object") popup.append(leLink(line.text, line.href));
        else if (line) popup.append(leEl("span", "", line));
      }
      marker.bindPopup(popup);
      bounds.push([point.coords.lat, point.coords.lon]);
    }
    if (bounds.length === 1) map.setView(bounds[0], zoom);
    else if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    else map.setView([20, 0], 2);
    container.leafletMap = map;
  }).catch((error) => {
    container.replaceChildren(leError(error.message));
  });
}

function createLiveMap() {
  const state = liveGetState();
  const filters = liveUi.mapFilter;
  const wrap = leEl("div", "le-stack");
  const panel = lePanel("Where you’ve seen shows", "le-map-title");
  const years = [...new Set(state.journal.map((entry) => entry.date.slice(0, 4)))].sort().reverse();
  const countries = [...new Set(state.journal.map((entry) => entry.country).filter(Boolean))].sort();
  const toolbar = leEl("div", "le-filters");
  const year = leSelect("le-map-year", [["all", "All years"], ...years.map((value) => [value, value])], filters.year);
  const country = leSelect("le-map-country", [["all", "All countries"], ...countries.map((value) => [value, value])], filters.country);
  year.addEventListener("change", () => { filters.year = year.value; liveRefresh(year.id); });
  country.addEventListener("change", () => { filters.country = country.value; liveRefresh(country.id); });
  toolbar.append(leField("Year", year), leField("Country", country));
  panel.append(toolbar);
  const entries = state.journal.filter((entry) => (filters.year === "all" || entry.date.startsWith(filters.year)) && (filters.country === "all" || entry.country === filters.country));
  const located = entries.filter((entry) => entry.coords);
  const groups = new Map();
  for (const entry of located) {
    const key = `${entry.coords.lat.toFixed(4)},${entry.coords.lon.toFixed(4)}`;
    groups.set(key, [...(groups.get(key) || []), entry]);
  }
  const points = [...groups.values()].map((list) => ({
    coords: list[0].coords, title: list[0].venue || list[0].city || "Concert",
    lines: list.sort((a, b) => b.date.localeCompare(a.date)).map((entry) => ({ text: `${entry.artist.name} · ${leDate(entry.date, { month: "short", day: "numeric", year: "numeric" })}${entry.rating ? ` · ${entry.rating}/10` : ""}`, href: `#live/journal/${encodeURIComponent(entry.id)}` }))
  }));
  panel.append(leEl("p", "le-count", `${located.length} of ${entries.length} concert${entries.length === 1 ? "" : "s"} mapped at ${groups.size} place${groups.size === 1 ? "" : "s"}`));
  if (!state.journal.length) {
    panel.append(leEmpty("Log concerts in your journal and give them a location to see them here."));
  } else {
    const map = leEl("div", "le-map");
    panel.append(map);
    leRenderMap(map, points);
    panel.append(leEl("p", "le-hint", "Map © OpenStreetMap contributors. Pins use venue locations from Ticketmaster or an OpenStreetMap result you chose; concerts without one aren’t mapped."));
    const list = leEl("details", "le-details");
    list.append(leEl("summary", "", "Places as a list"));
    const ul = leEl("ul", "le-simple-list");
    for (const point of points) {
      const item = leEl("li");
      item.append(leEl("strong", "", point.title));
      for (const line of point.lines) item.append(leLink(line.text, line.href));
      ul.append(item);
    }
    list.append(ul);
    panel.append(list);
    const missing = entries.filter((entry) => !entry.coords);
    if (missing.length) panel.append(leEl("p", "le-hint", `${missing.length} concert${missing.length === 1 ? " has" : "s have"} no location. Open ${missing.length === 1 ? "it" : "them"} in the journal and use “Look up venue on OpenStreetMap”.`));
  }
  wrap.append(panel);
  return wrap;
}

// ---------- Settings ----------

function createLiveSettings() {
  const local = liveLocal();
  const wrap = leEl("div", "le-stack");
  const keyPanel = lePanel("Ticketmaster", "le-key-title");
  const keyForm = leEl("form", "le-form-row");
  const key = leInput("le-tm-key", local.ticketmasterKey, { type: "password", placeholder: "Consumer key" });
  key.autocomplete = "off";
  const save = leEl("button", "", "Save key");
  save.type = "submit";
  keyForm.append(leField("Ticketmaster API key", key), save, leButton("Remove", () => { liveSaveLocal({ ticketmasterKey: "" }); liveUi.status.clear(); liveUi.results.clear(); liveSetMessage("Key removed from this browser."); liveRefresh("le-message"); }));
  keyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    liveSaveLocal({ ticketmasterKey: key.value.trim() });
    liveUi.status.clear();
    liveUi.results.clear();
    liveSetMessage(key.value.trim() ? "Ticketmaster key saved in this browser." : "Key cleared.");
    liveRefresh("le-message");
  });
  keyPanel.append(leEl("p", "le-hint", "Concert listings come from Ticketmaster’s official Discovery API. Get a free key at developer.ticketmaster.com (My Apps → Consumer Key). It’s stored only in this browser, isn’t synced to your account and is never added to the site’s code. Ticketmaster allows 5,000 requests a day; results are cached for 3 hours."),
    keyForm, leLink("Get a Ticketmaster API key ↗", "https://developer.ticketmaster.com/", "le-text-link"));
  wrap.append(keyPanel);

  const placePanel = lePanel("Your location", "le-place-title");
  placePanel.append(leEl("p", "le-hint", "Used only for “Near you”. It stays in this browser and isn’t synced."));
  if (local.location) placePanel.append(leEl("p", "", `Current: ${local.location.label} · within ${local.location.radius} miles`));
  const form = leEl("form", "le-form-row");
  const city = leInput("le-place-q", "", { placeholder: "City, e.g. Chicago" });
  const radius = leSelect("le-radius", [["10", "10 miles"], ["25", "25 miles"], ["50", "50 miles"], ["100", "100 miles"], ["200", "200 miles"]], String(local.location?.radius || 50));
  radius.addEventListener("change", () => {
    if (liveLocal().location) {
      liveSaveLocal({ location: { ...liveLocal().location, radius: Number(radius.value) } });
      liveSetMessage(`Radius set to ${radius.value} miles.`);
      liveRefresh("le-radius");
    }
  });
  const find = leEl("button", "", "Find city");
  find.type = "submit";
  form.append(leField("City", city), leField("Radius", radius), find);
  const results = leEl("ul", "le-simple-list");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!city.value.trim()) return;
    results.replaceChildren(leLoading("Searching OpenStreetMap…"));
    try {
      const rows = await liveGeocode(city.value.trim());
      results.replaceChildren();
      if (!rows.length) results.append(leEl("li", "le-hint", "No places found."));
      for (const row of rows) {
        const item = leEl("li");
        item.append(leEl("span", "", row.label), leButton("Use this", () => {
          liveSaveLocal({ location: { lat: row.lat, lon: row.lon, label: row.city || row.label.split(",")[0], radius: Number(radius.value) } });
          liveSetMessage(`Location set to ${row.city || row.label.split(",")[0]}.`);
          liveRefresh("le-message");
        }));
        results.append(item);
      }
    } catch (error) {
      results.replaceChildren(leEl("li", "le-error", error.message));
    }
  });
  const actions = leEl("div", "le-actions");
  if ("geolocation" in navigator) {
    actions.append(leButton("Use my current location", () => {
      navigator.geolocation.getCurrentPosition((position) => {
        liveSaveLocal({ location: { lat: Math.round(position.coords.latitude * 100) / 100, lon: Math.round(position.coords.longitude * 100) / 100, label: "your current location", radius: Number(radius.value) } });
        liveSetMessage("Location set from your device (rounded to about 1 km).");
        liveRefresh("le-message");
      }, () => { liveSetMessage("Your browser didn’t share a location.", true); liveRefresh("le-message"); }, { maximumAge: 600000, timeout: 10000 });
    }));
  }
  if (local.location) actions.append(leButton("Clear location", () => { liveSaveLocal({ location: null }); liveSetMessage("Location cleared."); liveRefresh("le-message"); }));
  placePanel.append(form, results, actions, leEl("small", "le-hint", "City search © OpenStreetMap contributors (Nominatim)."));
  wrap.append(placePanel);

  const sources = lePanel("Data sources", "le-sources-title");
  const list = leEl("ul", "le-simple-list");
  for (const [name, text] of [["Ticketmaster Discovery API", "Upcoming events, venues, lineups, posters, status and official ticket links. Marked “Ticketmaster”."],
    ["setlist.fm API", "Setlists for artists listed in scripts/live_events_artists.json, refreshed daily by GitHub Actions with the SETLISTFM_API_KEY secret (setlist.fm doesn’t allow browser requests). Each links back to setlist.fm."],
    ["OpenStreetMap", "Map tiles and venue/city lookups. Coordinates are never guessed."],
    ["You", "Your planner, journal, ratings, notes, photos and manual setlists. Marked “Your entry”."]]) {
    const item = leEl("li");
    item.append(leEl("strong", "", name), leEl("small", "", text));
    list.append(item);
  }
  sources.append(list);
  if (!liveSetlists) liveLoadSetlists().then(() => { if (liveRoute().view === "settings") liveRefresh(); });
  else sources.append(leEl("p", "le-hint", liveSetlists.status === "no-key" ? "setlist.fm: no API key is configured for the daily build yet." : liveSetlists.status === "no-artists" ? "setlist.fm: the key is set, but no artists are listed in scripts/live_events_artists.json." : liveSetlists.generatedAt ? `setlist.fm snapshot updated ${leDate(liveSetlists.generatedAt)}${liveSetlists.status === "partial" ? " (some artists failed; their last setlists are kept)" : ""}.` : "setlist.fm snapshot not built yet."));
  wrap.append(sources);
  return wrap;
}
