// Music Lab channel (#music): producers, songwriters, credits, collaborations and a personal listening library.
// Depends on music-lab-data.js and the app's element()/showNotice() helpers.

let musicLabRoot = null;
const musicLabUi = {
  profile: { id: "", role: "all", source: "all", artist: "all", year: "all", query: "", sort: "newest" },
  people: "",
  network: { id: "", role: "all", source: "all", year: "all", scale: 1, x: 0, y: 0, selected: "" },
  status: {},
  enriching: new Set()
};
const musicLabLiveSongs = new Map();
const musicLabLiveAlbums = new Map();
const musicLabSearches = new Map();
const musicLabAppleLinks = new Map();
const musicLabPending = new Map();

// ---------- Routing ----------

function musicLabRoute() {
  const path = location.hash.replace(/^#music\/?/, "");
  const [view = "", a = "", b = ""] = path.split("/");
  if (view === "people") return { view: "people" };
  if (view === "person" && a) return { view: "person", id: a };
  if (view === "song" && a) return { view: "song", id: a };
  if (view === "album" && a) return { view: "album", id: a };
  if (view === "group" && a) return { view: "group", id: a };
  if (view === "network") {
    let focus = b;
    try { focus = decodeURIComponent(b); } catch { focus = b; }
    return { view: "network", id: a, focus };
  }
  if (view === "library") return { view: "library" };
  if (view === "search") {
    let query = "";
    try { query = decodeURIComponent(a); } catch { query = a; }
    return { view: "search", query };
  }
  return { view: "home" };
}

function musicLabRefresh(focusId) {
  if (!musicLabRoot?.isConnected) return;
  const activeId = focusId || document.activeElement?.id;
  const scroll = window.scrollY;
  // createMusicLab() reassigns musicLabRoot, so keep the node that is on the page.
  const previous = musicLabRoot;
  const next = createMusicLab();
  previous.replaceWith(next);
  musicLabRoot = next;
  if (!focusId) window.scrollTo(0, scroll);
  if (activeId) document.getElementById(activeId)?.focus({ preventScroll: !focusId });
}

// Runs an async load once per key and re-renders when it settles, if Music Lab is still showing.
function musicLabLoad(key, loader) {
  if (musicLabPending.has(key)) return musicLabPending.get(key);
  const hash = location.hash;
  const promise = Promise.resolve().then(loader).catch((error) => {
    console.error(error);
    musicLabUi.status[key] = error.message || "Something went wrong loading this page.";
  }).finally(() => {
    musicLabPending.delete(key);
    if (location.hash === hash) musicLabRefresh();
  });
  musicLabPending.set(key, promise);
  return promise;
}

// ---------- Small building blocks ----------

function musicLabLink(text, href, className = "") {
  const link = element("a", className, text);
  link.href = href;
  return link;
}

function musicLabExternal(text, href, className = "") {
  const link = musicLabLink(text, href, className);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function musicLabInitials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => [...part][0]).join("").toUpperCase() || "♪";
}

function musicLabImage(src, alt, className, fallbackText) {
  const frame = element("span", `${className} music-media`);
  frame.dataset.fallback = fallbackText || "♪";
  if (src) {
    const image = document.createElement("img");
    image.src = src;
    image.alt = alt || "";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => image.remove(), { once: true });
    frame.append(image);
  }
  return frame;
}

function musicLabCard({ href, image, title, subtitle, meta, round = false, fallback }) {
  const card = musicLabLink("", href, `music-card${round ? " is-person" : ""}`);
  card.append(musicLabImage(image, "", "music-card-media", fallback || (round ? musicLabInitials(title) : "♪")));
  const body = element("span", "music-card-body");
  body.append(element("strong", "", title || "Untitled"));
  if (subtitle) body.append(element("span", "music-card-sub", subtitle));
  if (meta) body.append(element("small", "", meta));
  card.append(body);
  return card;
}

function musicLabPanel(title, id, className = "") {
  const panel = element("section", `music-panel ${className}`.trim());
  const heading = element("h3", "", title);
  heading.id = id;
  heading.tabIndex = -1;
  panel.setAttribute("aria-labelledby", id);
  panel.append(heading);
  return panel;
}

function musicLabEmpty(text) {
  return element("p", "music-empty", text);
}

function musicLabLoading(text) {
  const box = element("div", "music-loading");
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");
  box.append(element("span", "music-spinner"), element("span", "", text));
  return box;
}

function musicLabError(text, retry) {
  const box = element("div", "music-error");
  box.setAttribute("role", "alert");
  box.append(element("p", "", text));
  if (retry) {
    const button = element("button", "secondary", "Try again");
    button.type = "button";
    button.addEventListener("click", retry);
    box.append(button);
  }
  return box;
}

function musicLabFormatDate(date) {
  if (!date) return "Date unknown";
  const [year, month, day] = date.split("-").map(Number);
  if (!month) return String(year);
  const options = day ? { year: "numeric", month: "short", day: "numeric" } : { year: "numeric", month: "short" };
  return new Intl.DateTimeFormat(undefined, options).format(new Date(year, month - 1, day || 1));
}

function musicLabLength(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function musicLabRoleBadge(role) {
  const badge = element("span", `music-role music-role-${role.category}${role.source && role.source !== "musicbrainz" ? " is-external" : ""}`, role.label);
  if (role.source && role.source !== "musicbrainz") badge.append(element("span", `music-src music-src-${role.source}`, musicLabSourceLabels[role.source]));
  badge.title = `${musicLabRoleLabels[role.category]} · from ${musicLabSourceLabels[role.source || "musicbrainz"]}${role.source === "genius" ? " (community-edited)" : ""}`;
  return badge;
}

function musicLabSourceNote(snapshot) {
  const note = element("p", "music-source");
  note.append("Credits from ", musicLabExternal("MusicBrainz", "https://musicbrainz.org/"), " (CC0), ", musicLabExternal("Discogs", "https://www.discogs.com/"),
    " (booklet and liner-note credits) and ", musicLabExternal("Genius", "https://genius.com/"), " (community-edited); artwork from ",
    musicLabExternal("Cover Art Archive", "https://coverartarchive.org/"), ". Every credit is labeled with its source. Credit databases are incomplete: a missing role means it isn’t documented, not that nobody did it.");
  const status = snapshot?.sourceStatus || {};
  if (status.genius?.status === "off") note.append(" Genius credits aren’t being refreshed yet because no Genius token is configured.");
  if (status.discogs && !status.discogs.authenticated) note.append(" Discogs is read without a token, so it refreshes more slowly.");
  if (snapshot?.generatedAt) note.append(` Snapshot updated ${new Date(snapshot.generatedAt).toLocaleDateString()}.`);
  return note;
}

function musicLabStaleBanner(snapshot) {
  if (!snapshot?.stale) return null;
  const banner = element("p", "music-banner", "Some credit details are still being collected or haven’t refreshed in a few days, so recent changes on MusicBrainz may be missing.");
  banner.setAttribute("role", "status");
  return banner;
}

// ---------- Personal controls ----------

function musicLabRef(kind, id, title, subtitle, image, release = "") {
  return { key: `${kind}:${id}`, title, subtitle, image, release };
}

function musicLabControls(ref, { rate = false, favorite = false, follow = false, discover = false, note = "", list = false } = {}) {
  const item = musicLabItem(ref.key);
  const wrap = element("div", "music-controls");
  const slug = ref.key.replace(/[^a-z0-9]/gi, "-");
  if (rate) {
    const select = document.createElement("select");
    select.id = `music-rate-${slug}`;
    select.setAttribute("aria-label", `Your rating for ${ref.title}`);
    for (const value of ["", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]) {
      const option = element("option", "", value ? `${value} / 10` : "Rate it");
      option.value = value;
      option.selected = String(item?.rating ?? "") === value;
      select.append(option);
    }
    select.addEventListener("change", () => {
      musicLabUpdateItem(ref, { rating: select.value ? Number(select.value) : null, discoveredAt: item?.discoveredAt || new Date().toISOString() });
      musicLabRefresh(select.id);
    });
    wrap.append(select);
  }
  const toggle = (on, onLabel, offLabel, field, idPart) => {
    const button = element("button", on ? "music-toggle is-on" : "secondary music-toggle", on ? onLabel : offLabel);
    button.type = "button";
    button.id = `music-${idPart}-${slug}`;
    button.setAttribute("aria-pressed", String(on));
    button.addEventListener("click", () => {
      const changes = { [field]: !on };
      if (!on && !item?.discoveredAt) changes.discoveredAt = new Date().toISOString();
      musicLabUpdateItem(ref, changes);
      musicLabRefresh(button.id);
    });
    wrap.append(button);
  };
  if (favorite) toggle(Boolean(item?.favorite), "★ Saved", "☆ Save", "favorite", "fav");
  if (follow) toggle(Boolean(item?.following), "Following", "Follow", "following", "follow");
  if (discover) {
    const found = Boolean(item?.discoveredAt);
    const button = element("button", found ? "music-toggle is-on" : "secondary music-toggle", found ? `Discovered ${new Date(item.discoveredAt).toLocaleDateString()}` : "Mark as discovered");
    button.type = "button";
    button.id = `music-disc-${slug}`;
    button.setAttribute("aria-pressed", String(found));
    button.addEventListener("click", () => {
      musicLabUpdateItem(ref, { discoveredAt: found ? "" : new Date().toISOString() });
      musicLabRefresh(button.id);
    });
    wrap.append(button);
  }
  if (list) wrap.append(musicLabAddToList(ref, slug));
  const block = element("div", "music-personal");
  block.append(wrap);
  if (note) block.append(musicLabNoteEditor(ref, item, note, slug));
  return block;
}

function musicLabAddToList(ref, slug) {
  const { lists } = musicLabGetState();
  const box = element("div", "music-add-list");
  if (!lists.length) {
    box.append(musicLabLink("Create a listening list", "#music/library", "music-text-link"));
    return box;
  }
  const select = document.createElement("select");
  select.id = `music-list-${slug}`;
  select.setAttribute("aria-label", `Add ${ref.title} to a listening list`);
  const placeholder = element("option", "", "Add to list…");
  placeholder.value = "";
  select.append(placeholder);
  for (const list of lists) {
    const has = list.items.some((entry) => entry.key === ref.key);
    const option = element("option", "", has ? `${list.name} ✓` : list.name);
    option.value = list.id;
    option.disabled = has;
    select.append(option);
  }
  select.addEventListener("change", () => {
    const listId = select.value;
    if (!listId) return;
    musicLabCommit((next, now) => {
      const list = next.lists.find((entry) => entry.id === listId);
      if (list && !list.items.some((entry) => entry.key === ref.key)) {
        list.items.push({ key: ref.key, title: ref.title, subtitle: ref.subtitle, image: ref.image, release: ref.release || "" });
        list.updatedAt = now;
      }
    });
    musicLabUi.status.list = `Added to ${lists.find((entry) => entry.id === listId)?.name}.`;
    musicLabRefresh(select.id);
  });
  box.append(select);
  if (musicLabUi.status.list) {
    const status = element("span", "music-status", musicLabUi.status.list);
    status.setAttribute("role", "status");
    box.append(status);
    musicLabUi.status.list = "";
  }
  return box;
}

function musicLabNoteEditor(ref, item, label, slug) {
  const form = element("form", "music-note");
  const id = `music-note-${slug}`;
  const field = element("label", "", label);
  field.htmlFor = id;
  const text = document.createElement("textarea");
  text.id = id;
  text.maxLength = 4000;
  text.value = item?.note || "";
  text.placeholder = "What stood out: production details, favorite moments, what to listen for";
  const save = element("button", "secondary", "Save note");
  save.type = "submit";
  const status = element("span", "music-status");
  status.setAttribute("role", "status");
  form.append(field, text, save, status);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    musicLabUpdateItem(ref, { note: text.value.trim() });
    status.textContent = text.value.trim() ? "Note saved." : "Note cleared.";
  });
  return form;
}

