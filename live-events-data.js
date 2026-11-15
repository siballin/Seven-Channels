// Live Events data layer: synced follows, planner and concert journal; Ticketmaster Discovery API (official,
// with the browser's saved key); OpenStreetMap Nominatim geocoding; setlist parsing; the setlist.fm snapshot.
// Verified event data (Ticketmaster, setlist.fm) is kept apart from what you enter yourself.

const liveStorageKey = "seven-channels.live-events.v1";
const liveLocalKey = "seven-channels.live-events-local.v1"; // location and API key: this browser only, never synced
const liveCacheKey = "seven-channels.live-events-cache.v1";
const livePlanStatuses = ["Interested", "Planning", "Ticket Purchased", "Attending", "Attended", "Cancelled"];
const liveGenres = ["Pop", "Rock", "Hip-Hop/Rap", "R&B", "Alternative", "Country", "Dance/Electronic", "Latin", "Metal", "Jazz", "Classical", "World", "Folk", "Blues", "Reggae"];
const liveLimits = { title: 200, text: 2000, note: 4000, song: 200, songs: 120, photos: 12 };

let liveState = null;
let liveOnChange = null;

function liveText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function liveId(prefix) {
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function liveDateTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
}

function liveDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00`)) ? value : "";
}

function liveTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value) ? value.slice(0, 5) : "";
}

function liveUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href.slice(0, 600) : "";
  } catch {
    return "";
  }
}

function liveMoney(value) {
  return Number.isFinite(value) && value >= 0 && value < 1e7 ? Math.round(value * 100) / 100 : null;
}

function liveMbid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) ? value : "";
}

function liveTmId(value) {
  return typeof value === "string" && /^[\w-]{1,60}$/.test(value) ? value : "";
}

function liveCoords(value) {
  if (!value || typeof value !== "object") return null;
  const lat = Number(value.lat);
  const lon = Number(value.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const source = ["ticketmaster", "openstreetmap"].includes(value.source) ? value.source : "";
  return source ? { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, source, label: liveText(value.label, 300) } : null;
}

function liveToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// ---------- Setlists ----------

// Manual entry: one song per line; a line "Encore" (or "Encore:", "--- encore ---") starts the encore.
function liveParseSetlist(text) {
  const songs = [];
  let encore = 0;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim();
    if (!line) continue;
    if (/^[-=\s]*encore\s*(\d+)?[:\s-]*$/i.test(line)) {
      encore += 1;
      continue;
    }
    songs.push({ name: line.slice(0, liveLimits.song), encore });
  }
  return songs.slice(0, liveLimits.songs);
}

function liveSetlistText(songs) {
  const lines = [];
  let encore = 0;
  for (const song of songs || []) {
    while (song.encore > encore) {
      encore += 1;
      lines.push(encore === 1 ? "Encore" : `Encore ${encore}`);
    }
    lines.push(song.name);
  }
  return lines.join("\n");
}

function liveNormalizeSetlist(value) {
  if (!value || typeof value !== "object") return null;
  const songs = (Array.isArray(value.songs) ? value.songs : []).map((song) => ({ name: liveText(song?.name, liveLimits.song), encore: Number.isInteger(song?.encore) && song.encore >= 0 && song.encore < 5 ? song.encore : 0 }))
    .filter((song) => song.name).slice(0, liveLimits.songs);
  if (!songs.length) return null;
  const source = value.source === "setlist.fm" ? "setlist.fm" : "manual";
  return { songs, source, url: source === "setlist.fm" ? liveUrl(value.url || "") : "", tour: liveText(value.tour, 200), edited: source === "setlist.fm" && value.edited === true };
}

// ---------- Ticketmaster events ----------

// A compact, stable snapshot of a Discovery API event (kept on plans so they work without the API).
function liveEventFromApi(event) {
  const venue = event?._embedded?.venues?.[0] || {};
  const images = (event?.images || []).filter((image) => image?.url?.startsWith("https://"));
  const poster = images.filter((image) => image.ratio === "16_9" && image.width >= 600).sort((a, b) => a.width - b.width)[0] || images.sort((a, b) => b.width - a.width)[0];
  const attractions = (event?._embedded?.attractions || []).map((attraction) => ({
    id: attraction.id || "", name: attraction.name || "",
    mbid: liveMbid(attraction.externalLinks?.musicbrainz?.[0]?.id || ""),
    image: (attraction.images || []).find((image) => image.ratio === "3_2" || image.ratio === "16_9")?.url || attraction.images?.[0]?.url || ""
  })).filter((attraction) => attraction.name);
  const classification = event?.classifications?.[0] || {};
  const lat = Number(venue.location?.latitude);
  const lon = Number(venue.location?.longitude);
  return {
    id: event?.id || "", name: event?.name || "", url: liveUrl(event?.url || ""),
    date: liveDate(event?.dates?.start?.localDate || ""), time: liveTime(event?.dates?.start?.localTime || ""),
    dateTime: liveDateTime(event?.dates?.start?.dateTime || ""), timezone: event?.dates?.timezone || venue.timezone || "",
    status: event?.dates?.status?.code || "", tbd: Boolean(event?.dates?.start?.dateTBD || event?.dates?.start?.timeTBA),
    onSale: liveDateTime(event?.sales?.public?.startDateTime || ""),
    image: poster?.url || "", attractions,
    venue: { id: venue.id || "", name: venue.name || "", city: venue.city?.name || "", state: venue.state?.stateCode || "", country: venue.country?.name || "", countryCode: venue.country?.countryCode || "",
      address: venue.address?.line1 || "", coords: Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) ? { lat, lon, source: "ticketmaster", label: venue.name || "" } : null },
    genre: classification.genre?.name && classification.genre.name !== "Undefined" ? classification.genre.name : "",
    segment: classification.segment?.name || "", info: liveText(event?.info || event?.pleaseNote || "", 1500),
    priceRanges: (event?.priceRanges || []).map((range) => ({ min: range.min, max: range.max, currency: range.currency })).filter((range) => Number.isFinite(range.min)).slice(0, 3)
  };
}

function liveNormalizeEventSnapshot(value) {
  if (!value || typeof value !== "object" || !liveTmId(value.id)) return null;
  return {
    id: value.id, name: liveText(value.name, liveLimits.title), url: liveUrl(value.url || ""), date: liveDate(value.date), time: liveTime(value.time),
    dateTime: liveDateTime(value.dateTime), timezone: liveText(value.timezone, 60), status: liveText(value.status, 30), image: liveUrl(value.image || ""),
    attractions: (Array.isArray(value.attractions) ? value.attractions : []).slice(0, 12).map((item) => ({ id: liveText(item?.id, 40), name: liveText(item?.name, 200), mbid: liveMbid(item?.mbid || ""), image: liveUrl(item?.image || "") })).filter((item) => item.name),
    venue: { id: liveText(value.venue?.id, 40), name: liveText(value.venue?.name, 200), city: liveText(value.venue?.city, 120), state: liveText(value.venue?.state, 20),
      country: liveText(value.venue?.country, 80), countryCode: liveText(value.venue?.countryCode, 4), address: liveText(value.venue?.address, 200), coords: liveCoords(value.venue?.coords) },
    genre: liveText(value.genre, 60), fetchedAt: liveDateTime(value.fetchedAt)
  };
}

const liveStatusLabels = { onsale: "On sale", offsale: "Off sale", canceled: "Cancelled", postponed: "Postponed", rescheduled: "Rescheduled" };

// ---------- Records ----------

function liveNormalizeFollow(value) {
  if (!value || typeof value !== "object") return null;
  const mbid = liveMbid(value.mbid || "");
  const tmId = liveTmId(value.tmId || "");
  const name = liveText(value.name, 200);
  if (!name || (!mbid && !tmId)) return null;
  return { id: tmId ? `tm:${tmId}` : `mb:${mbid}`, name, mbid, tmId, image: liveUrl(value.image || ""), kpopId: Number.isSafeInteger(value.kpopId) ? value.kpopId : null,
    following: value.following !== false, updatedAt: liveDateTime(value.updatedAt) };
}

function liveNormalizePlan(value) {
  if (!value || typeof value.id !== "string" || !value.id) return null;
  const event = liveNormalizeEventSnapshot(value.event);
  if (!event) return null;
  return {
    id: value.id.slice(0, 80), event, status: livePlanStatuses.includes(value.status) ? value.status : "Interested",
    price: liveMoney(value.price), expenses: liveMoney(value.expenses), currency: liveText(value.currency, 3).toUpperCase(),
    seat: liveText(value.seat, 200), travel: liveText(value.travel, liveLimits.text), hotel: liveText(value.hotel, liveLimits.text),
    friends: liveText(value.friends, 500), notes: liveText(value.notes, liveLimits.note), journalId: typeof value.journalId === "string" ? value.journalId.slice(0, 80) : "",
    createdAt: liveDateTime(value.createdAt), updatedAt: liveDateTime(value.updatedAt)
  };
}

function liveNormalizeEntry(value) {
  if (!value || typeof value.id !== "string" || !value.id) return null;
  const artist = liveText(value.artist?.name ?? value.artist, 200);
  const date = liveDate(value.date);
  if (!artist || !date) return null;
  return {
    id: value.id.slice(0, 80), date, artist: { name: artist, mbid: liveMbid(value.artist?.mbid || ""), tmId: liveTmId(value.artist?.tmId || "") },
    venue: liveText(value.venue, 200), city: liveText(value.city, 120), country: liveText(value.country, 80), tour: liveText(value.tour, 200),
    seat: liveText(value.seat, 200), price: liveMoney(value.price), currency: liveText(value.currency, 3).toUpperCase(),
    rating: Number.isInteger(value.rating) && value.rating >= 1 && value.rating <= 10 ? value.rating : null,
    favorite: liveText(value.favorite, 200), notes: liveText(value.notes, liveLimits.note),
    photos: (Array.isArray(value.photos) ? value.photos : []).map(liveUrl).filter(Boolean).slice(0, liveLimits.photos),
    lineup: (Array.isArray(value.lineup) ? value.lineup : []).map((name) => liveText(name, 200)).filter(Boolean).slice(0, 20),
    setlist: liveNormalizeSetlist(value.setlist), coords: liveCoords(value.coords), eventId: liveTmId(value.eventId || ""),
    createdAt: liveDateTime(value.createdAt), updatedAt: liveDateTime(value.updatedAt)
  };
}

const liveCollections = { follows: liveNormalizeFollow, plans: liveNormalizePlan, journal: liveNormalizeEntry };

function liveNormalizeState(value) {
  const source = value && typeof value === "object" ? value : {};
  const state = { deleted: {} };
  for (const [name, normalize] of Object.entries(liveCollections)) {
    state.deleted[name] = [...new Set((Array.isArray(source.deleted?.[name]) ? source.deleted[name] : []).filter((id) => typeof id === "string" && id))].sort();
    const gone = new Set(state.deleted[name]);
    const map = new Map();
    for (const record of (Array.isArray(source[name]) ? source[name] : []).map(normalize)) {
      if (record && !gone.has(record.id) && !map.has(record.id)) map.set(record.id, record);
    }
    state[name] = [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  return state;
}

function liveValidState(value) {
  return Boolean(value && typeof value === "object" && Array.isArray(value.journal) && Array.isArray(value.follows));
}

function liveNewer(a, b) {
  const left = Date.parse(a?.updatedAt || "") || 0;
  const right = Date.parse(b?.updatedAt || "") || 0;
  return left !== right ? left > right : JSON.stringify(a) > JSON.stringify(b);
}

function liveMergeState(local, remote) {
  const a = liveNormalizeState(local);
  const b = liveNormalizeState(remote);
  const merged = { deleted: {} };
  for (const name of Object.keys(liveCollections)) {
    merged.deleted[name] = [...a.deleted[name], ...b.deleted[name]];
    const map = new Map();
    for (const record of [...b[name], ...a[name]]) {
      const previous = map.get(record.id);
      if (!previous || liveNewer(record, previous)) map.set(record.id, record);
    }
    merged[name] = [...map.values()];
  }
  return liveNormalizeState(merged);
}

function liveGetState() {
  if (!liveState) {
    try {
      const saved = localStorage.getItem(liveStorageKey);
      liveState = liveNormalizeState(saved ? JSON.parse(saved) : {});
    } catch (error) {
      console.error("Could not load Live Events data.", error);
      if (typeof showNotice === "function") showNotice("Saved Live Events data couldn’t be read. New entries can still be saved.");
      liveState = liveNormalizeState({});
    }
  }
  return liveState;
}

function livePersist() {
  try {
    localStorage.setItem(liveStorageKey, JSON.stringify(liveState));
    return true;
  } catch (error) {
    console.error("Could not save Live Events data.", error);
    if (typeof showNotice === "function") showNotice("Your browser couldn’t save this Live Events change. Check your storage settings.");
    return false;
  }
}

function liveReplaceState(value) {
  liveState = liveNormalizeState(value);
  livePersist();
}

function liveCommit(mutate) {
  const next = structuredClone(liveGetState());
  mutate(next, new Date().toISOString());
  liveState = liveNormalizeState(next);
  const saved = livePersist();
  liveOnChange?.();
  return saved;
}

function liveUpsert(collection, record) {
  return liveCommit((next, now) => {
    const index = next[collection].findIndex((item) => item.id === record.id);
    const updated = { ...(index >= 0 ? next[collection][index] : { createdAt: now }), ...record, updatedAt: now };
    if (index >= 0) next[collection][index] = updated;
    else next[collection].push(updated);
  });
}

function liveRemove(collection, id) {
  return liveCommit((next) => {
    next[collection] = next[collection].filter((item) => item.id !== id);
    next.deleted[collection] = [...new Set([...next.deleted[collection], id])];
    if (collection === "journal") for (const plan of next.plans) if (plan.journalId === id) plan.journalId = "";
  });
}

// Settings that stay in this browser: the Ticketmaster key and your location.
function liveLocal() {
  try {
    const value = JSON.parse(localStorage.getItem(liveLocalKey) || "{}");
    const location = value.location && Number.isFinite(value.location.lat) && Number.isFinite(value.location.lon)
      ? { lat: value.location.lat, lon: value.location.lon, label: liveText(value.location.label, 200), radius: [10, 25, 50, 100, 200].includes(value.location.radius) ? value.location.radius : 50 } : null;
    return { ticketmasterKey: liveText(value.ticketmasterKey, 100), location };
  } catch {
    return { ticketmasterKey: "", location: null };
  }
}

function liveSaveLocal(changes) {
  try {
    localStorage.setItem(liveLocalKey, JSON.stringify({ ...liveLocal(), ...changes }));
    return true;
  } catch {
    return false;
  }
}

// ---------- Ticketmaster Discovery API ----------

function liveReadCache() {
  try {
    const value = JSON.parse(localStorage.getItem(liveCacheKey) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function liveWriteCache(key, data) {
  try {
    const cache = liveReadCache();
    cache[key] = { t: Date.now(), data };
    const keys = Object.keys(cache).sort((a, b) => cache[a].t - cache[b].t);
    while (keys.length > 60) delete cache[keys.shift()];
    localStorage.setItem(liveCacheKey, JSON.stringify(cache));
  } catch {
    // Cache is optional.
  }
}

let liveQueue = Promise.resolve();
let liveLast = 0;

// Ticketmaster allows 5 requests a second; requests are queued a quarter second apart and cached for 3 hours.
async function liveTicketmaster(path, params, { maxAge = 3 * 3600000 } = {}) {
  const key = liveLocal().ticketmasterKey;
  if (!key) throw new Error("Add your Ticketmaster API key in Live Events settings to load concerts.");
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== "" && value !== undefined && value !== null));
  const cacheKey = `${path}?${query}`;
  const hit = liveReadCache()[cacheKey];
  if (hit && Date.now() - hit.t < maxAge) return { ...hit.data, cachedAt: hit.t };
  const task = liveQueue.then(async () => {
    const wait = liveLast + 250 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    liveLast = Date.now();
    query.set("apikey", key);
    let response;
    try {
      response = await fetch(`https://app.ticketmaster.com/discovery/v2/${path}?${query}`);
    } catch {
      throw new Error("Couldn’t reach Ticketmaster. Check your connection and try again.");
    }
    if (response.status === 401) throw new Error("Ticketmaster didn’t accept the API key. Check it in Live Events settings.");
    if (response.status === 429) throw new Error("Ticketmaster’s rate limit was reached. Wait a minute and try again.");
    if (!response.ok) throw new Error(`Ticketmaster request failed (${response.status}).`);
    return response.json();
  });
  liveQueue = task.catch(() => {});
  const data = await task;
  liveWriteCache(cacheKey, data);
  return { ...data, cachedAt: Date.now() };
}

