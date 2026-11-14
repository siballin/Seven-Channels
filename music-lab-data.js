// Music Lab data layer: credit roles, the MusicBrainz snapshot and live client, and the personal library.
// Writing credits come from MusicBrainz works (writer, lyricist, composer); production, arrangement,
// engineering and performance credits come from recordings. They are never merged into one another.

const musicLabSnapshotUrl = "data/music-lab.json";
const musicLabStorageKey = "seven-channels.music-lab.v1";
const musicLabCacheKey = "seven-channels.music-lab-cache.v1";
const musicLabMb = "https://musicbrainz.org/ws/2";
const musicLabCacheDays = 7;
const musicLabCacheLimit = 150;

const musicLabRoles = [
  ["songwriting", "Songwriting"],
  ["composition", "Composition"],
  ["production", "Production"],
  ["vocalProduction", "Vocal production"],
  ["arrangement", "Arrangement"],
  ["engineering", "Engineering"],
  ["programming", "Programming"],
  ["performance", "Performance"],
  ["remix", "Remix"],
  ["other", "Other"]
];
const musicLabRoleLabels = Object.fromEntries(musicLabRoles);

function musicLabCategory(kind, type) {
  const value = String(type || "").toLowerCase();
  if (kind === "work") {
    if (value === "writer" || value === "lyricist") return "songwriting";
    if (value === "composer") return "composition";
    if (/arranger|orchestrator/.test(value)) return "arrangement";
    return "other";
  }
  if (value === "producer" || value === "production") return "production";
  if (/arranger|orchestrator/.test(value)) return "arrangement";
  if (["engineer", "audio", "sound", "mix", "recording", "mastering", "balance", "editor", "field recordist"].includes(value)) return "engineering";
  if (value === "programming") return "programming";
  if (["vocal", "instrument", "performer", "performing orchestra", "conductor", "chorus master", "concertmaster"].includes(value)) return "performance";
  if (value === "remixer") return "remix";
  return "other";
}

function musicLabCapitalize(text) {
  const value = String(text || "");
  return value ? value[0].toUpperCase() + value.slice(1) : "";
}

// A readable label for one credit, e.g. "Co-producer", "Mix engineer (assistant)", "Background vocals".
function musicLabRoleLabel(kind, type, attributes = []) {
  const value = String(type || "").toLowerCase();
  const attrs = attributes.map((item) => String(item).toLowerCase());
  const extra = attrs.filter((item) => !["co", "executive", "additional", "assistant", "associate", "guest", "solo"].includes(item));
  const prefix = attrs.includes("executive") ? "Executive " : attrs.includes("co") ? "Co-" : attrs.includes("assistant") ? "Assistant " : attrs.includes("additional") ? "Additional " : attrs.includes("associate") ? "Associate " : "";
  const engineers = { engineer: "engineer", audio: "audio engineer", sound: "sound engineer", mix: "mix engineer", recording: "recording engineer", mastering: "mastering engineer", balance: "balance engineer", editor: "editor", "field recordist": "field recordist" };
  let label;
  if (kind === "work" && value === "writer") label = "Writer";
  else if (kind === "work" && value === "lyricist") label = "Lyricist";
  else if (kind === "work" && value === "composer") label = "Composer";
  else if (value === "producer" || value === "production") label = `${prefix}producer`;
  else if (engineers[value]) label = `${prefix}${engineers[value]}`;
  else if (value === "vocal") label = extra.length ? extra.map(musicLabCapitalize).join(", ") : "Vocals";
  else if (value === "instrument") label = extra.length ? extra.map(musicLabCapitalize).join(", ") : "Instruments";
  else if (value === "vocal arranger") label = "Vocal arranger";
  else if (value === "instrument arranger") label = extra.length ? `${extra.map(musicLabCapitalize).join(", ")} arranger` : "Instrument arranger";
  else if (value === "programming") label = extra.length ? `${extra.map(musicLabCapitalize).join(", ")} programming` : "Programming";
  else if (value === "remixer") label = "Remixer";
  else if (value === "translator") label = "Lyrics translation";
  else label = musicLabCapitalize(value);
  return musicLabCapitalize(label.trim());
}