// ---------- Shell ----------

function createMusicLabTabs(active) {
  const nav = element("nav", "music-tabs");
  nav.setAttribute("aria-label", "Music Lab sections");
  for (const [view, label, href] of [["home", "Dashboard", "#music"], ["people", "Producers & songwriters", "#music/people"], ["network", "Collaboration network", "#music/network"], ["library", "My library", "#music/library"]]) {
    const link = musicLabLink(label, href);
    if (view === active || (view === "people" && active === "person")) link.setAttribute("aria-current", "page");
    nav.append(link);
  }
  return nav;
}

function createMusicLabSearch(query = "") {
  const form = element("form", "music-search");
  form.setAttribute("role", "search");
  const label = element("label", "music-sr", "Search songs, albums, artists and credits");
  label.htmlFor = "music-search-input";
  const input = document.createElement("input");
  input.id = "music-search-input";
  input.type = "search";
  input.placeholder = "Search songs, albums, artists, credits";
  input.value = query;
  input.autocomplete = "off";
  const button = element("button", "", "Search");
  button.type = "submit";
  form.append(label, input, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (value) location.hash = `#music/search/${encodeURIComponent(value)}`;
  });
  return form;
}

function createMusicLab() {
  const route = musicLabRoute();
  const root = element("div", "music-lab");
  const top = element("div", "music-top");
  top.append(createMusicLabTabs(route.view), createMusicLabSearch(route.view === "search" ? route.query : ""));
  root.append(top);
  const snapshot = musicLabSnapshot;
  if (!snapshot && route.view !== "library") {
    if (musicLabSnapshotError) {
      root.append(musicLabError(`${musicLabSnapshotError} Live MusicBrainz search still works from the search box.`, () => {
        musicLabSnapshotError = "";
        musicLabLoad("snapshot", musicLabLoadSnapshot);
        musicLabRefresh();
      }));
      if (route.view === "search") root.append(createMusicLabSearchView(route.query, null));
    } else {
      root.append(musicLabLoading("Loading Music Lab credits…"));
      musicLabLoad("snapshot", musicLabLoadSnapshot);
    }
    musicLabRoot = root;
    return root;
  }
  const views = {
    home: () => createMusicLabHome(snapshot),
    people: () => createMusicLabPeople(snapshot),
    person: () => createMusicLabProfile(route.id, snapshot),
    song: () => createMusicLabSong(route.id, snapshot),
    album: () => createMusicLabAlbum(route.id, snapshot),
    group: () => createMusicLabGroup(route.id),
    network: () => createMusicLabNetwork(route, snapshot),
    library: () => createMusicLabLibrary(),
    search: () => createMusicLabSearchView(route.query, snapshot)
  };
  root.append(views[route.view]());
  musicLabRoot = root;
  return root;
}

// ---------- Dashboard ----------