async function liveSearchEvents({ keyword = "", attractionId = "", city = "", countryCode = "", start = "", end = "", genre = "", latlong = "", radius = "", size = 50, page = 0 } = {}) {
  const data = await liveTicketmaster("events.json", {
    keyword, attractionId, city, countryCode, classificationName: genre || "music", latlong, radius, unit: radius ? "miles" : "",
    startDateTime: start ? `${start}T00:00:00Z` : "", endDateTime: end ? `${end}T23:59:59Z` : "",
    sort: latlong ? "distance,date,asc" : "date,asc", size: String(size), page: String(page)
  });
  return { events: (data._embedded?.events || []).map(liveEventFromApi).filter((event) => event.id), total: data.page?.totalElements ?? 0, cachedAt: data.cachedAt };
}

async function liveGetEvent(id) {
  const data = await liveTicketmaster(`events/${encodeURIComponent(id)}.json`, {});
  return liveEventFromApi(data);
}

async function liveSearchAttractions(keyword) {
  const data = await liveTicketmaster("attractions.json", { keyword, classificationName: "music", size: "12" });
  return (data._embedded?.attractions || []).map((attraction) => ({
    tmId: attraction.id, name: attraction.name, mbid: liveMbid(attraction.externalLinks?.musicbrainz?.[0]?.id || ""),
    image: (attraction.images || []).find((image) => image.ratio === "3_2")?.url || attraction.images?.[0]?.url || "",
    genre: attraction.classifications?.[0]?.genre?.name || "", upcoming: attraction.upcomingEvents?._total ?? null,
    links: { homepage: attraction.externalLinks?.homepage?.[0]?.url || "", wiki: attraction.externalLinks?.wiki?.[0]?.url || "" }
  }));
}