function musicLabText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function musicLabIsMbid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function musicLabNormalizeName(text) {
  return String(text || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function musicLabYear(date) {
  return /^\d{4}/.test(date || "") ? date.slice(0, 4) : "";
}

function musicLabArtistLine(artists) {
  return (artists || []).map((artist) => `${artist.name}${artist.join || ""}`).join("").trim();
}

function musicLabCover(release) {
  if (release?.id) return `https://coverartarchive.org/release/${encodeURIComponent(release.id)}/front-250`;
  if (release?.group?.id) return `https://coverartarchive.org/release-group/${encodeURIComponent(release.group.id)}/front-250`;
  return "";
}

// ---------- Parsing MusicBrainz responses (same shapes as scripts/update_music_lab.py) ----------

function musicLabPersonRef(relation) {
  const artist = relation.artist || {};
  return { type: relation.type || "", attributes: [...(relation.attributes || [])].sort(), id: artist.id || "", name: relation["target-credit"] || artist.name || "" };
}

function musicLabPickRelease(releases) {
  if (!Array.isArray(releases) || !releases.length) return null;
  const rank = { Album: 0, EP: 1, Single: 2 };
  const key = (release) => {
    const group = release["release-group"] || {};
    const secondary = group["secondary-types"] || [];
    return [release.status === "Official" ? 0 : 1,
      secondary.some((kind) => ["Compilation", "Live", "Remix", "DJ-mix", "Soundtrack"].includes(kind)) ? 1 : 0,
      rank[group["primary-type"]] ?? 3, release.date || "9999"];
  };
  const compare = (a, b) => {
    const left = key(a);
    const right = key(b);
    for (let index = 0; index < left.length; index++) {
      if (left[index] < right[index]) return -1;
      if (left[index] > right[index]) return 1;
    }
    return 0;
  };
  const release = [...releases].sort(compare)[0];
  const group = release["release-group"] || {};
  return { id: release.id || "", title: release.title || "", date: release.date || "",
    group: { id: group.id || "", title: group.title || "", type: group["primary-type"] || "", secondary: group["secondary-types"] || [] } };
}

function musicLabStreamingLinks(relations) {
  const hosts = { "open.spotify.com": "spotify", "music.apple.com": "appleMusic", "itunes.apple.com": "appleMusic",
    "www.youtube.com": "youtube", "youtube.com": "youtube", "music.youtube.com": "youtubeMusic", "youtu.be": "youtube" };
  const links = {};
  for (const relation of relations || []) {
    const resource = relation.url?.resource || "";
    try {
      const kind = hosts[new URL(resource).hostname];
      if (kind && !links[kind]) links[kind] = resource;
    } catch {
      // Not a URL.
    }
  }
  return links;
}

function musicLabParseRecording(data) {
  const relations = data.relations || [];
  const writers = [];
  const works = [];
  for (const relation of relations) {
    if (relation["target-type"] !== "work") continue;
    const work = relation.work || {};
    if (work.id) works.push(work.id);
    for (const inner of work.relations || []) {
      if (inner["target-type"] === "artist") writers.push({ ...musicLabPersonRef(inner), work: work.id || "" });
    }
  }
  return {
    id: data.id || "", title: data.title || "", length: data.length ?? null, date: data["first-release-date"] || "",
    artists: (data["artist-credit"] || []).map((item) => ({ id: item.artist?.id || "", name: item.name || item.artist?.name || "", join: item.joinphrase || "" })),
    credits: relations.filter((relation) => relation["target-type"] === "artist").map(musicLabPersonRef),
    writers, works, release: musicLabPickRelease(data.releases), links: musicLabStreamingLinks(relations)
  };
}

// ---------- Live MusicBrainz client: one request at a time, at most one per second, cached ----------

let musicLabQueue = Promise.resolve();
let musicLabLastRequest = 0;

function musicLabReadCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(musicLabCacheKey) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function musicLabWriteCache(url, data) {
  try {
    const cache = musicLabReadCache();
    cache[url] = { t: Date.now(), data };
    const keys = Object.keys(cache).sort((a, b) => cache[a].t - cache[b].t);
    while (keys.length > musicLabCacheLimit) delete cache[keys.shift()];
    localStorage.setItem(musicLabCacheKey, JSON.stringify(cache));
  } catch {
    // Storage full or blocked: the page still works without the cache.
  }
}

function musicLabSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function musicLabFetchJson(url, { spacing = 1100, cache = true } = {}) {
  if (cache) {
    const hit = musicLabReadCache()[url];
    if (hit && Date.now() - hit.t < musicLabCacheDays * 86400000) return hit.data;
  }
  const task = musicLabQueue.then(async () => {
    let delay = 1500;
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = musicLabLastRequest + spacing - Date.now();
      if (wait > 0) await musicLabSleep(wait);
      musicLabLastRequest = Date.now();
      let response;
      try {
        response = await fetch(url, { headers: { Accept: "application/json" } });
      } catch (error) {
        if (attempt === 3) throw new Error("Couldn’t reach MusicBrainz. Check your connection and try again.");
        await musicLabSleep(delay);
        delay *= 2;
        continue;
      }
      if (response.status === 404) return null;
      if (response.status === 503 || response.status === 429) {
        if (attempt === 3) throw new Error("MusicBrainz is busy right now. Try again in a minute.");
        await musicLabSleep(delay);
        delay *= 2;
        continue;
      }
      if (!response.ok) throw new Error(`MusicBrainz request failed (${response.status}).`);
      return response.json();
    }
    return null;
  });
  musicLabQueue = task.catch(() => {});
  const data = await task;
  if (cache && data) musicLabWriteCache(url, data);
  return data;
}

function musicLabMbFetch(path) {
  return musicLabFetchJson(`${musicLabMb}/${path}${path.includes("?") ? "&" : "?"}fmt=json`);
}

// ---------- Snapshot ----------

let musicLabSnapshot = null;
let musicLabSnapshotPromise = null;
let musicLabSnapshotError = "";

function musicLabLoadSnapshot() {
  if (!musicLabSnapshotPromise) {
    musicLabSnapshotPromise = fetch(musicLabSnapshotUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`The Music Lab snapshot couldn’t be loaded (${response.status}).`);
        return response.json();
      })
      .then((data) => {
        musicLabSnapshot = musicLabIndexSnapshot(data);
        musicLabSnapshotError = "";
        return musicLabSnapshot;
      })
      .catch((error) => {
        console.error("Could not load Music Lab data.", error);
        musicLabSnapshotError = error.message || "The Music Lab snapshot couldn’t be loaded.";
        musicLabSnapshotPromise = null;
        return null;
      });
  }
  return musicLabSnapshotPromise;
}