function musicLabRecentAlbums(snapshot, limit = 8) {
  const albums = new Map();
  for (const person of snapshot.people) {
    for (const song of person.songs) {
      const release = song.recording?.release;
      const groupId = release?.group?.id;
      if (!groupId) continue;
      const album = albums.get(groupId) || { release, date: release.date || song.recording.date, artists: song.recording.artists, people: new Map() };
      const roles = album.people.get(person.name) || new Set();
      song.roles.forEach((role) => roles.add(role.label));
      album.people.set(person.name, roles);
      albums.set(groupId, album);
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  return [...albums.values()].filter((album) => album.date && album.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

function musicLabCollaborations(snapshot, limit = 6) {
  const pairs = [];
  for (const person of snapshot.people) {
    if (!person.mbid) continue;
    for (const node of musicLabConnections(person)) {
      if (node.kinds.has("creative")) pairs.push({ person, id: node.id, name: node.name, songs: [...node.songs.values()] });
    }
  }
  return pairs.sort((a, b) => b.songs.length - a.songs.length || a.name.localeCompare(b.name)).slice(0, limit);
}

function musicLabFeatured(snapshot) {
  const ready = snapshot.people.filter((person) => person.status !== "missing" && person.songs.length);
  if (!ready.length) return null;
  const day = Math.floor(Date.now() / 86400000);
  return ready[day % ready.length];
}

function musicLabRoleCounts(songs) {
  const counts = new Map();
  for (const song of songs) {
    for (const category of new Set(song.roles.map((role) => role.category))) counts.set(category, (counts.get(category) || 0) + 1);
  }
  return counts;
}

function createMusicLabHome(snapshot) {
  const wrap = element("div", "music-home");
  const banner = musicLabStaleBanner(snapshot);
  if (banner) wrap.append(banner);
  const featured = musicLabFeatured(snapshot);
  if (featured) {
    const hero = element("section", "music-hero");
    hero.setAttribute("aria-labelledby", "music-featured-name");
    hero.append(musicLabImage(featured.photo?.url, featured.photo ? `Photo of ${featured.name}` : "", "music-hero-photo", musicLabInitials(featured.name)));
    const copy = element("div", "music-hero-copy");
    copy.append(element("span", "music-kicker", "Featured producer & songwriter"));
    const name = element("h3", "", featured.name);
    name.id = "music-featured-name";
    copy.append(name);
    const chips = element("div", "music-chips");
    for (const [category, count] of musicLabRoleCounts(featured.songs)) {
      chips.append(element("span", `music-role music-role-${category}`, `${musicLabRoleLabels[category]} · ${count}`));
    }
    copy.append(chips);
    if (featured.bio?.text) copy.append(element("p", "music-hero-bio", featured.bio.text.length > 260 ? `${featured.bio.text.slice(0, 257)}…` : featured.bio.text));
    const actions = element("div", "music-actions");
    actions.append(musicLabLink("View profile", `#music/person/${featured.mbid}`, "music-button"),
      musicLabLink("Explore collaborations", `#music/network/${featured.mbid}`, "music-button secondary-link"));
    copy.append(actions);
    hero.append(copy);
    wrap.append(hero);
  }

  const grid = element("div", "music-home-grid");
  const recent = musicLabPanel("Recently released", "music-recent-title", "music-span-2");
  const albums = musicLabRecentAlbums(snapshot);
  if (albums.length) {
    const row = element("div", "music-card-row");
    for (const album of albums) {
      const credited = [...album.people].map(([name, roles]) => `${name}: ${[...roles].slice(0, 2).join(", ")}`).join(" · ");
      row.append(musicLabCard({ href: `#music/album/${album.release.id}`, image: musicLabCover(album.release), title: album.release.group.title || album.release.title,
        subtitle: musicLabArtistLine(album.artists), meta: `${musicLabFormatDate(album.date)} · ${credited}` }));
    }
    recent.append(row);
  } else {
    recent.append(musicLabEmpty("No releases with documented credits yet. They appear as the daily MusicBrainz refresh collects song details."));
  }
  grid.append(recent);

  const collaborations = musicLabPanel("Featured collaborations", "music-collab-title");
  collaborations.append(element("p", "music-hint", "Pairs who share the most documented credits on the same recordings."));
  const pairs = musicLabCollaborations(snapshot);
  if (pairs.length) {
    const list = element("ul", "music-collab-list");
    for (const pair of pairs) {
      const item = element("li");
      const link = musicLabLink("", `#music/network/${pair.person.mbid}/${encodeURIComponent(pair.id)}`, "music-collab");
      link.append(element("strong", "", `${pair.person.name} × ${pair.name}`),
        element("small", "", `${pair.songs.length} shared song${pair.songs.length === 1 ? "" : "s"} · ${pair.songs.slice(0, 2).map((song) => song.title).join(", ")}`));
      item.append(link);
      list.append(item);
    }
    collaborations.append(list);
  } else {
    collaborations.append(musicLabEmpty("Collaborations appear once song credits have been collected."));
  }
  grid.append(collaborations);

  const state = musicLabGetState();
  const explored = musicLabPanel("Recently explored", "music-explored-title");
  if (state.history.length) {
    const row = element("div", "music-card-row is-compact");
    for (const item of state.history.slice(0, 8)) row.append(musicLabCard({ href: musicLabHref(item), image: item.image, title: item.title, subtitle: item.subtitle, round: item.key.startsWith("person:") }));
    explored.append(row);
  } else {
    explored.append(musicLabEmpty("Artists, songs and albums you open show up here."));
  }
  grid.append(explored);

  const following = musicLabPanel("Following", "music-following-title");
  const followed = state.items.filter((item) => item.following);
  if (followed.length) {
    const row = element("div", "music-card-row is-compact");
    for (const item of followed) row.append(musicLabCard({ href: musicLabHref(item), image: item.image, title: item.title, subtitle: item.subtitle, round: true }));
    following.append(row);
  } else {
    following.append(musicLabEmpty("Follow producers and songwriters from their profiles to keep them here."));
  }
  grid.append(following);

  const saved = musicLabPanel("Saved albums & discoveries", "music-saved-title", "music-span-2");
  const savedItems = state.items.filter((item) => item.favorite || item.discoveredAt)
    .sort((a, b) => (b.discoveredAt || b.updatedAt).localeCompare(a.discoveredAt || a.updatedAt)).slice(0, 12);
  if (savedItems.length) {
    const row = element("div", "music-card-row");
    for (const item of savedItems) {
      const meta = [item.favorite ? "★ Saved" : "", item.rating ? `${item.rating}/10` : "", item.discoveredAt ? `Discovered ${new Date(item.discoveredAt).toLocaleDateString()}` : ""].filter(Boolean).join(" · ");
      row.append(musicLabCard({ href: musicLabHref(item), image: item.image, title: item.title, subtitle: item.subtitle, meta, round: item.key.startsWith("person:") }));
    }
    saved.append(row);
  } else {
    saved.append(musicLabEmpty("Save albums and songs or mark them as discovered, and they’ll collect here."));
  }
  grid.append(saved);
  wrap.append(grid, musicLabSourceNote(snapshot));
  return wrap;
}

function musicLabHref(item) {
  const [kind, id] = item.key.split(":");
  if (kind === "album") return item.release ? `#music/album/${item.release}` : `#music/group/${id}`;
  return `#music/${kind}/${id}`;
}

// ---------- People ----------

function createMusicLabPeople(snapshot) {
  const panel = musicLabPanel("Producers & songwriters", "music-people-title");
  const filter = document.createElement("input");
  filter.type = "search";
  filter.id = "music-people-filter";
  filter.placeholder = "Filter by name or alias";
  filter.value = musicLabUi.people;
  filter.setAttribute("aria-label", "Filter producers and songwriters");
  const grid = element("div", "music-people-grid");
  const followedLive = musicLabGetState().items.filter((item) => item.following && !snapshot.byId.has(item.key.slice(7)));
  const render = () => {
    const query = musicLabNormalizeName(filter.value);
    grid.replaceChildren();
    const matches = (person) => !query || [person.name, ...(person.aliases || [])].some((name) => musicLabNormalizeName(name).includes(query));
    for (const person of snapshot.people.filter(matches)) {
      if (person.status === "missing") {
        const card = element("article", "music-person-card is-missing");
        card.append(musicLabImage("", "", "music-card-media", musicLabInitials(person.name)));
        const body = element("div", "music-card-body");
        body.append(element("strong", "", person.name), element("span", "music-card-sub", "No MusicBrainz record yet"), element("small", "", person.note || ""));
        const actions = element("div", "music-actions");
        actions.append(musicLabLink("Search MusicBrainz", `#music/search/${encodeURIComponent(person.name)}`, "music-text-link"));
        body.append(actions);
        card.append(body);
        grid.append(card);
        continue;
      }
      const counts = musicLabRoleCounts(person.songs);
      const summary = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([category, count]) => `${musicLabRoleLabels[category]} ${count}`).join(" · ");
      grid.append(musicLabCard({ href: `#music/person/${person.mbid}`, image: person.photo?.url, title: person.name, round: true,
        subtitle: [person.disambiguation, person.area || person.country].filter(Boolean).join(" · ") || (person.aliases || []).slice(0, 2).join(", "),
        meta: summary || "No credits documented yet" }));
    }
    for (const item of followedLive.filter((entry) => !query || musicLabNormalizeName(entry.title).includes(query))) {
      grid.append(musicLabCard({ href: musicLabHref(item), image: item.image, title: item.title, subtitle: item.subtitle || "Followed · loaded live from MusicBrainz", round: true }));
    }
    if (!grid.children.length) grid.append(musicLabEmpty("No one matches that filter. Search MusicBrainz from the box above to find anyone else."));
  };
  filter.addEventListener("input", () => {
    musicLabUi.people = filter.value;
    render();
  });
  render();
  panel.append(element("p", "music-hint", "The tracked people below are refreshed daily from MusicBrainz. Find anyone else with search and follow them to keep them here."), filter, grid, musicLabSourceNote(snapshot));
  return panel;
}

// ---------- Profile ----------

function musicLabPersonFromSnapshotOrLive(id, snapshot) {
  return snapshot?.byId.get(id) || musicLabLiveProfiles.get(id) || null;
}

function musicLabCorrectionsFor(person) {
  const name = musicLabNormalizeName(person.name);
  const aliases = new Set([name, ...(person.aliases || []).map(musicLabNormalizeName)]);
  return musicLabGetState().corrections.filter((correction) => correction.person === person.mbid || (!correction.person && aliases.has(musicLabNormalizeName(correction.name))));
}

function musicLabBio(person) {
  const box = element("div", "music-bio");
  if (person.bio?.text) {
    box.append(element("p", "", person.bio.text));
    const source = element("p", "music-source");
    source.append("Biography from ", musicLabExternal("Wikipedia", person.bio.url || "https://en.wikipedia.org/"), ` (${person.bio.license || "CC BY-SA 4.0"}).`);
    box.append(source);
    return box;
  }
  const counts = musicLabRoleCounts(person.songs);
  const kind = person.type ? person.type.toLowerCase() : "artist";
  const place = person.area || person.beginArea || "";
  const parts = [`${person.name} is listed in MusicBrainz as ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind}${place ? ` from ${place}` : ""}${person.disambiguation ? ` (${person.disambiguation})` : ""}.`];
  if (person.begin) parts.push(`${person.type === "Group" ? "Formed" : "Born"} ${musicLabFormatDate(person.begin)}.`);
  if (counts.size) parts.push(`Documented credits: ${[...counts].map(([category, count]) => `${count} ${musicLabRoleLabels[category].toLowerCase()}`).join(", ")}.`);
  box.append(element("p", "", parts.join(" ")), element("p", "music-source", "No biography is linked for this person, so this summary is built from their MusicBrainz record."));
  return box;
}

function musicLabProfileLinks(person) {
  const labels = { homepage: "Website", spotify: "Spotify", appleMusic: "Apple Music", youtube: "YouTube", instagram: "Instagram", x: "X", soundcloud: "SoundCloud", tiktok: "TikTok", wikipedia: "Wikipedia", discogs: "Discogs" };
  const row = element("div", "music-links");
  for (const [key, label] of Object.entries(labels)) if (person.links?.[key]) row.append(musicLabExternal(label, person.links[key]));
  row.append(musicLabExternal("MusicBrainz", `https://musicbrainz.org/artist/${person.mbid}`));
  return row;
}

function createMusicLabProfile(id, snapshot) {
  if (!musicLabIsMbid(id)) return musicLabError("That isn’t a valid MusicBrainz artist ID.");
  const person = musicLabPersonFromSnapshotOrLive(id, snapshot);
  const key = `person:${id}`;
  if (!person) {
    if (musicLabUi.status[key]) {
      return musicLabError(musicLabUi.status[key], () => {
        delete musicLabUi.status[key];
        musicLabRefresh();
      });
    }
    musicLabLoad(key, async () => {
      const live = await musicLabFetchLivePerson(id);
      if (!live) throw new Error("MusicBrainz has no artist with that ID.");
    });
    return musicLabLoading("Loading this profile from MusicBrainz…");
  }
  const subtitle = [person.disambiguation, person.area || person.country].filter(Boolean).join(" · ");
  const ref = musicLabRef("person", id, person.name, subtitle, person.photo?.url || "");
  musicLabRecordVisit(ref);
  const wrap = element("div", "music-profile");
  const head = element("section", "music-panel music-profile-head");
  head.setAttribute("aria-labelledby", "music-profile-name");
  const photo = musicLabImage(person.photo?.url, person.photo ? `Photo of ${person.name}` : "", "music-profile-photo", musicLabInitials(person.name));
  const figure = element("figure", "music-profile-figure");
  figure.append(photo);
  if (person.photo?.page) {
    const caption = element("figcaption", "");
    caption.append(musicLabExternal(`Photo: ${person.photo.credit || "Wikimedia Commons"}${person.photo.license ? `, ${person.photo.license}` : ""}`, person.photo.page));
    figure.append(caption);
  }
  const copy = element("div", "music-profile-copy");
  const name = element("h3", "", person.name);
  name.id = "music-profile-name";
  name.tabIndex = -1;
  copy.append(name);
  if (person.aliases?.length) copy.append(element("p", "music-aliases", `Also credited as ${person.aliases.slice(0, 6).join(", ")}`));
  const meta = [person.type, person.area || person.country, person.begin ? `${person.type === "Group" ? "Formed" : "Born"} ${musicLabYear(person.begin)}` : ""].filter(Boolean).join(" · ");
  if (meta) copy.append(element("p", "music-meta", meta));
  copy.append(musicLabProfileLinks(person));
  const actions = element("div", "music-actions");
  actions.append(musicLabLink("Collaboration network", `#music/network/${id}`, "music-text-link"));
  copy.append(musicLabControls(ref, { follow: true, note: "Listening notes" }), actions);
  head.append(figure, copy);
  wrap.append(head);

  if (person.live) {
    const pendingCount = person.songs.filter((song) => !song.recording).length;
    const notice = element("div", "music-banner");
    notice.setAttribute("role", "status");
    if (musicLabUi.enriching.has(id)) {
      notice.append(musicLabLoading(musicLabUi.status[`enrich:${id}`] || "Loading song details…"));
    } else {
      notice.append(element("span", "", `Loaded live from MusicBrainz. ${pendingCount ? `${pendingCount} credit${pendingCount === 1 ? "" : "s"} only list a title until their song details load.` : "Song details are loaded."}`));
      if (pendingCount) {
        const more = element("button", "secondary", `Load song details (${Math.min(pendingCount, 40)})`);
        more.type = "button";
        more.id = "music-enrich";
        more.addEventListener("click", () => {
          musicLabUi.enriching.add(id);
          musicLabRefresh();
          musicLabEnrichLivePerson(person, 40, (done, total) => {
            musicLabUi.status[`enrich:${id}`] = `Loading song details… ${done} of ${total}`;
            const node = musicLabRoot?.querySelector(".music-banner .music-loading span:last-child");
            if (node) node.textContent = musicLabUi.status[`enrich:${id}`];
          }).finally(() => {
            musicLabUi.enriching.delete(id);
            musicLabRefresh();
          });
        });
        notice.append(more);
      }
    }
    wrap.append(notice);
  } else if (person.status === "stale") {
    wrap.append(musicLabStaleBanner({ stale: true }));
  }

  const about = musicLabPanel("About", "music-about-title");
  about.append(musicLabBio(person));
  const corrections = musicLabCorrectionsFor(person);
  const counts = musicLabRoleCounts(person.songs);
  const summary = element("ul", "music-role-summary");
  summary.setAttribute("aria-label", "Credits by role");
  for (const [category, label] of musicLabRoles) {
    const verified = counts.get(category) || 0;
    const added = corrections.filter((item) => item.role === category).length;
    const item = element("li", verified || added ? "" : "is-empty");
    item.append(element("span", `music-role music-role-${category}`, label), element("strong", "", String(verified)));
    if (added) item.append(element("small", "", `+${added} yours`));
    if (category === "vocalProduction" && !verified) item.title = "MusicBrainz has no vocal-production credit type, so these only come from your sourced additions.";
    summary.append(item);
  }
  about.append(summary);
  wrap.append(about);
  wrap.append(createMusicLabCredits(person, id));
  if (corrections.length) wrap.append(createMusicLabCorrectionList(corrections, "Your additions naming this person", false));
  wrap.append(createMusicLabCollaborators(person));
  if (person.releaseGroups?.length) {
    const releases = musicLabPanel("Releases as an artist", "music-own-releases-title");
    const row = element("div", "music-card-row");
    for (const group of [...person.releaseGroups].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 24)) {
      row.append(musicLabCard({ href: `#music/group/${group.id}`, image: `https://coverartarchive.org/release-group/${group.id}/front-250`,
        title: group.title, subtitle: [group.type, ...(group.secondary || [])].filter(Boolean).join(" · "), meta: musicLabFormatDate(group.date) }));
    }
    releases.append(row);
    wrap.append(releases);
  }
  wrap.append(musicLabSourceNote(snapshot));
  return wrap;
}

function createMusicLabCredits(person, id) {
  const panel = musicLabPanel("Discography & credits", "music-credits-title");
  const filters = musicLabUi.profile.id === id ? musicLabUi.profile : (musicLabUi.profile = { id, role: "all", source: "all", artist: "all", year: "all", query: "", sort: "newest" });
  const songs = person.songs;
  const artists = new Map();
  const years = new Set();
  for (const song of songs) {
    for (const artist of song.recording?.artists || []) artists.set(artist.id || `name:${musicLabNormalizeName(artist.name)}`, artist.name);
    const year = musicLabYear(song.recording?.release?.date || song.recording?.date);
    if (year) years.add(year);
  }
  const controls = element("div", "music-filters");
  const role = bowlingLikeSelect("music-filter-role", "Role", [["all", "All roles"], ...musicLabRoles], filters.role);
  const artist = bowlingLikeSelect("music-filter-artist", "Artist", [["all", "All artists"], ...[...artists].sort((a, b) => a[1].localeCompare(b[1]))], filters.artist);
  const year = bowlingLikeSelect("music-filter-year", "Year", [["all", "All years"], ...[...years].sort().reverse().map((value) => [value, value])], filters.year);
  const sourceSelect = bowlingLikeSelect("music-filter-source", "Source", [["all", "All sources"], ["musicbrainz", "MusicBrainz"], ["discogs", "Discogs"], ["genius", "Genius"]], filters.source);
  const sort = bowlingLikeSelect("music-filter-sort", "Order", [["newest", "Newest first"], ["oldest", "Oldest first"], ["title", "Title A–Z"]], filters.sort);
  const queryField = element("div", "field");
  const queryLabel = element("label", "", "Search");
  queryLabel.htmlFor = "music-filter-query";
  const query = document.createElement("input");
  query.type = "search";
  query.id = "music-filter-query";
  query.placeholder = "Song or album";
  query.value = filters.query;
  queryField.append(queryLabel, query);
  controls.append(role.field, sourceSelect.field, artist.field, year.field, sort.field, queryField);
  const count = element("p", "music-count");
  count.setAttribute("aria-live", "polite");
  const list = element("ol", "music-credit-list");
  const render = () => {
    const text = musicLabNormalizeName(filters.query);
    let rows = songs.filter((song) => {
      const recording = song.recording;
      const roles = filters.source === "all" ? song.roles : song.roles.filter((item) => item.source === filters.source);
      if (!roles.length) return false;
      if (filters.role !== "all" && !roles.some((item) => item.category === filters.role)) return false;
      if (filters.artist !== "all" && !(recording?.artists || []).some((item) => (item.id || `name:${musicLabNormalizeName(item.name)}`) === filters.artist)) return false;
      if (filters.year !== "all" && musicLabYear(recording?.release?.date || recording?.date) !== filters.year) return false;
      if (text && !musicLabNormalizeName(`${song.title} ${recording?.release?.group?.title || ""} ${musicLabArtistLine(recording?.artists)}`).includes(text)) return false;
      return true;
    });
    const date = (song) => song.recording?.release?.date || song.recording?.date || "";
    rows = rows.sort(filters.sort === "title" ? (a, b) => a.title.localeCompare(b.title)
      : filters.sort === "oldest" ? (a, b) => (date(a) || "9999").localeCompare(date(b) || "9999") || a.title.localeCompare(b.title)
        : (a, b) => date(b).localeCompare(date(a)) || a.title.localeCompare(b.title));
    count.textContent = filters.role === "vocalProduction" && !rows.length
      ? "No vocal-production credits found. MusicBrainz doesn’t track this role; Discogs and Genius list it when contributors have entered it. You can add sourced credits from a song page."
      : `${rows.length} of ${songs.length} credited song${songs.length === 1 ? "" : "s"}`;
    list.replaceChildren();
    for (const song of rows) {
      const recording = song.recording;
      const item = element("li", "music-credit");
      item.append(musicLabImage(recording ? musicLabCover(recording.release) : "", "", "music-credit-cover", "♪"));
      const body = element("div", "music-credit-body");
      const title = recording?.id ? musicLabLink(song.title, `#music/song/${recording.id}`, "music-credit-title")
        : recording?.externalUrl ? musicLabExternal(`${song.title} ↗`, recording.externalUrl, "music-credit-title")
          : element("span", "music-credit-title", song.title);
      body.append(title);
      if (recording) {
        const line = element("span", "music-credit-meta");
        line.append(musicLabArtistLine(recording.artists) || "Unknown artist");
        if (recording.release?.group?.title) {
          line.append(" · ");
          line.append(recording.release.id ? musicLabLink(recording.release.group.title, `#music/album/${recording.release.id}`) : recording.release.group.title);
        }
        if (song.discogsOnly) line.append(" · Discogs only");
        line.append(` · ${musicLabFormatDate(recording.release?.date || recording.date)}`);
        body.append(line);
      } else {
        body.append(element("span", "music-credit-meta", person.live ? "Song details not loaded yet" : "Details unavailable: MusicBrainz lists the credit but not a matching recording"));
      }
      const roles = element("div", "music-roles");
      (filters.source === "all" ? song.roles : song.roles.filter((item) => item.source === filters.source)).forEach((roleItem) => roles.append(musicLabRoleBadge(roleItem)));
      body.append(roles);
      item.append(body);
      list.append(item);
    }
    if (!rows.length) list.append(musicLabEmpty(songs.length ? "No credits match these filters." : "MusicBrainz doesn’t list any song credits for this person yet."));
  };
  const bind = (select, field) => select.addEventListener("change", () => {
    filters[field] = select.value;
    render();
  });
  bind(role.select, "role");
  bind(sourceSelect.select, "source");
  bind(artist.select, "artist");
  bind(year.select, "year");
  bind(sort.select, "sort");
  query.addEventListener("input", () => {
    filters.query = query.value;
    render();
  });
  render();
  panel.append(controls, count, list);
  return panel;
}

function bowlingLikeSelect(id, labelText, options, value) {
  const field = element("div", "field");
  const label = element("label", "", labelText);
  label.htmlFor = id;
  const select = document.createElement("select");
  select.id = id;
  for (const [optionValue, optionLabel] of options) {
    const option = element("option", "", optionLabel);
    option.value = optionValue;
    option.selected = optionValue === value;
    select.append(option);
  }
  field.append(label, select);
  return { field, select };
}

// Everyone this person shares a documented recording with: performing artists and co-credited people.
// Everyone this person shares a documented recording with, from every source: performing artists and co-credited people.
// Nodes use the MusicBrainz ID when known, otherwise the credited name.
function musicLabConnections(person, { role = "all", year = "all", source = "all" } = {}) {
  const nodes = new Map();
  const names = musicLabPersonNames(person);
  for (const song of person.songs) {
    const recording = song.recording;
    if (!recording) continue;
    if (role !== "all" && !song.roles.some((item) => item.category === role && (source === "all" || item.source === source))) continue;
    if (source !== "all" && !song.roles.some((item) => item.source === source)) continue;
    if (year !== "all" && musicLabYear(recording.release?.date || recording.date) !== year) continue;
    const songKey = recording.id || song.key;
    const add = (id, name, kind, label, from) => {
      // One node per credited name, so the same collaborator from MusicBrainz and Discogs isn't counted twice.
      const key = `name:${musicLabNormalizeName(name)}`;
      if (!name || id === person.mbid || names.has(musicLabNormalizeName(name))) return;
      const node = nodes.get(key) || { id: key, mbid: "", name, kinds: new Set(), roles: new Set(), sources: new Set(), songs: new Map(), titles: new Set() };
      if (id && !node.mbid) node.mbid = id;
      node.kinds.add(kind);
      if (label) node.roles.add(label);
      node.sources.add(from);
      // Count each song title once per collaborator, whichever version or source it came from.
      const title = musicLabNormalizeName(recording.title);
      if (!node.titles.has(title)) {
        node.titles.add(title);
        node.songs.set(songKey, recording);
      }
      nodes.set(key, node);
    };
    for (const artist of recording.artists || []) add(artist.id, artist.name, "artist", "Performing artist", recording.id ? "musicbrainz" : "discogs");
    for (const entry of musicLabRecordingEntries(recording)) {
      if (source !== "all" && entry.source !== source) continue;
      if (musicLabEntryIsPerson(entry, person, names)) continue;
      add(entry.id, entry.name, entry.category === "performance" ? "performer" : "creative", entry.label, entry.source);
    }
  }
  return [...nodes.values()].sort((a, b) => b.songs.size - a.songs.size || a.name.localeCompare(b.name));
}

function createMusicLabCollaborators(person) {
  const panel = musicLabPanel("Collaborators", "music-collaborators-title");
  const connections = musicLabConnections(person);
  if (!connections.length) {
    panel.append(musicLabEmpty(person.live ? "Load song details to see who this person has worked with." : "No collaborators are documented yet."));
    return panel;
  }
  const artistsList = connections.filter((node) => node.kinds.has("artist")).slice(0, 16);
  const creativeList = connections.filter((node) => node.kinds.has("creative")).slice(0, 16);
  const group = (title, nodes) => {
    const box = element("div", "music-collab-group");
    box.append(element("h4", "", title));
    const list = element("ul", "music-chip-list");
    for (const node of nodes) {
      const item = element("li");
      const link = musicLabLink(`${node.name}`, node.mbid ? `#music/person/${node.mbid}` : `#music/search/${encodeURIComponent(node.name)}`, "music-chip");
      link.append(element("small", "", ` ${node.songs.size}`));
      link.setAttribute("aria-label", `${node.name}, ${node.songs.size} shared song${node.songs.size === 1 ? "" : "s"}`);
      item.append(link);
      list.append(item);
    }
    box.append(nodes.length ? list : musicLabEmpty("None documented."));
    return box;
  };
  panel.append(group("Artists they’ve worked with", artistsList), group("Co-writers, co-producers and engineers", creativeList),
    musicLabLink("Open the collaboration network", `#music/network/${person.mbid}`, "music-text-link"));
  return panel;
}

// ---------- Song page ----------

function musicLabSongCreditGroups(recording, corrections = []) {
  const groups = musicLabRoles.map(([category, label]) => ({ category, label, verified: [], added: [] }));
  const find = (category) => groups.find((group) => group.category === category);
  const index = new Map();
  for (const entry of musicLabRecordingEntries(recording)) {
    const group = find(entry.category);
    const key = `${entry.category}|${entry.id || musicLabNormalizeName(entry.name)}`;
    let item = index.get(key);
    if (!item) {
      item = { id: entry.id || "", name: entry.name, as: new Set(), labels: new Set(), sources: new Set() };
      index.set(key, item);
      group.verified.push(item);
    }
    if (!item.id && entry.id) item.id = entry.id;
    if (entry.source === "musicbrainz") item.name = entry.name;
    if (entry.as && entry.as !== item.name) item.as.add(entry.as);
    item.labels.add(entry.label);
    item.sources.add(entry.source);
  }
  for (const correction of corrections) find(correction.role).added.push(correction);
  return groups;
}

function createMusicLabCreditGroups(groups, { compact = false } = {}) {
  const list = element("dl", `music-credit-groups${compact ? " is-compact" : ""}`);
  const always = new Set(["songwriting", "composition", "production", "vocalProduction", "arrangement", "engineering"]);
  for (const group of groups) {
    if (!group.verified.length && !group.added.length && (!always.has(group.category) || compact)) continue;
    const term = element("dt", `music-role-term music-role-${group.category}`, group.label);
    const detail = element("dd");
    if (group.verified.length) {
      const names = element("ul", "music-names");
      for (const credit of group.verified) {
        const item = element("li");
        item.append(credit.id ? musicLabLink(credit.name, `#music/person/${credit.id}`) : element("span", "", credit.name));
        if (credit.as.size) item.append(element("small", "", ` as ${[...credit.as].join(", ")}`));
        const labels = [...credit.labels].filter((label) => label.toLowerCase() !== group.label.toLowerCase());
        if (labels.length) item.append(element("small", "", ` ${[...new Set(labels)].join(" · ")}`));
        for (const source of ["musicbrainz", "discogs", "genius"]) {
          if (!credit.sources.has(source)) continue;
          const mark = element("span", `music-src music-src-${source}`, source === "musicbrainz" ? "MB" : musicLabSourceLabels[source]);
          mark.title = `From ${musicLabSourceLabels[source]}${source === "genius" ? " (community-edited)" : ""}`;
          item.append(mark);
        }
        names.append(item);
      }
      detail.append(names);
    } else if (!group.added.length) {
      detail.append(element("span", "music-unavailable", group.category === "vocalProduction" ? "Not documented (MusicBrainz doesn’t track this role)" : "Not documented"));
    }
    for (const correction of group.added) {
      const added = element("p", "music-added");
      added.append(element("span", "music-unverified", "Your addition · unverified"), " ", correction.person ? musicLabLink(correction.name, `#music/person/${correction.person}`) : correction.name, " · ",
        musicLabExternal("source", correction.source));
      detail.append(added);
    }
    list.append(term, detail);
  }
  return list;
}

function musicLabListenLinks(recording) {
  const query = `${musicLabArtistLine(recording.artists)} ${recording.title}`.trim();
  const row = element("div", "music-listen");
  row.append(element("span", "music-listen-label", "Listen"));
  const spotify = recording.links?.spotify;
  row.append(musicLabExternal(spotify ? "Spotify" : "Search Spotify", spotify || `https://open.spotify.com/search/${encodeURIComponent(query)}`, "music-listen-link"));
  const apple = recording.links?.appleMusic || musicLabAppleLinks.get(recording.id);
  row.append(musicLabExternal(apple ? "Apple Music" : "Search Apple Music", apple || `https://music.apple.com/us/search?term=${encodeURIComponent(query)}`, "music-listen-link"));
  const youtube = recording.links?.youtube || recording.links?.youtubeMusic;
  row.append(musicLabExternal(youtube ? "YouTube" : "Search YouTube", youtube || `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, "music-listen-link"));
  if (!recording.links?.appleMusic && !musicLabAppleLinks.has(recording.id)) {
    musicLabAppleLinks.set(recording.id, "");
    musicLabFindAppleMusic(recording).then((url) => {
      if (!url) return;
      musicLabAppleLinks.set(recording.id, url);
      if (location.hash === `#music/song/${recording.id}`) musicLabRefresh();
    });
  }
  return row;
}

// Apple's public iTunes Search API: only an exact title and artist match counts.
async function musicLabFindAppleMusic(recording) {
  const artist = musicLabNormalizeName(recording.artists?.[0]?.name);
  const title = musicLabNormalizeName(recording.title);
  if (!artist || !title) return "";
  try {
    const url = `https://itunes.apple.com/search?${new URLSearchParams({ term: `${recording.artists[0].name} ${recording.title}`, entity: "song", limit: "10" })}`;
    const data = await musicLabFetchJson(url, { spacing: 0 });
    const match = (data?.results || []).find((item) => musicLabNormalizeName(item.trackName) === title && musicLabNormalizeName(item.artistName).includes(artist));
    const link = match?.trackViewUrl ? new URL(match.trackViewUrl) : null;
    return link && link.protocol === "https:" && /(^|\.)apple\.com$/.test(link.hostname) ? link.href : "";
  } catch {
    return "";
  }
}

function musicLabRelatedSongs(recording, snapshot, limit = 8) {
  if (!snapshot) return [];
  const creatives = new Map();
  for (const credit of [...(recording.credits || []), ...(recording.writers || [])]) {
    const category = musicLabCategory(credit.work ? "work" : "recording", credit.type);
    if (credit.id && category !== "performance") creatives.set(credit.id, credit.name);
  }
  const scores = new Map();
  for (const [id, name] of creatives) {
    for (const other of snapshot.songsByContributor.get(id) || []) {
      if (other === recording.id) continue;
      const entry = scores.get(other) || { id: other, names: new Set() };
      entry.names.add(name);
      scores.set(other, entry);
    }
  }
  return [...scores.values()].filter((entry) => snapshot.recordings[entry.id])
    .sort((a, b) => b.names.size - a.names.size || (snapshot.recordings[b.id].date || "").localeCompare(snapshot.recordings[a.id].date || ""))
    .slice(0, limit).map((entry) => ({ recording: snapshot.recordings[entry.id], names: [...entry.names] }));
}

function createMusicLabSong(id, snapshot) {
  if (!musicLabIsMbid(id)) return musicLabError("That isn’t a valid MusicBrainz recording ID.");
  const key = `song:${id}`;
  let recording = snapshot?.recordings[id] || musicLabLiveSongs.get(id) || [...musicLabLiveProfiles.values()].map((person) => person.liveRecordings[id]).find(Boolean);
  if (!recording) {
    if (musicLabUi.status[key]) return musicLabError(musicLabUi.status[key], () => { delete musicLabUi.status[key]; musicLabRefresh(); });
    musicLabLoad(key, async () => {
      const data = await musicLabMbFetch(`recording/${id}?inc=artist-credits+releases+release-groups+artist-rels+work-rels+work-level-rels+url-rels`);
      if (!data) throw new Error("MusicBrainz has no recording with that ID.");
      musicLabLiveSongs.set(id, musicLabParseRecording(data));
    });
    return musicLabLoading("Loading song credits from MusicBrainz…");
  }
  const artistLine = musicLabArtistLine(recording.artists);
  const cover = musicLabCover(recording.release);
  const ref = musicLabRef("song", id, recording.title, artistLine, cover);
  musicLabRecordVisit(ref);
  const wrap = element("div", "music-detail");
  const head = element("section", "music-panel music-detail-head");
  head.setAttribute("aria-labelledby", "music-song-title");
  head.append(musicLabImage(cover, recording.release ? `Cover of ${recording.release.title}` : "", "music-detail-cover", "♪"));
  const copy = element("div", "music-detail-copy");
  copy.append(element("span", "music-kicker", "Song"));
  const title = element("h3", "", recording.title);
  title.id = "music-song-title";
  title.tabIndex = -1;
  copy.append(title);
  const artists = element("p", "music-detail-artists");
  for (const artist of recording.artists || []) {
    artists.append(artist.id ? musicLabLink(artist.name, `#music/person/${artist.id}`) : artist.name, artist.join || "");
  }
  copy.append(artists);
  const facts = element("dl", "music-facts");
  const fact = (label, value) => {
    if (!value) return;
    facts.append(element("dt", "", label));
    const detail = element("dd");
    detail.append(value);
    facts.append(detail);
  };
  fact("Released", musicLabFormatDate(recording.date || recording.release?.date));
  if (recording.release) fact("Album", musicLabLink(recording.release.group?.title || recording.release.title, `#music/album/${recording.release.id}`));
  fact("Length", musicLabLength(recording.length));
  copy.append(facts, musicLabListenLinks(recording), musicLabControls(ref, { rate: true, favorite: true, discover: true, list: true, note: "Listening notes" }));
  head.append(copy);
  wrap.append(head);

  const corrections = musicLabGetState().corrections.filter((item) => item.target === key);
  const credits = musicLabPanel("Credits", "music-song-credits-title");
  credits.append(createMusicLabCreditGroups(musicLabSongCreditGroups(recording, corrections)));
  const source = element("p", "music-source");
  source.append("MusicBrainz writers and composers come from the song’s work, and its producers, arrangers and engineers from this recording. Discogs credits come from the release’s booklet credits; Genius credits are community-edited. Sources: ");
  musicLabSourceLinks(recording).forEach(([kind, url], index) => source.append(index ? ", " : "", musicLabExternal(musicLabSourceLabels[kind], url)));
  source.append(".");
  credits.append(source);
  wrap.append(credits);
  wrap.append(createMusicLabCorrections(key, recording.title, corrections));

  const related = musicLabPanel("Related songs", "music-related-title");
  const songs = musicLabRelatedSongs(recording, snapshot);
  if (songs.length) {
    const row = element("div", "music-card-row");
    for (const { recording: other, names } of songs) {
      row.append(musicLabCard({ href: `#music/song/${other.id}`, image: musicLabCover(other.release), title: other.title,
        subtitle: musicLabArtistLine(other.artists), meta: `Shared: ${names.slice(0, 3).join(", ")}` }));
    }
    related.append(row);
  } else {
    related.append(musicLabEmpty("No other songs in Music Lab share a writer, producer or engineer with this one yet."));
  }
  wrap.append(related);
  return wrap;
}

// ---------- Corrections ----------

function createMusicLabCorrections(target, targetTitle, corrections) {
  const panel = musicLabPanel("Your credit additions", `music-corrections-title`);
  panel.append(element("p", "music-hint", "Add a credit MusicBrainz is missing, with a link to where it’s documented (album booklet scan, label post, publisher database). Additions are labeled as unverified and are kept separate from MusicBrainz data."));
  if (corrections.length) panel.append(createMusicLabCorrectionList(corrections, "", true));
  const form = element("form", "music-correction-form");
  form.noValidate = true;
  const role = bowlingLikeSelect("music-correction-role", "Role", musicLabRoles, "vocalProduction");
  const field = (id, label, type, placeholder) => {
    const wrap = element("div", "field");
    const labelNode = element("label", "", label);
    labelNode.htmlFor = id;
    const input = document.createElement("input");
    input.id = id;
    input.type = type;
    input.placeholder = placeholder;
    wrap.append(labelNode, input);
    return { wrap, input };
  };
  const name = field("music-correction-name", "Name", "text", "Who did it");
  const person = field("music-correction-person", "MusicBrainz artist link (optional)", "url", "https://musicbrainz.org/artist/…");
  const sourceField = field("music-correction-source", "Source link", "url", "https://…");
  const note = field("music-correction-note", "Note (optional)", "text", "e.g. Listed in the digital booklet");
  const save = element("button", "", "Add credit");
  save.type = "submit";
  const status = element("p", "music-status");
  status.setAttribute("role", "status");
  form.append(role.field, name.wrap, sourceField.wrap, person.wrap, note.wrap, save, status);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const fail = (message, input) => {
      status.textContent = message;
      status.classList.add("error");
      input.setAttribute("aria-invalid", "true");
      input.focus();
    };
    [name.input, sourceField.input, person.input].forEach((input) => input.removeAttribute("aria-invalid"));
    if (!name.input.value.trim()) return fail("Enter the person’s name.", name.input);
    if (!musicLabValidUrl(sourceField.input.value.trim())) return fail("Add a source link starting with https:// so the credit can be checked.", sourceField.input);
    const mbid = (person.input.value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [""])[0];
    if (person.input.value.trim() && !mbid) return fail("That doesn’t look like a MusicBrainz artist link.", person.input);
    musicLabCommit((next, now) => {
      next.corrections.push({ id: musicLabId("credit"), target, targetTitle, role: role.select.value, name: name.input.value.trim(), person: mbid,
        source: sourceField.input.value.trim(), note: note.input.value.trim(), createdAt: now, updatedAt: now });
    });
    musicLabRefresh("music-corrections-title");
  });
  panel.append(form);
  return panel;
}