// ---------- OpenStreetMap Nominatim geocoding ----------

// Nominatim's policy allows occasional, user-triggered lookups (max 1 per second) with attribution.
let liveGeocodeLast = 0;
async function liveGeocode(query) {
  const wait = liveGeocodeLast + 1100 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  liveGeocodeLast = Date.now();
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: query, format: "jsonv2", limit: "5", addressdetails: "1" })}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`The OpenStreetMap lookup failed (${response.status}).`);
  const rows = await response.json();
  return rows.map((row) => ({ lat: Number(row.lat), lon: Number(row.lon), label: row.display_name, country: row.address?.country || "", city: row.address?.city || row.address?.town || row.address?.village || "" }))
    .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lon));
}

// ---------- setlist.fm snapshot (built by GitHub Actions) ----------

let liveSetlists = null;
let liveSetlistsPromise = null;

function liveLoadSetlists() {
  if (!liveSetlistsPromise) {
    liveSetlistsPromise = fetch("data/setlists.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        liveSetlists = data && Array.isArray(data.artists) ? data : { artists: [], generatedAt: "", configured: false };
        return liveSetlists;
      })
      .catch(() => {
        liveSetlists = { artists: [], generatedAt: "", error: true };
        return liveSetlists;
      });
  }
  return liveSetlistsPromise;
}