const musicLabSourceLabels = { musicbrainz: "MusicBrainz", discogs: "Discogs", genius: "Genius" };

function musicLabPersonNames(person) {
  return new Set([person.name, person.mbName, ...(person.aliases || [])].filter(Boolean).map(musicLabNormalizeName));
}

// Every credit on a recording from every source, as { category, label, name, as, id (MusicBrainz), source }.
// Discogs and Genius names are tied to a MusicBrainz person only through that person's Discogs ID, a credit
// on the same recording, or a tracked person's name or alias, never through a global name lookup.
function musicLabRecordingEntries(recording, snapshot = musicLabSnapshot) {
  const entries = [];
  const local = new Map();
  for (const artist of recording.artists || []) if (artist.id) local.set(musicLabNormalizeName(artist.name), artist.id);
  for (const credit of recording.writers || []) {
    entries.push({ category: musicLabCategory("work", credit.type), label: musicLabRoleLabel("work", credit.type, credit.attributes), name: credit.name, id: credit.id, source: "musicbrainz" });
    if (credit.id) local.set(musicLabNormalizeName(credit.name), credit.id);
  }
  for (const credit of recording.credits || []) {
    entries.push({ category: musicLabCategory("recording", credit.type), label: musicLabRoleLabel("recording", credit.type, credit.attributes), name: credit.name, id: credit.id, source: "musicbrainz" });
    if (credit.id) local.set(musicLabNormalizeName(credit.name), credit.id);
  }
  const resolve = (name, discogsId) => (discogsId && snapshot?.discogsPeople?.get(discogsId)) || local.get(musicLabNormalizeName(name)) || snapshot?.trackedNames?.get(musicLabNormalizeName(name)) || "";
  const stored = (recording.id && snapshot?.recordings?.[recording.id]) || recording;
  const track = recording.discogsTrack || (stored.discogs && snapshot?.discogsTracks?.[stored.discogs]);
  for (const credit of track?.credits || []) {
    entries.push({ category: credit.category, label: credit.label, name: credit.name, as: credit.as || "", id: resolve(credit.name, credit.id) || resolve(credit.as || ""), source: "discogs", discogsId: credit.id || 0 });
  }
  const song = snapshot?.geniusSongs?.[recording.geniusId || stored.genius || track?.genius];
  for (const credit of song?.credits || []) {
    entries.push({ category: credit.category, label: credit.label, name: credit.name, id: resolve(credit.name), source: "genius" });
  }
  return entries;
}