function createMusicLabCorrectionList(corrections, title, withTarget) {
  const box = title ? musicLabPanel(title, "music-person-corrections-title") : element("div");
  const list = element("ul", "music-correction-list");
  for (const correction of corrections) {
    const item = element("li");
    const text = element("div", "");
    text.append(element("span", "music-unverified", "Unverified"), " ", element("strong", "", correction.name), ` · ${musicLabRoleLabels[correction.role]}`);
    if (!withTarget) {
      text.append(" on ");
      text.append(musicLabLink(correction.targetTitle || "a song", musicLabHref({ key: correction.target })));
    }
    text.append(" · ", musicLabExternal("source", correction.source));
    if (correction.note) text.append(element("small", "", ` ${correction.note}`));
    const remove = element("button", "secondary", "Remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${correction.name} as ${musicLabRoleLabels[correction.role]}`);
    remove.addEventListener("click", () => {
      musicLabCommit((next) => {
        next.corrections = next.corrections.filter((item2) => item2.id !== correction.id);
        next.deletedCorrectionIds = [...new Set([...next.deletedCorrectionIds, correction.id])];
      });
      musicLabRefresh();
    });
    item.append(text, remove);
    list.append(item);
  }
  box.append(list);
  return box;
}

// ---------- Album page ----------

function musicLabParseRelease(data) {
  const group = data["release-group"] || {};
  const tracks = [];
  for (const medium of data.media || []) {
    for (const track of medium.tracks || []) {
      const recording = track.recording || {};
      const parsed = musicLabParseRecording({ ...recording, releases: [] });
      tracks.push({ position: medium.position, number: track.number || String(track.position), title: track.title || recording.title,
        length: track.length ?? recording.length, recording: { ...parsed, release: { id: data.id, title: data.title, date: data.date || "", group: { id: group.id, title: group.title, type: group["primary-type"] || "" } } } });
    }
  }
  return {
    id: data.id, title: data.title || "", date: data.date || "", country: data.country || "", status: data.status || "",
    artists: (data["artist-credit"] || []).map((item) => ({ id: item.artist?.id || "", name: item.name || item.artist?.name || "", join: item.joinphrase || "" })),
    group: { id: group.id || "", title: group.title || "", type: group["primary-type"] || "", secondary: group["secondary-types"] || [], date: group["first-release-date"] || "" },
    labels: (data["label-info"] || []).map((info) => info.label?.name).filter(Boolean),
    credits: (data.relations || []).filter((relation) => relation["target-type"] === "artist").map(musicLabPersonRef),
    links: musicLabStreamingLinks(data.relations), media: (data.media || []).length, tracks
  };
}

function createMusicLabGroup(id) {
  if (!musicLabIsMbid(id)) return musicLabError("That isn’t a valid MusicBrainz release-group ID.");
  const key = `group:${id}`;
  if (musicLabUi.status[key]) return musicLabError(musicLabUi.status[key], () => { delete musicLabUi.status[key]; musicLabRefresh(); });
  musicLabLoad(key, async () => {
    const data = await musicLabMbFetch(`release-group/${id}?inc=releases`);
    if (!data) throw new Error("MusicBrainz has no album with that ID.");
    const releases = (data.releases || []).map((release) => ({ ...release, "release-group": data }));
    const release = musicLabPickRelease(releases);
    if (!release) throw new Error("MusicBrainz doesn’t list a release for this album yet.");
    location.replace(`#music/album/${release.id}`);
  });
  return musicLabLoading("Finding this album on MusicBrainz…");
}

function createMusicLabAlbum(id) {
  if (!musicLabIsMbid(id)) return musicLabError("That isn’t a valid MusicBrainz release ID.");
  const key = `album:${id}`;
  const album = musicLabLiveAlbums.get(id);
  if (!album) {
    if (musicLabUi.status[key]) return musicLabError(musicLabUi.status[key], () => { delete musicLabUi.status[key]; musicLabRefresh(); });
    musicLabLoad(key, async () => {
      const data = await musicLabMbFetch(`release/${id}?inc=recordings+artist-credits+labels+release-groups+url-rels+artist-rels+recording-level-rels+work-rels+work-level-rels`);
      if (!data) throw new Error("MusicBrainz has no release with that ID.");
      musicLabLiveAlbums.set(id, musicLabParseRelease(data));
    });
    return musicLabLoading("Loading the track list and credits from MusicBrainz…");
  }
  const cover = musicLabCover({ id: album.id });
  const artistLine = musicLabArtistLine(album.artists);
  const ref = musicLabRef("album", album.group.id || album.id, album.group.title || album.title, artistLine, cover, album.id);
  if (!album.group.id) return musicLabError("This release isn’t linked to an album on MusicBrainz.");
  musicLabRecordVisit(ref);
  const wrap = element("div", "music-detail");
  const head = element("section", "music-panel music-detail-head");
  head.setAttribute("aria-labelledby", "music-album-title");
  head.append(musicLabImage(cover, `Cover of ${album.title}`, "music-detail-cover", "♪"));
  const copy = element("div", "music-detail-copy");
  copy.append(element("span", "music-kicker", [album.group.type || "Release", ...album.group.secondary].join(" · ")));
  const title = element("h3", "", album.title);
  title.id = "music-album-title";
  title.tabIndex = -1;
  copy.append(title);
  const artists = element("p", "music-detail-artists");
  for (const artist of album.artists) artists.append(artist.id ? musicLabLink(artist.name, `#music/person/${artist.id}`) : artist.name, artist.join || "");
  copy.append(artists);
  const facts = element("dl", "music-facts");
  for (const [label, value] of [["Released", musicLabFormatDate(album.date)], ["First released", album.group.date && album.group.date !== album.date ? musicLabFormatDate(album.group.date) : ""],
    ["Label", album.labels.join(", ")], ["Country", album.country], ["Tracks", String(album.tracks.length)], ["Status", album.status]]) {
    if (!value) continue;
    facts.append(element("dt", "", label), element("dd", "", value));
  }
  copy.append(facts);
  const query = `${artistLine} ${album.title}`;
  const listen = element("div", "music-listen");
  listen.append(element("span", "music-listen-label", "Listen"),
    musicLabExternal(album.links.spotify ? "Spotify" : "Search Spotify", album.links.spotify || `https://open.spotify.com/search/${encodeURIComponent(query)}`, "music-listen-link"),
    musicLabExternal(album.links.appleMusic ? "Apple Music" : "Search Apple Music", album.links.appleMusic || `https://music.apple.com/us/search?term=${encodeURIComponent(query)}`, "music-listen-link"),
    musicLabExternal(album.links.youtube ? "YouTube" : "Search YouTube", album.links.youtube || album.links.youtubeMusic || `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, "music-listen-link"));
  copy.append(listen, musicLabControls(ref, { rate: true, favorite: true, discover: true, list: true, note: "Review" }));
  head.append(copy);
  wrap.append(head);
  if (album.credits.length) {
    const albumCredits = musicLabPanel("Album credits", "music-album-credits-title");
    albumCredits.append(createMusicLabCreditGroups(musicLabSongCreditGroups({ credits: album.credits, writers: [] }), { compact: true }));
    wrap.append(albumCredits);
  }
  const tracks = musicLabPanel("Track list & song credits", "music-tracks-title");
  const list = element("ol", "music-tracks");
  for (const track of album.tracks) {
    const item = element("li", "music-track");
    const head2 = element("div", "music-track-head");
    head2.append(element("span", "music-track-number", album.media > 1 ? `${track.position}-${track.number}` : track.number));
    head2.append(track.recording.id ? musicLabLink(track.title, `#music/song/${track.recording.id}`, "music-track-title") : element("span", "music-track-title", track.title));
    const otherArtists = musicLabArtistLine(track.recording.artists);
    if (otherArtists && otherArtists !== artistLine) head2.append(element("span", "music-track-artists", otherArtists));
    head2.append(element("span", "music-track-length", musicLabLength(track.length)));
    item.append(head2);
    const groups = musicLabSongCreditGroups(track.recording, musicLabGetState().corrections.filter((entry) => entry.target === `song:${track.recording.id}`));
    const writers = groups.filter((group) => ["songwriting", "composition"].includes(group.category)).flatMap((group) => group.verified.map((credit) => credit.name));
    // Tracks Music Lab already knows pick up Discogs and Genius credits too.
    const producers = groups.find((group) => group.category === "production").verified.map((credit) => credit.name);
    const summary = element("p", "music-track-summary");
    summary.append(writers.length ? `Written by ${[...new Set(writers)].join(", ")}` : "Writers not documented", " · ",
      producers.length ? `Produced by ${[...new Set(producers)].join(", ")}` : "Producers not documented");
    item.append(summary);
    if (groups.some((group) => group.verified.length || group.added.length)) {
      const details = element("details", "music-track-details");
      details.append(element("summary", "", "All credits"), createMusicLabCreditGroups(groups, { compact: true }));
      item.append(details);
    }
    list.append(item);
  }
  tracks.append(album.tracks.length ? list : musicLabEmpty("MusicBrainz doesn’t list tracks for this release."));
  const source = element("p", "music-source");
  source.append("Track list and credits from ", musicLabExternal("MusicBrainz", `https://musicbrainz.org/release/${album.id}`), ". Ratings and reviews apply to every edition of this album.");
  tracks.append(source);
  wrap.append(tracks);
  return wrap;
}

// ---------- Collaboration network ----------

function musicLabNetworkPeople(snapshot) {
  const options = snapshot.people.filter((person) => person.mbid && person.status !== "missing").map((person) => [person.mbid, person.name]);
  for (const item of musicLabGetState().items.filter((entry) => entry.following)) {
    const id = item.key.slice(7);
    if (!options.some(([value]) => value === id)) options.push([id, item.title]);
  }
  for (const [id, person] of musicLabLiveProfiles) if (!options.some(([value]) => value === id)) options.push([id, person.name]);
  return options;
}

function createMusicLabNetwork(route, snapshot) {
  const options = musicLabNetworkPeople(snapshot);
  const id = route.id || options[0]?.[0] || "";
  const state = musicLabUi.network;
  if (state.id !== id) Object.assign(state, { id, role: "all", source: "all", year: "all", scale: 1, x: 0, y: 0, selected: route.focus || "" });
  else if (route.focus && !state.selected) state.selected = route.focus;
  const panel = musicLabPanel("Collaboration network", "music-network-title", "music-network-panel");
  panel.append(element("p", "music-hint", "Every connection is a recording where both names appear in documented credits (MusicBrainz, Discogs or Genius). Select a person to see the songs you share."));
  if (!id) {
    panel.append(musicLabEmpty("Follow a producer or songwriter to explore their network."));
    return panel;
  }
  if (!musicLabIsMbid(id)) {
    panel.append(musicLabError("That isn’t a valid MusicBrainz artist ID."));
    return panel;
  }
  const person = musicLabPersonFromSnapshotOrLive(id, snapshot);
  if (!person) {
    const key = `person:${id}`;
    if (musicLabUi.status[key]) {
      panel.append(musicLabError(musicLabUi.status[key]));
      return panel;
    }
    musicLabLoad(key, () => musicLabFetchLivePerson(id));
    panel.append(musicLabLoading("Loading this person from MusicBrainz…"));
    return panel;
  }
  const years = [...new Set(person.songs.map((song) => musicLabYear(song.recording?.release?.date || song.recording?.date)).filter(Boolean))].sort().reverse();
  const controls = element("div", "music-filters");
  const who = bowlingLikeSelect("music-network-person", "Person", options.some(([value]) => value === id) ? options : [[id, person.name], ...options], id);
  const role = bowlingLikeSelect("music-network-role", "Their role", [["all", "All roles"], ...musicLabRoles], state.role);
  const sourceSelect = bowlingLikeSelect("music-network-source", "Source", [["all", "All sources"], ["musicbrainz", "MusicBrainz"], ["discogs", "Discogs"], ["genius", "Genius"]], state.source);
  sourceSelect.select.addEventListener("change", () => { state.source = sourceSelect.select.value; state.selected = ""; musicLabRefresh(sourceSelect.select.id); });
  const year = bowlingLikeSelect("music-network-year", "Year", [["all", "All years"], ...years.map((value) => [value, value])], state.year);
  who.select.addEventListener("change", () => { location.hash = `#music/network/${who.select.value}`; });
  role.select.addEventListener("change", () => { state.role = role.select.value; state.selected = ""; musicLabRefresh(role.select.id); });
  year.select.addEventListener("change", () => { state.year = year.select.value; state.selected = ""; musicLabRefresh(year.select.id); });
  controls.append(who.field, role.field, sourceSelect.field, year.field);
  panel.append(controls);
  if (person.live && person.songs.some((song) => !song.recording)) {
    const note = element("p", "music-banner");
    note.append("This person was loaded live, so only songs whose details have loaded appear. ", musicLabLink("Load more on their profile", `#music/person/${id}`));
    panel.append(note);
  }
  const nodes = musicLabConnections(person, state).slice(0, 40);
  if (!nodes.length) {
    panel.append(musicLabEmpty(state.role === "vocalProduction" ? "No vocal-production credits are documented for this person yet (MusicBrainz doesn’t track the role; Discogs and Genius sometimes do)." : "No documented connections for these filters."));
    return panel;
  }
  const layout = element("div", "music-network-layout");
  const stage = element("div", "music-network-stage");
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", "-520 -400 1040 800");
  svg.setAttribute("class", "music-network");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", `${person.name}'s collaboration network, ${nodes.length} connections. Use the connection list for keyboard access.`);
  const world = document.createElementNS(svgNs, "g");
  const apply = () => world.setAttribute("transform", `translate(${state.x} ${state.y}) scale(${state.scale})`);
  apply();
  // Rings: the strongest connections closest to the center.
  const placed = [];
  let ring = 1;
  let index = 0;
  while (index < nodes.length) {
    const capacity = ring === 1 ? 8 : ring === 2 ? 14 : 20;
    const slice = nodes.slice(index, index + capacity);
    slice.forEach((node, position) => {
      const angle = (position / slice.length) * Math.PI * 2 + ring * 0.4;
      const radius = 130 * ring;
      placed.push({ node, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.82 });
    });
    index += capacity;
    ring += 1;
  }
  const max = Math.max(...nodes.map((node) => node.songs.size));
  const select = (nodeId) => {
    state.selected = state.selected === nodeId ? "" : nodeId;
    musicLabRefresh(state.selected ? `music-node-btn-${nodeId.replace(/[^a-z0-9-]/gi, "-")}` : undefined);
  };
  for (const { node, x, y } of placed) {
    const line = document.createElementNS(svgNs, "line");
    line.setAttribute("x1", "0");
    line.setAttribute("y1", "0");
    line.setAttribute("x2", String(x));
    line.setAttribute("y2", String(y));
    line.setAttribute("class", `music-edge${state.selected === node.id ? " is-selected" : ""}`);
    line.setAttribute("stroke-width", String(1 + (node.songs.size / max) * 5));
    line.addEventListener("click", () => select(node.id));
    world.append(line);
  }
  const center = document.createElementNS(svgNs, "g");
  center.setAttribute("class", "music-node is-center");
  const centerCircle = document.createElementNS(svgNs, "circle");
  centerCircle.setAttribute("r", "34");
  const centerText = document.createElementNS(svgNs, "text");
  centerText.setAttribute("y", "56");
  centerText.textContent = person.name;
  center.append(centerCircle, centerText);
  world.append(center);
  for (const { node, x, y } of placed) {
    const group = document.createElementNS(svgNs, "g");
    const kind = node.kinds.has("artist") ? "artist" : node.kinds.has("creative") ? "creative" : "performer";
    group.setAttribute("class", `music-node is-${kind}${state.selected === node.id ? " is-selected" : ""}`);
    group.setAttribute("transform", `translate(${x} ${y})`);
    group.setAttribute("tabindex", "-1");
    const circle = document.createElementNS(svgNs, "circle");
    circle.setAttribute("r", String(10 + (node.songs.size / max) * 16));
    const label = document.createElementNS(svgNs, "text");
    label.setAttribute("y", String(24 + (node.songs.size / max) * 16));
    label.textContent = node.name.length > 22 ? `${node.name.slice(0, 21)}…` : node.name;
    const tip = document.createElementNS(svgNs, "title");
    tip.textContent = `${node.name}: ${node.songs.size} shared song${node.songs.size === 1 ? "" : "s"}`;
    group.append(tip, circle, label);
    group.addEventListener("click", () => select(node.id));
    world.append(group);
  }
  svg.append(world);
  // Pan with drag, zoom with the wheel or buttons.
  let drag = null;
  svg.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".music-node:not(.is-center)") || event.target.closest(".music-edge")) return;
    drag = { x: event.clientX, y: event.clientY, startX: state.x, startY: state.y, ratio: 1040 / svg.getBoundingClientRect().width };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("is-dragging");
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag) return;
    state.x = drag.startX + (event.clientX - drag.x) * drag.ratio;
    state.y = drag.startY + (event.clientY - drag.y) * drag.ratio;
    apply();
  });
  const endDrag = () => {
    drag = null;
    svg.classList.remove("is-dragging");
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  const zoom = (factor) => {
    state.scale = Math.min(3, Math.max(0.4, state.scale * factor));
    apply();
  };
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
  const tools = element("div", "music-network-tools");
  for (const [label, text, action] of [["Zoom in", "+", () => zoom(1.25)], ["Zoom out", "−", () => zoom(0.8)], ["Reset view", "Reset", () => { state.scale = 1; state.x = 0; state.y = 0; apply(); }]]) {
    const button = element("button", "secondary", text);
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.addEventListener("click", action);
    tools.append(button);
  }
  const legend = element("p", "music-network-legend");
  legend.append(element("span", "is-artist", "Performing artist"), element("span", "is-creative", "Writer, producer or engineer"), element("span", "is-performer", "Session performer"));
  stage.append(tools, svg, legend);
  layout.append(stage);

  const side = element("aside", "music-network-side");
  const selected = nodes.find((node) => node.id === state.selected);
  if (selected) {
    side.append(element("h4", "", selected.name), element("p", "music-meta", [...selected.roles].slice(0, 4).join(" · ")),
      element("p", "music-meta", `Sources: ${[...selected.sources].map((source) => musicLabSourceLabels[source]).join(", ")}`));
    const songs = element("ul", "music-shared-songs");
    for (const recording of [...selected.songs.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""))) {
      const item = element("li");
      item.append(recording.id ? musicLabLink(recording.title, `#music/song/${recording.id}`) : musicLabExternal(`${recording.title} ↗`, recording.externalUrl || "https://www.discogs.com/"),
        element("small", "", ` ${musicLabArtistLine(recording.artists)} · ${musicLabYear(recording.release?.date || recording.date) || "year unknown"}`));
      songs.append(item);
    }
    side.append(element("p", "music-count", `${selected.songs.size} shared song${selected.songs.size === 1 ? "" : "s"}`), songs);
    const actions = element("div", "music-actions");
    if (selected.mbid) actions.append(musicLabLink("Open profile", `#music/person/${selected.mbid}`, "music-button"), musicLabLink("Center on them", `#music/network/${selected.mbid}`, "music-text-link"));
    else actions.append(element("span", "music-meta", "Not matched to a MusicBrainz artist, so there’s no profile to open."), musicLabLink("Search Music Lab", `#music/search/${encodeURIComponent(selected.name)}`, "music-text-link"));
    side.append(actions);
  } else {
    side.append(element("p", "music-hint", "Select a person in the graph or the list to see your shared songs."));
  }
  const listTitle = element("h4", "", "Connections");
  const list = element("ul", "music-connection-list");
  for (const node of nodes) {
    const item = element("li");
    const button = element("button", `music-connection${state.selected === node.id ? " is-selected" : ""}`);
    button.type = "button";
    button.id = `music-node-btn-${node.id.replace(/[^a-z0-9-]/gi, "-")}`;
    button.setAttribute("aria-pressed", String(state.selected === node.id));
    button.append(element("span", "", node.name), element("small", "", `${node.songs.size}`));
    button.addEventListener("click", () => select(node.id));
    item.append(button);
    list.append(item);
  }
  side.append(listTitle, list);
  layout.append(side);
  panel.append(layout);
  return panel;
}