function liveSetlistsFor(mbid) {
  return liveSetlists?.artists?.find((artist) => artist.mbid === mbid)?.setlists || [];
}

// The setlist.fm setlist for an artist on a given date, if the snapshot has it.
function liveFindSetlist(mbid, date) {
  return mbid ? liveSetlistsFor(mbid).find((setlist) => setlist.date === date) || null : null;
}

function liveSetlistFromSnapshot(setlist) {
  const songs = [];
  setlist.sets.forEach((set) => {
    for (const name of set.songs) songs.push({ name, encore: set.encore || 0 });
  });
  return { songs, source: "setlist.fm", url: setlist.url, tour: setlist.tour || "" };
}

// ---------- Cross-channel ----------

// For Creator Studio: upcoming concerts you plan to attend, as vlog ideas.
function liveEventsPlannedConcerts() {
  const today = liveToday();
  return liveGetState().plans.filter((plan) => ["Planning", "Ticket Purchased", "Attending"].includes(plan.status) && plan.event.date >= today)
    .sort((a, b) => a.event.date.localeCompare(b.event.date))
    .map((plan) => ({ title: `Concert vlog: ${plan.event.attractions[0]?.name || plan.event.name}`, date: plan.event.date, venue: plan.event.venue.name, href: `#live/event/${plan.event.id}` }));
}

function liveGuideCells() {
  const state = liveGetState();
  const today = liveToday();
  const next = state.plans.filter((plan) => plan.event.date >= today && ["Ticket Purchased", "Attending", "Planning"].includes(plan.status)).sort((a, b) => a.event.date.localeCompare(b.event.date))[0];
  const seen = state.journal.length;
  const last = [...state.journal].sort((a, b) => b.date.localeCompare(a.date))[0];
  return [
    next ? { title: next.event.attractions[0]?.name || next.event.name, note: `${new Date(`${next.event.date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${next.event.venue.city}` } : { title: "", note: "" },
    state.follows.filter((follow) => follow.following).length ? { title: `${state.follows.filter((follow) => follow.following).length} artist${state.follows.filter((follow) => follow.following).length === 1 ? "" : "s"} followed`, note: "" } : { title: "", note: "" },
    seen ? { title: `${seen} concert${seen === 1 ? "" : "s"} attended`, note: last ? `Last: ${last.artist.name}` : "" } : { title: "", note: "" }
  ];
}