function musicLabSourceLinks(recording, snapshot = musicLabSnapshot) {
  const stored = (recording.id && snapshot?.recordings?.[recording.id]) || recording;
  const track = recording.discogsTrack || (stored.discogs && snapshot?.discogsTracks?.[stored.discogs]);
  const song = snapshot?.geniusSongs?.[recording.geniusId || stored.genius || track?.genius];
  const links = [];
  if (recording.id) links.push(["musicbrainz", `https://musicbrainz.org/recording/${recording.id}`]);
  if (track?.url) links.push(["discogs", track.url]);
  if (song?.url) links.push(["genius", song.url]);
  return links;
}

function musicLabEntryIsPerson(entry, person, names = musicLabPersonNames(person)) {
  if (entry.id && entry.id === person.mbid) return true;
  if (entry.discogsId && (person.discogsIds || []).includes(entry.discogsId)) return true;
  return names.has(musicLabNormalizeName(entry.name)) || (entry.as && names.has(musicLabNormalizeName(entry.as)));
}

// Turns a person's credits into song rows: one row per recording, with every role they hold on it and its source.
function musicLabPersonSongs(person, recordings, works, context = null) {
  const rows = new Map();
  const addRole = (row, role) => {
    if (!row.roles.some((item) => item.category === role.category && item.label === role.label && item.source === role.source)) row.roles.push(role);
  };
  for (const credit of person.credits || []) {
    const recordingId = credit.kind === "recording" ? credit.id : works?.[credit.id]?.recording || null;
    const key = recordingId || `${credit.kind}:${credit.id}`;
    const recording = recordingId ? recordings[recordingId] || null : null;
    const row = rows.get(key) || { key, recordingId, recording, title: recording?.title || credit.title, roles: [], workIds: [] };
    if (credit.kind === "work") row.workIds.push(credit.id);
    addRole(row, { category: musicLabCategory(credit.kind, credit.type), label: musicLabRoleLabel(credit.kind, credit.type, credit.attributes), kind: credit.kind, source: "musicbrainz" });
    rows.set(key, row);
  }
  if (!context) return [...rows.values()];
  // Discogs-credited tracks: on a recording already in the snapshot, or a Discogs-only song.
  for (const key of person.discogsTracks || []) {
    const track = context.discogsTracks?.[key];
    if (!track) continue;
    const recording = track.recording ? recordings[track.recording] : null;
    const rowKey = recording ? recording.id : `discogs:${key}`;
    if (!rows.has(rowKey)) {
      const pseudo = recording || { id: "", title: track.title, length: null, date: track.year ? String(track.year) : "",
        artists: (track.artists || []).map((name) => ({ id: "", name, join: "" })).map((artist, index, list) => ({ ...artist, join: index < list.length - 1 ? ", " : "" })),
        release: { id: "", title: track.releaseTitle, date: track.year ? String(track.year) : "", group: { id: "", title: track.releaseTitle, type: "" } },
        discogsTrack: track, geniusId: track.genius || "", externalUrl: track.url };
      rows.set(rowKey, { key: rowKey, recordingId: recording?.id || null, recording: pseudo, title: track.title, roles: [], workIds: [], discogsOnly: !recording });
    }
  }
  const names = musicLabPersonNames(person);
  for (const row of rows.values()) {
    if (!row.recording) continue;
    for (const entry of musicLabRecordingEntries(row.recording, context)) {
      if (entry.source !== "musicbrainz" && musicLabEntryIsPerson(entry, person, names)) addRole(row, { category: entry.category, label: entry.label, source: entry.source });
    }
  }
  return [...rows.values()].filter((row) => row.roles.length);
}