// ---------- Library ----------

function createMusicLabLibrary() {
  const state = musicLabGetState();
  const wrap = element("div", "music-library");
  const section = (title, id, items, empty, meta) => {
    const panel = musicLabPanel(title, id);
    if (items.length) {
      const row = element("div", "music-card-row is-compact");
      for (const item of items) row.append(musicLabCard({ href: musicLabHref(item), image: item.image, title: item.title, subtitle: item.subtitle, meta: meta?.(item), round: item.key.startsWith("person:") }));
      panel.append(row);
    } else {
      panel.append(musicLabEmpty(empty));
    }
    return panel;
  };
  const byUpdated = (a, b) => b.updatedAt.localeCompare(a.updatedAt);
  const rated = state.items.filter((item) => item.rating !== null).sort((a, b) => b.rating - a.rating || byUpdated(a, b));
  wrap.append(
    section("Ratings", "music-lib-ratings", rated, "Rate songs and albums out of 10 from their pages.", (item) => `${item.rating}/10 · ${item.key.startsWith("album:") ? "Album" : "Song"}`),
    section("Saved", "music-lib-saved", state.items.filter((item) => item.favorite).sort(byUpdated), "Save favorite songs and albums with ☆ Save.", (item) => item.key.startsWith("album:") ? "Album" : "Song"),
    section("Following", "music-lib-following", state.items.filter((item) => item.following).sort(byUpdated), "Follow producers and songwriters from their profiles."),
    section("Discoveries", "music-lib-discoveries", state.items.filter((item) => item.discoveredAt).sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt)), "Mark songs and albums as discovered to keep a timeline of new finds.", (item) => `Discovered ${new Date(item.discoveredAt).toLocaleDateString()}`)
  );
  const notes = musicLabPanel("Notes & reviews", "music-lib-notes");
  const noted = state.items.filter((item) => item.note).sort(byUpdated);
  if (noted.length) {
    const list = element("ul", "music-note-list");
    for (const item of noted) {
      const entry = element("li");
      entry.append(musicLabLink(item.title, musicLabHref(item), "music-credit-title"), element("small", "", ` ${item.subtitle || ""}${item.rating ? ` · ${item.rating}/10` : ""}`), element("p", "", item.note));
      list.append(entry);
    }
    notes.append(list);
  } else {
    notes.append(musicLabEmpty("Listening notes and reviews you write on profiles, songs and albums collect here."));
  }
  wrap.append(notes, createMusicLabLists(state));
  const corrections = musicLabPanel("Your credit additions", "music-lib-corrections");
  corrections.append(state.corrections.length ? createMusicLabCorrectionList(state.corrections, "", false) : musicLabEmpty("Credits you add on song pages, with their sources, are listed here."));
  wrap.append(corrections);
  const sync = element("p", "music-source", "Your library is saved in this browser and syncs to your account when you’re signed in. Recently explored pages sync along with your next library change.");
  wrap.append(sync);
  return wrap;
}