function musicLabIndexSnapshot(data) {
  const recordings = data?.recordings && typeof data.recordings === "object" ? data.recordings : {};
  const works = data?.works && typeof data.works === "object" ? data.works : {};
  const people = (Array.isArray(data?.people) ? data.people : []).filter((person) => person && person.name);
  const byId = new Map();
  const trackedNames = new Map();
  const discogsPeople = new Map();
  for (const person of people) {
    if (!person.mbid) continue;
    byId.set(person.mbid, person);
    for (const name of musicLabPersonNames(person)) trackedNames.set(name, person.mbid);
    for (const id of person.discogsIds || []) discogsPeople.set(id, person.mbid);
  }
  const context = { recordings, discogsTracks: data?.discogsTracks || {}, geniusSongs: data?.geniusSongs || {}, trackedNames, discogsPeople };
  for (const person of people) person.songs = musicLabPersonSongs(person, recordings, works, context);
  // Every credited name across the snapshot, for search and related songs.
  const contributors = new Map();
  const songsByContributor = new Map();
  for (const recording of Object.values(recordings)) {
    const names = [...(recording.credits || []), ...(recording.writers || []), ...(recording.artists || []).map((artist) => ({ ...artist, type: "artist" }))];
    for (const person of names) {
      if (!person.id) continue;
      if (!contributors.has(person.id)) contributors.set(person.id, person.name);
      if (!songsByContributor.has(person.id)) songsByContributor.set(person.id, new Set());
      songsByContributor.get(person.id).add(recording.id);
    }
  }
  const generated = Date.parse(data?.generatedAt || "");
  return {
    generatedAt: data?.generatedAt || "",
    stale: !data?.complete || !Number.isFinite(generated) || Date.now() - generated > 3 * 86400000,
    sources: Array.isArray(data?.sources) ? data.sources : [],
    sourceStatus: data?.sourceStatus || {},
    people, byId, recordings, works, contributors, songsByContributor, ...context
  };
}

// ---------- Live profiles (for MusicBrainz artists outside the snapshot) ----------

const musicLabLiveProfiles = new Map();

async function musicLabFetchLivePerson(mbid) {
  if (musicLabLiveProfiles.has(mbid)) return musicLabLiveProfiles.get(mbid);
  const [artist, groups] = [await musicLabMbFetch(`artist/${mbid}?inc=aliases+url-rels+recording-rels+work-rels`),
    await musicLabMbFetch(`release-group?artist=${mbid}&limit=100`)];
  if (!artist) return null;
  const links = {};
  for (const relation of artist.relations || []) {
    if (relation["target-type"] !== "url") continue;
    const resource = relation.url?.resource || "";
    let host = "";
    try { host = new URL(resource).hostname.replace(/^www\./, ""); } catch { continue; }
    const kind = relation.type === "official homepage" ? "homepage" : relation.type === "wikidata" ? "wikidata" : relation.type === "wikipedia" ? "wikipedia"
      : { "open.spotify.com": "spotify", "music.apple.com": "appleMusic", "instagram.com": "instagram", "twitter.com": "x", "x.com": "x", "youtube.com": "youtube", "soundcloud.com": "soundcloud", "tiktok.com": "tiktok" }[host];
    if (kind && !links[kind]) links[kind] = resource;
  }
  const person = {
    key: mbid, mbid, name: artist.name || "", type: artist.type || "", disambiguation: artist.disambiguation || "",
    country: artist.country || "", area: artist.area?.name || "", beginArea: artist["begin-area"]?.name || "", begin: artist["life-span"]?.begin || "",
    aliases: [...new Set((artist.aliases || []).map((alias) => alias.name).filter((name) => name && name !== artist.name))].sort(),
    links, live: true, status: "ok",
    credits: (artist.relations || []).filter((relation) => ["recording", "work"].includes(relation["target-type"]) && relation[relation["target-type"]]?.id)
      .map((relation) => ({ kind: relation["target-type"], type: relation.type || "", attributes: [...(relation.attributes || [])].sort(),
        id: relation[relation["target-type"]].id, title: relation[relation["target-type"]].title || "" })),
    releaseGroups: (groups?.["release-groups"] || []).map((group) => ({ id: group.id, title: group.title || "", type: group["primary-type"] || "",
      secondary: group["secondary-types"] || [], date: group["first-release-date"] || "" })),
    liveRecordings: {}, liveWorks: {}
  };
  person.songs = musicLabPersonSongs(person, {}, {});
  musicLabLiveProfiles.set(mbid, person);
  return person;
}