function createMusicLabLists(state) {
  const panel = musicLabPanel("Listening lists", "music-lib-lists");
  const form = element("form", "music-list-form");
  const name = document.createElement("input");
  name.id = "music-list-name";
  name.placeholder = "New list name, e.g. Summer production deep dive";
  name.maxLength = 80;
  name.setAttribute("aria-label", "New list name");
  const create = element("button", "", "Create list");
  create.type = "submit";
  const status = element("span", "music-status");
  status.setAttribute("role", "status");
  form.append(name, create, status);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = name.value.trim();
    if (!value) {
      status.textContent = "Give the list a name.";
      name.focus();
      return;
    }
    musicLabCommit((next, now) => {
      next.lists.push({ id: musicLabId("list"), name: value, description: "", items: [], createdAt: now, updatedAt: now });
    });
    musicLabRefresh("music-list-name");
  });
  panel.append(form);
  if (!state.lists.length) panel.append(musicLabEmpty("Make lists like “Albums to study” or “Tayla Parx essentials”, then add songs and albums from their pages."));
  for (const list of [...state.lists].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const box = element("article", "music-list");
    const head = element("header", "music-list-head");
    head.append(element("h4", "", list.name), element("small", "", `${list.items.length} item${list.items.length === 1 ? "" : "s"}`));
    const remove = element("button", "secondary", musicLabUi.status.deleteList === list.id ? "Confirm delete" : "Delete list");
    remove.type = "button";
    remove.id = `music-delete-${list.id}`;
    remove.addEventListener("click", () => {
      if (musicLabUi.status.deleteList !== list.id) {
        musicLabUi.status.deleteList = list.id;
        musicLabRefresh(remove.id);
        return;
      }
      musicLabUi.status.deleteList = "";
      musicLabCommit((next) => {
        next.lists = next.lists.filter((item) => item.id !== list.id);
        next.deletedListIds = [...new Set([...next.deletedListIds, list.id])];
      });
      musicLabRefresh("music-lib-lists");
    });
    head.append(remove);
    box.append(head);
    if (list.items.length) {
      const items = element("ol", "music-list-items");
      for (const entry of list.items) {
        const item = element("li");
        item.append(musicLabImage(entry.image, "", "music-list-cover", entry.key.startsWith("person:") ? musicLabInitials(entry.title) : "♪"),
          musicLabLink(entry.title, musicLabHref(entry), "music-credit-title"), element("small", "", entry.subtitle || ""));
        const drop = element("button", "secondary", "Remove");
        drop.type = "button";
        drop.setAttribute("aria-label", `Remove ${entry.title} from ${list.name}`);
        drop.addEventListener("click", () => {
          musicLabCommit((next, now) => {
            const target = next.lists.find((item2) => item2.id === list.id);
            if (target) {
              target.items = target.items.filter((item2) => item2.key !== entry.key);
              target.updatedAt = now;
            }
          });
          musicLabRefresh();
        });
        item.append(drop);
        items.append(item);
      }
      box.append(items);
    } else {
      box.append(musicLabEmpty("Empty. Use “Add to list” on a song or album page."));
    }
    panel.append(box);
  }
  return panel;
}