// Fetches song details for a live profile's credits, a few at a time, so they gain artists, dates and albums.
async function musicLabEnrichLivePerson(person, limit, onProgress) {
  const todo = person.songs.filter((song) => !song.recording).slice(0, limit);
  let done = 0;
  for (const song of todo) {
    try {
      let recordingId = song.recordingId;
      if (!recordingId && song.workIds.length) {
        const listing = await musicLabMbFetch(`recording?work=${song.workIds[0]}&inc=artist-credits&limit=100`);
        const versions = /\b(remix|mix|instrumental|inst|acapella|live|edit|version|ver|sped up|slowed|demo|karaoke|acoustic)\b/i;
        const candidates = (listing?.recordings || []).filter((item) => item.id);
        candidates.sort((a, b) => {
          const plain = (item) => (!item.video && !item.disambiguation && !/[([]/.test(item.title || "") && !versions.test(item.title || "")) ? 0 : 1;
          return plain(a) - plain(b) || (a["first-release-date"] || "9999").localeCompare(b["first-release-date"] || "9999");
        });
        recordingId = candidates[0]?.id || null;
        if (recordingId) person.liveWorks[song.workIds[0]] = { id: song.workIds[0], recording: recordingId };
      }
      if (recordingId) {
        const data = await musicLabMbFetch(`recording/${recordingId}?inc=artist-credits+releases+release-groups+artist-rels+work-rels+work-level-rels+url-rels`);
        if (data) person.liveRecordings[recordingId] = musicLabParseRecording(data);
      }
    } catch (error) {
      console.error("Could not load song details.", error);
    }
    done += 1;
    onProgress?.(done, todo.length);
  }
  person.songs = musicLabPersonSongs(person, person.liveRecordings, person.liveWorks);
}

// ---------- Personal library (synced with the account) ----------

let musicLabState = null;
let musicLabOnChange = null;
const musicLabHistoryLimit = 30;

function musicLabValidDateTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
}

function musicLabValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href.slice(0, 500) : "";
  } catch {
    return "";
  }
}

function musicLabValidKey(value) {
  return typeof value === "string" && /^(song|album|person):[0-9a-f-]{36}$/.test(value) ? value : "";
}

function musicLabNormalizeRef(value) {
  const key = musicLabValidKey(value?.key);
  if (!key) return null;
  return { key, title: musicLabText(value.title, 200), subtitle: musicLabText(value.subtitle, 200), image: musicLabValidUrl(value.image || ""), release: musicLabIsMbid(value.release) ? value.release : "" };
}

function musicLabNormalizeItem(value) {
  const ref = musicLabNormalizeRef(value);
  if (!ref) return null;
  const rating = Number.isInteger(value.rating) && value.rating >= 1 && value.rating <= 10 ? value.rating : null;
  return { ...ref, rating, favorite: value.favorite === true, following: value.following === true && ref.key.startsWith("person:"),
    discoveredAt: musicLabValidDateTime(value.discoveredAt), note: musicLabText(value.note, 4000), updatedAt: musicLabValidDateTime(value.updatedAt) };
}

function musicLabNormalizeList(value) {
  if (!value || typeof value.id !== "string" || !value.id) return null;
  const name = musicLabText(value.name, 80);
  if (!name) return null;
  const seen = new Set();
  const items = (Array.isArray(value.items) ? value.items : []).map(musicLabNormalizeRef).filter((item) => item && !seen.has(item.key) && seen.add(item.key));
  return { id: value.id.slice(0, 80), name, description: musicLabText(value.description, 300), items: items.slice(0, 300),
    createdAt: musicLabValidDateTime(value.createdAt), updatedAt: musicLabValidDateTime(value.updatedAt) };
}

function musicLabNormalizeCorrection(value) {
  if (!value || typeof value.id !== "string" || !value.id) return null;
  const target = musicLabValidKey(value.target);
  const role = musicLabRoles.some(([key]) => key === value.role) ? value.role : "";
  const name = musicLabText(value.name, 120);
  const source = musicLabValidUrl(value.source || "");
  if (!target || !role || !name || !source) return null;
  return { id: value.id.slice(0, 80), target, targetTitle: musicLabText(value.targetTitle, 200), role, name,
    person: musicLabIsMbid(value.person) ? value.person : "", source, note: musicLabText(value.note, 500),
    createdAt: musicLabValidDateTime(value.createdAt), updatedAt: musicLabValidDateTime(value.updatedAt) };
}

function musicLabNormalizeState(value) {
  const source = value && typeof value === "object" ? value : {};
  const ids = (list) => [...new Set((Array.isArray(list) ? list : []).filter((id) => typeof id === "string" && id))].sort();
  const deletedListIds = ids(source.deletedListIds);
  const deletedCorrectionIds = ids(source.deletedCorrectionIds);
  const unique = (records, normalize, key, deleted = new Set()) => {
    const map = new Map();
    for (const record of (Array.isArray(records) ? records : []).map(normalize)) {
      if (record && !deleted.has(record[key]) && !map.has(record[key])) map.set(record[key], record);
    }
    return [...map.values()].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
  };
  const history = unique(source.history, (item) => {
    const ref = musicLabNormalizeRef(item);
    const viewedAt = musicLabValidDateTime(item?.viewedAt);
    return ref && viewedAt ? { ...ref, viewedAt } : null;
  }, "key").sort((a, b) => b.viewedAt.localeCompare(a.viewedAt) || a.key.localeCompare(b.key)).slice(0, musicLabHistoryLimit);
  return {
    items: unique(source.items, musicLabNormalizeItem, "key"),
    lists: unique(source.lists, musicLabNormalizeList, "id", new Set(deletedListIds)),
    corrections: unique(source.corrections, musicLabNormalizeCorrection, "id", new Set(deletedCorrectionIds)),
    history,
    deletedListIds,
    deletedCorrectionIds
  };
}

function musicLabValidState(value) {
  return Boolean(value && typeof value === "object" && Array.isArray(value.items) && Array.isArray(value.lists));
}

function musicLabNewer(candidate, current) {
  const a = Date.parse(candidate.updatedAt || "") || 0;
  const b = Date.parse(current.updatedAt || "") || 0;
  return a !== b ? a > b : JSON.stringify(candidate) > JSON.stringify(current);
}

// Per-record merge: newest edit wins, deleted lists and corrections stay deleted, history keeps the latest views.
function musicLabMergeState(local, remote) {
  const a = musicLabNormalizeState(local);
  const b = musicLabNormalizeState(remote);
  const pick = (records, key) => {
    const map = new Map();
    for (const record of records) {
      const previous = map.get(record[key]);
      if (!previous || musicLabNewer(record, previous)) map.set(record[key], record);
    }
    return [...map.values()];
  };
  const history = new Map();
  for (const item of [...b.history, ...a.history]) {
    const previous = history.get(item.key);
    if (!previous || item.viewedAt > previous.viewedAt) history.set(item.key, item);
  }
  return musicLabNormalizeState({
    items: pick([...b.items, ...a.items], "key"),
    lists: pick([...b.lists, ...a.lists], "id"),
    corrections: pick([...b.corrections, ...a.corrections], "id"),
    history: [...history.values()],
    deletedListIds: [...a.deletedListIds, ...b.deletedListIds],
    deletedCorrectionIds: [...a.deletedCorrectionIds, ...b.deletedCorrectionIds]
  });
}