// ---------- Search ----------

function musicLabLocalSearch(query, snapshot) {
  const text = musicLabNormalizeName(query);
  if (!snapshot || text.length < 2) return { people: [], songs: [], albums: [], credits: [] };
  const words = text.split(" ");
  const hit = (value) => {
    const normalized = musicLabNormalizeName(value);
    return words.every((word) => normalized.includes(word));
  };
  const people = snapshot.people.filter((person) => person.mbid && [person.name, ...(person.aliases || [])].some(hit));
  const songs = Object.values(snapshot.recordings).filter((recording) => hit(`${recording.title} ${musicLabArtistLine(recording.artists)}`)).slice(0, 12);
  const albums = new Map();
  for (const recording of Object.values(snapshot.recordings)) {
    const group = recording.release?.group;
    if (group?.id && !albums.has(group.id) && hit(`${group.title} ${musicLabArtistLine(recording.artists)}`)) albums.set(group.id, recording);
  }
  const credits = [...snapshot.contributors].filter(([id, name]) => !snapshot.byId.has(id) && hit(name)).slice(0, 12)
    .map(([id, name]) => ({ id, name, songs: snapshot.songsByContributor.get(id)?.size || 0 }));
  return { people, songs, albums: [...albums.values()].slice(0, 8), credits };
}

function musicLabRunLiveSearch(query) {
  const key = query.toLowerCase();
  if (musicLabSearches.has(key)) return;
  const result = { status: "loading", artists: null, recordings: null, groups: null, error: "" };
  musicLabSearches.set(key, result);
  const escaped = query.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, " ").trim();
  const update = () => {
    if (location.hash === `#music/search/${encodeURIComponent(query)}`) musicLabRefresh();
  };
  (async () => {
    try {
      result.artists = (await musicLabMbFetch(`artist?query=${encodeURIComponent(escaped)}&limit=8`))?.artists || [];
      update();
      result.recordings = (await musicLabMbFetch(`recording?query=${encodeURIComponent(escaped)}&limit=10`))?.recordings || [];
      update();
      result.groups = (await musicLabMbFetch(`release-group?query=${encodeURIComponent(escaped)}&limit=8`))?.["release-groups"] || [];
      result.status = "done";
    } catch (error) {
      result.status = "error";
      result.error = error.message;
    }
    update();
  })();
}

function createMusicLabSearchView(query, snapshot) {
  const wrap = element("div", "music-search-results");
  if (!query) {
    wrap.append(musicLabEmpty("Search for a song, album, artist or credited producer and songwriter."));
    return wrap;
  }
  const local = musicLabLocalSearch(query, snapshot);
  const localPanel = musicLabPanel(`In Music Lab: “${query}”`, "music-search-local-title");
  const total = local.people.length + local.songs.length + local.albums.length + local.credits.length;
  if (!snapshot) localPanel.append(musicLabEmpty("The Music Lab snapshot isn’t available, so only MusicBrainz results are shown."));
  else if (!total) localPanel.append(musicLabEmpty("Nothing in the tracked credits matches. MusicBrainz results are below."));
  const group = (title, cards) => {
    if (!cards.length) return;
    localPanel.append(element("h4", "music-subhead", title));
    const row = element("div", "music-card-row is-compact");
    cards.forEach((card) => row.append(card));
    localPanel.append(row);
  };
  group("Producers & songwriters", local.people.map((person) => musicLabCard({ href: `#music/person/${person.mbid}`, image: person.photo?.url, title: person.name, subtitle: (person.aliases || []).slice(0, 2).join(", "), round: true })));
  group("Credited people", local.credits.map((credit) => musicLabCard({ href: `#music/person/${credit.id}`, title: credit.name, subtitle: `On ${credit.songs} tracked song${credit.songs === 1 ? "" : "s"}`, round: true })));
  group("Songs", local.songs.map((recording) => musicLabCard({ href: `#music/song/${recording.id}`, image: musicLabCover(recording.release), title: recording.title, subtitle: musicLabArtistLine(recording.artists), meta: musicLabFormatDate(recording.date) })));
  group("Albums", local.albums.map((recording) => musicLabCard({ href: `#music/album/${recording.release.id}`, image: musicLabCover(recording.release), title: recording.release.group.title, subtitle: musicLabArtistLine(recording.artists), meta: musicLabFormatDate(recording.release.date) })));
  wrap.append(localPanel);

  musicLabRunLiveSearch(query);
  const live = musicLabSearches.get(query.toLowerCase());
  const livePanel = musicLabPanel("From MusicBrainz", "music-search-live-title");
  livePanel.append(element("p", "music-hint", "Live results include every artist on MusicBrainz. Check the description to tell artists with the same name apart."));
  if (live.artists?.length) {
    livePanel.append(element("h4", "music-subhead", "Artists"));
    const list = element("ul", "music-result-list");
    for (const artist of live.artists) {
      const item = element("li");
      const link = musicLabLink("", `#music/person/${artist.id}`, "music-result");
      link.append(element("strong", "", artist.name), element("small", "", [artist.disambiguation, artist.type, artist.country || artist.area?.name, artist["life-span"]?.begin ? `since ${musicLabYear(artist["life-span"].begin)}` : ""].filter(Boolean).join(" · ") || "No description on MusicBrainz"));
      item.append(link);
      list.append(item);
    }
    livePanel.append(list);
  }
  if (live.recordings?.length) {
    livePanel.append(element("h4", "music-subhead", "Songs"));
    const list = element("ul", "music-result-list");
    for (const recording of live.recordings) {
      const item = element("li");
      const link = musicLabLink("", `#music/song/${recording.id}`, "music-result");
      const release = recording.releases?.[0];
      link.append(element("strong", "", recording.title), element("small", "", [musicLabArtistLine((recording["artist-credit"] || []).map((credit) => ({ name: credit.name, join: credit.joinphrase || "" }))), release?.title, musicLabYear(recording["first-release-date"]), recording.disambiguation].filter(Boolean).join(" · ")));
      item.append(link);
      list.append(item);
    }
    livePanel.append(list);
  }
  if (live.groups?.length) {
    livePanel.append(element("h4", "music-subhead", "Albums"));
    const row = element("div", "music-card-row is-compact");
    for (const groupItem of live.groups) {
      row.append(musicLabCard({ href: `#music/group/${groupItem.id}`, image: `https://coverartarchive.org/release-group/${groupItem.id}/front-250`, title: groupItem.title,
        subtitle: musicLabArtistLine((groupItem["artist-credit"] || []).map((credit) => ({ name: credit.name, join: credit.joinphrase || "" }))), meta: [groupItem["primary-type"], musicLabYear(groupItem["first-release-date"])].filter(Boolean).join(" · ") }));
    }
    livePanel.append(row);
  }
  if (live.status === "loading") livePanel.append(musicLabLoading("Searching MusicBrainz (one request per second)…"));
  if (live.status === "error") livePanel.append(musicLabError(live.error, () => { musicLabSearches.delete(query.toLowerCase()); musicLabRefresh(); }));
  if (live.status === "done" && !live.artists?.length && !live.recordings?.length && !live.groups?.length) livePanel.append(musicLabEmpty("MusicBrainz has no matches."));
  wrap.append(livePanel);
  return wrap;
}