function musicLabGetState() {
  if (!musicLabState) {
    try {
      const saved = localStorage.getItem(musicLabStorageKey);
      const parsed = saved ? JSON.parse(saved) : {};
      musicLabState = musicLabNormalizeState(parsed);
    } catch (error) {
      console.error("Could not load Music Lab library.", error);
      if (typeof showNotice === "function") showNotice("Your saved Music Lab library couldn’t be read. New ratings and notes can still be saved.");
      musicLabState = musicLabNormalizeState({});
    }
  }
  return musicLabState;
}

function musicLabPersist() {
  try {
    localStorage.setItem(musicLabStorageKey, JSON.stringify(musicLabState));
    return true;
  } catch (error) {
    console.error("Could not save Music Lab library.", error);
    if (typeof showNotice === "function") showNotice("Your browser couldn’t save this Music Lab change. Check your storage settings and try again.");
    return false;
  }
}

function musicLabReplaceState(value) {
  musicLabState = musicLabNormalizeState(value);
  musicLabPersist();
}

function musicLabCommit(mutate, { sync = true } = {}) {
  const next = structuredClone(musicLabGetState());
  mutate(next, new Date().toISOString());
  musicLabState = musicLabNormalizeState(next);
  const saved = musicLabPersist();
  if (sync) musicLabOnChange?.();
  return saved;
}

function musicLabItem(key) {
  return musicLabGetState().items.find((item) => item.key === key) || null;
}

// Updates one library record, creating it from the page's reference (title, artwork) if needed.
function musicLabUpdateItem(ref, changes) {
  return musicLabCommit((next, now) => {
    const index = next.items.findIndex((item) => item.key === ref.key);
    const current = index >= 0 ? next.items[index] : { key: ref.key, rating: null, favorite: false, following: false, discoveredAt: "", note: "" };
    const updated = { ...current, title: ref.title || current.title, subtitle: ref.subtitle ?? current.subtitle, image: ref.image ?? current.image,
      release: ref.release || current.release || "", ...changes, updatedAt: now };
    if (index >= 0) next.items[index] = updated;
    else next.items.push(updated);
  });
}

// Recently explored pages stay on this device until the next synced change carries them along.
function musicLabRecordVisit(ref) {
  if (!musicLabValidKey(ref?.key)) return;
  const latest = musicLabGetState().history[0];
  if (latest?.key === ref.key && Date.now() - Date.parse(latest.viewedAt) < 60000) return;
  musicLabCommit((next, now) => {
    next.history = [{ ...ref, viewedAt: now }, ...next.history.filter((item) => item.key !== ref.key)];
  }, { sync: false });
}

function musicLabId(prefix) {
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function musicLabGuideCells() {
  const state = musicLabGetState();
  const following = state.items.filter((item) => item.following);
  const rated = state.items.filter((item) => item.rating !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const saved = state.items.filter((item) => item.favorite);
  return [
    following.length ? { title: `${following.length} ${following.length === 1 ? "person" : "people"}`, note: following.slice(0, 2).map((item) => item.title).join(", ") } : { title: "", note: "" },
    rated.length ? { title: `${rated[0].title} · ${rated[0].rating}/10`, note: rated[0].subtitle } : { title: "", note: "" },
    saved.length ? { title: `${saved.length} saved`, note: saved.slice(0, 2).map((item) => item.title).join(", ") } : { title: "", note: "" }
  ];
}

// Link from a K-Pop release to Music Lab: the album page when the snapshot has a matching album by that artist,
// otherwise a Music Lab search, which also searches MusicBrainz.
function musicLabKpopHref(artist, title, fallbackQuery) {
  const wantedTitle = musicLabNormalizeName(title);
  const wantedArtist = musicLabNormalizeName(String(artist || "").replace(/\s*\([^)]*\)\s*/g, " "));
  if (musicLabSnapshot && wantedTitle && wantedArtist) {
    for (const recording of Object.values(musicLabSnapshot.recordings)) {
      const group = recording.release?.group;
      if (group?.title && musicLabNormalizeName(group.title) === wantedTitle && musicLabNormalizeName(musicLabArtistLine(recording.artists)).includes(wantedArtist)) {
        return `#music/album/${recording.release.id}`;
      }
    }
  } else if (!musicLabSnapshot) {
    musicLabLoadSnapshot();
  }
  return `#music/search/${encodeURIComponent(fallbackQuery || `${artist} ${title}`.trim())}`;
}
