// K-pop idol database (#kpop/idols, #kpop/idol/Q…, #kpop/group/Q…), built from data/idols/ (see scripts/build_idols.py).
// Loaded on first visit. Profile facts come from Wikidata, bios from Wikipedia (credited), photos from Wikimedia Commons;
// your own fixes (idols-data.js) show on top and can be copied into data/idols/overrides.json.

const idolsCache = new Map();
function idolsFetch(path) {
  if (!idolsCache.has(path)) {
    idolsCache.set(path, fetch(new URL(path, location.href)).then((response) => {
      if (!response.ok) throw new Error(`${path} request failed (${response.status}).`);
      return response.json();
    }).catch((error) => { idolsCache.delete(path); throw error; }));
  }
  return idolsCache.get(path);
}
const idolsIndex = () => idolsFetch("data/idols/index.json");
const idolsGroups = () => idolsFetch("data/idols/groups.json").then((data) => data.groups || {});
async function idolsPerson(id) {
  const index = await idolsIndex();
  const shard = String(Number(id.slice(1)) % (index.shards || 64)).padStart(2, "0");
  return (await idolsFetch(`data/idols/people/${shard}.json`)).people?.[id] || null;
}

function idolsFold(value) {
  return String(value || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function idolsSafeUrl(value, hosts) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (!hosts || hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) ? url.href : "";
  } catch {
    return "";
  }
}

function idolsToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function idolsAge(birth, death = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth || "")) return null;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(death || "") ? death : idolsToday();
  let age = Number(end.slice(0, 4)) - Number(birth.slice(0, 4));
  if (end.slice(5) < birth.slice(5)) age--;
  return age >= 0 && age < 120 ? age : null;
}

function idolsDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  if (/^\d{4}-\d{2}$/.test(value || "")) return new Date(`${value}-01T12:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "long" });
  return value || "";
}

function idolsYears(start, end) {
  const from = (start || "").slice(0, 4);
  const to = (end || "").slice(0, 4);
  if (!from && !to) return "";
  return to ? `${from || "?"}–${to}` : `${from}–present`;
}

// Days until the next birthday (0 = today), or null.
function idolsBirthdayIn(birth, today = idolsToday()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth || "")) return null;
  const year = Number(today.slice(0, 4));
  const base = new Date(`${today}T12:00:00`);
  for (const candidate of [year, year + 1]) {
    const date = new Date(`${candidate}-${birth.slice(5)}T12:00:00`);
    if (date.getMonth() + 1 !== Number(birth.slice(5, 7))) continue; // Feb 29 in a non-leap year
    const days = Math.round((date - base) / 86400000);
    if (days >= 0) return days;
  }
  return null;
}

function idolsPhoto(url, name, className = "idol-photo") {
  const safe = idolsSafeUrl(url, ["upload.wikimedia.org"]);
  const initials = (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => [...part][0]).join("").toUpperCase();
  const box = element("span", `${className} idol-initials`, initials);
  box.setAttribute("aria-hidden", "true");
  if (safe) {
    const image = element("img", className);
    image.src = safe;
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.replaceWith(box), { once: true });
    return image;
  }
  return box;
}

// Your edits over the published record.
function idolsWithEdits(record, kind) {
  const edit = typeof idolEditFor === "function" ? idolEditFor(record.id) : null;
  if (!edit || edit.kind !== kind) return { ...record, mine: [] };
  return { ...record, ...edit.fields, mine: Object.keys(edit.fields) };
}

// ---------- K-pop calendar, follows and tours ----------

let idolsCalendarPromise = null;
function idolsCalendar() {
  idolsCalendarPromise ||= idolsFetch("data/kpop-sidebar.json").then((data) => {
    const calendar = data.calendar || {};
    const days = new Map((calendar.dateTerms || []).map((term) => [term.id, Number(term.name)]));
    const decoder = document.createElement("textarea");
    const releases = [];
    for (const period of calendar.periods || []) {
      for (const item of period.releases || []) {
        const day = days.get(item["calendar-date"]?.[0]);
        if (!Number.isInteger(day) || !Number.isInteger(period.year) || !Number.isInteger(period.month)) continue;
        decoder.innerHTML = item.title?.rendered || "";
        const url = idolsSafeUrl(item.link, ["kpopofficial.com"]);
        releases.push({ date: `${period.year}-${String(period.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, title: decoder.value.trim(), url,
          artists: [...(item.group || []).map((id) => ({ taxonomy: "group", id })), ...(item.artist_solo || []).map((id) => ({ taxonomy: "artist_solo", id }))] });
      }
    }
    return { releases, names: Array.isArray(calendar.names) ? calendar.names : [] };
  }).catch((error) => { idolsCalendarPromise = null; throw error; });
  return idolsCalendarPromise;
}

function idolsNameMatches(text, names) {
  const folded = idolsFold(text);
  return names.some((name) => {
    const target = idolsFold(name).trim();
    if (target.length < 2) return false;
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(folded);
  });
}

// The KPOP OFFICIAL artist entry with this name, so the Follow button uses your existing K-pop follows.
function idolsCalendarArtist(names, calendar) {
  const wanted = new Set(names.map((name) => idolsFold(name).trim()).filter(Boolean));
  return calendar.names.find((artist) => wanted.has(idolsFold(artist.name).replace(/\s*\(.*\)$/, "").trim())) || null;
}

function idolsUpcomingSection(names) {
  const section = element("section", "idol-section");
  section.append(element("h3", "", "Upcoming releases"));
  const body = element("div");
  body.append(element("p", "idol-muted", "Checking the K-pop release calendar…"));
  section.append(body);
  idolsCalendar().then(({ releases, names: calendarNames }) => {
    const artist = idolsCalendarArtist(names, { names: calendarNames });
    const today = idolsToday();
    const found = releases.filter((release) => release.date >= today &&
      ((artist && release.artists.some((item) => item.taxonomy === artist.taxonomy && item.id === artist.id)) || idolsNameMatches(release.title, names)))
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
    body.replaceChildren();
    if (!found.length) {
      body.append(element("p", "idol-muted", "Nothing dated on the KPOP OFFICIAL calendar for the next few months."));
      return;
    }
    const list = element("ul", "idol-list");
    for (const release of found) {
      const item = element("li");
      const link = element(release.url ? "a" : "span", "", release.title);
      if (release.url) {
        link.href = release.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      item.append(link, element("small", "", ` · ${idolsDate(release.date)}`));
      list.append(item);
    }
    body.append(list);
  }).catch(() => body.replaceChildren(element("p", "idol-muted", "The release calendar is unavailable right now.")));
  return section;
}

function idolsFollowButton(names) {
  const button = element("button", "secondary", "Follow");
  button.type = "button";
  button.hidden = true;
  idolsCalendar().then(({ names: calendarNames }) => {
    const artist = idolsCalendarArtist(names, { names: calendarNames });
    if (!artist || typeof setKpopFollow !== "function") return;
    const update = () => {
      const followed = kpopArtistFollows.some((item) => item.followed && item.taxonomy === artist.taxonomy && item.id === artist.id);
      button.textContent = followed ? "Following ✓" : "Follow";
      button.setAttribute("aria-pressed", String(followed));
      button.title = followed ? "Releases show on the K-Pop channel and in This week" : "Follow on the K-Pop channel to see releases in This week";
    };
    button.addEventListener("click", () => {
      const followed = button.getAttribute("aria-pressed") === "true";
      if (setKpopFollow({ taxonomy: artist.taxonomy, id: artist.id, name: artist.name }, !followed)) update();
    });
    update();
    button.hidden = false;
  }).catch(() => {});
  return button;
}

function idolsToursSection(name) {
  const section = element("section", "idol-section");
  section.append(element("h3", "", "Tour dates"));
  const body = element("div");
  section.append(body);
  if (typeof liveLocal !== "function" || !liveLocal().ticketmasterKey) {
    const link = element("a", "", "Add your Ticketmaster key in Live Events settings");
    link.href = "#live/settings";
    const note = element("p", "idol-muted", "Concert dates come from Ticketmaster. ");
    note.append(link, " to see them here.");
    body.append(note);
    return section;
  }
  body.append(element("p", "idol-muted", "Checking Ticketmaster…"));
  liveSearchAttractions(name).then(async (attractions) => {
    const match = attractions.find((item) => idolsFold(item.name) === idolsFold(name));
    if (!match) { body.replaceChildren(element("p", "idol-muted", "Not found on Ticketmaster.")); return; }
    const { events } = await liveSearchEvents({ attractionId: match.tmId, size: 8 });
    body.replaceChildren();
    if (!events.length) { body.append(element("p", "idol-muted", "No upcoming shows on Ticketmaster.")); return; }
    const list = element("ul", "idol-list");
    for (const event of events.slice(0, 8)) {
      const item = element("li");
      const link = element("a", "", [event.venue.name, event.venue.city].filter(Boolean).join(", ") || event.name);
      link.href = `#live/event/${event.id}`;
      item.append(link, element("small", "", ` · ${idolsDate(event.date)}`));
      list.append(item);
    }
    body.append(list);
  }).catch((error) => body.replaceChildren(element("p", "idol-muted", error.message || "Ticketmaster is unavailable right now.")));
  return section;
}

// Discography from MusicBrainz (live, cached for the visit). Links open the credits in Music Lab.
const idolsDiscographyCache = new Map();
function idolsDiscographySection(musicbrainzUrl) {
  const mbid = /musicbrainz\.org\/artist\/([0-9a-f-]{36})/.exec(musicbrainzUrl || "")?.[1];
  if (!mbid) return null;
  const section = element("section", "idol-section");
  section.append(element("h3", "", "Discography"));
  const body = element("div");
  body.append(element("p", "idol-muted", "Loading from MusicBrainz…"));
  section.append(body);
  if (!idolsDiscographyCache.has(mbid)) {
    idolsDiscographyCache.set(mbid, fetch(`https://musicbrainz.org/ws/2/release-group?${new URLSearchParams({ artist: mbid, type: "album|ep|single", limit: "100", fmt: "json" })}`, { headers: { Accept: "application/json" } })
      .then((response) => { if (!response.ok) throw new Error(`MusicBrainz request failed (${response.status}).`); return response.json(); })
      .catch((error) => { idolsDiscographyCache.delete(mbid); throw error; }));
  }
  idolsDiscographyCache.get(mbid).then((data) => {
    const groups = (data["release-groups"] || []).filter((item) => item.id && item.title && !(item["secondary-types"] || []).some((type) => ["Live", "Compilation", "Remix", "DJ-mix"].includes(type)))
      .sort((a, b) => (b["first-release-date"] || "").localeCompare(a["first-release-date"] || ""));
    body.replaceChildren();
    if (!groups.length) { body.append(element("p", "idol-muted", "No releases listed on MusicBrainz yet.")); return; }
    const filters = element("div", "idol-chips");
    const list = element("ul", "idol-discography");
    let type = "all";
    const draw = () => {
      list.replaceChildren();
      for (const item of groups.filter((entry) => type === "all" || entry["primary-type"] === type).slice(0, 40)) {
        const li = element("li");
        const link = element("a", "", item.title);
        link.href = `#music/group/${item.id}`;
        link.title = "Open credits in Music Lab";
        li.append(link, element("small", "", [item["primary-type"], (item["first-release-date"] || "").slice(0, 4)].filter(Boolean).join(" · ")));
        list.append(li);
      }
    };
    for (const [value, text] of [["all", "All"], ["Album", "Albums"], ["EP", "EPs"], ["Single", "Singles"]]) {
      if (value !== "all" && !groups.some((entry) => entry["primary-type"] === value)) continue;
      const chip = element("button", value === "all" ? "" : "secondary", text);
      chip.type = "button";
      chip.addEventListener("click", () => {
        type = value;
        filters.querySelectorAll("button").forEach((button) => { button.className = button === chip ? "" : "secondary"; });
        draw();
      });
      filters.append(chip);
    }
    draw();
    const credit = element("p", "idol-muted");
    const source = element("a", "", "MusicBrainz");
    source.href = `https://musicbrainz.org/artist/${mbid}/releases`;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    credit.append("From ", source, ". Open a release for its songwriting and production credits.");
    body.append(filters, list, credit);
  }).catch(() => body.replaceChildren(element("p", "idol-muted", "MusicBrainz is unavailable right now.")));
  return section;
}

// ---------- shared profile pieces ----------

function idolsFacts(rows) {
  const list = element("dl", "idol-facts");
  for (const [term, value, mine] of rows) {
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) continue;
    const dt = element("dt", "", term);
    const dd = element("dd");
    if (value instanceof Node) dd.append(value);
    else dd.textContent = Array.isArray(value) ? value.join(", ") : String(value);
    if (mine) dd.append(element("span", "idol-mine", "your edit"));
    list.append(dt, dd);
  }
  return list;
}

function idolsLinks(links) {
  const labels = { website: "Official site", instagram: "Instagram", x: "X", youtube: "YouTube", tiktok: "TikTok", spotify: "Spotify", musicbrainz: "MusicBrainz" };
  const row = element("div", "idol-links");
  for (const [key, text] of Object.entries(labels)) {
    const url = idolsSafeUrl(links?.[key]);
    if (!url) continue;
    const link = element("a", "idol-link", text);
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    row.append(link);
  }
  return row.childElementCount ? row : null;
}

function idolsBio(record) {
  if (!record.bio?.text) return null;
  const section = element("section", "idol-section");
  section.append(element("p", "idol-bio", record.bio.text));
  const credit = element("p", "idol-muted");
  const source = element("a", "", `Wikipedia: ${record.bio.title}`);
  source.href = idolsSafeUrl(record.bio.url, ["en.wikipedia.org"]) || "https://en.wikipedia.org/";
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  const license = element("a", "", "CC BY-SA 4.0");
  license.href = "https://creativecommons.org/licenses/by-sa/4.0/";
  license.target = "_blank";
  license.rel = "noopener noreferrer";
  credit.append("From ", source, " (", license, ").");
  section.append(credit);
  return section;
}

function idolsHero(record, subtitleParts, extraButtons) {
  const hero = element("div", "idol-hero");
  const figure = element("figure", "idol-hero-photo");
  figure.append(idolsPhoto(record.photo?.url, record.name, "idol-photo-large"));
  if (record.photo?.page) {
    const credit = element("figcaption");
    const link = element("a", "", [record.photo.author, record.photo.license].filter(Boolean).join(" · ") || "Wikimedia Commons");
    link.href = idolsSafeUrl(record.photo.page, ["commons.wikimedia.org", "wikimedia.org"]) || "https://commons.wikimedia.org/";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = "Photo on Wikimedia Commons";
    credit.append("Photo: ", link);
    figure.append(credit);
  }
  const text = element("div", "idol-hero-text");
  const title = element("h2", "", record.name);
  title.id = "idol-title";
  text.append(title);
  if (record.ko) text.append(element("p", "idol-hangul", record.ko));
  const subtitle = subtitleParts.filter(Boolean).join(" · ");
  if (subtitle) text.append(element("p", "idol-subtitle", subtitle));
  const actions = element("div", "idol-actions");
  actions.append(...extraButtons.filter(Boolean));
  text.append(actions);
  hero.append(figure, text);
  return hero;
}

function idolsEditor(record, kind, onSaved) {
  const box = element("details", "idol-editor");
  box.append(element("summary", "", "Add info or fix something"));
  const form = element("form", "idol-editor-form");
  const edit = idolEditFor(record.id);
  const inputs = {};
  for (const [field, rule] of Object.entries(idolEditFields)) {
    if (kind === "group" && ["mbti", "height", "positions"].includes(field)) continue;
    if (kind === "person" && field === "fandom") continue;
    const label = element("label", "field", rule.label);
    const input = element(rule.multiline ? "textarea" : "input");
    if (!rule.multiline) input.type = rule.number ? "number" : "text";
    const current = edit?.fields[field] ?? record[field];
    input.value = Array.isArray(current) ? current.join(", ") : current ?? "";
    if (rule.hint) input.placeholder = rule.hint;
    if (field === "mbti") input.placeholder = "e.g. ENFP";
    inputs[field] = input;
    label.append(input);
    form.append(label);
  }
  const status = element("p", "idol-muted");
  status.setAttribute("role", "status");
  const save = element("button", "", "Save");
  save.type = "submit";
  const reset = element("button", "secondary", "Clear my edits");
  reset.type = "button";
  reset.hidden = !edit || !Object.keys(edit.fields).length;
  form.append(save, reset, status, element("p", "idol-muted", "Saved to your account. Use “Copy as overrides” on the idol directory to add your fixes to the published data."));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const fields = {};
    const rejected = [];
    for (const [field, input] of Object.entries(inputs)) {
      const raw = input.value.trim();
      const original = record[field];
      const originalText = Array.isArray(original) ? original.join(", ") : original ?? "";
      if (!raw || raw === String(originalText)) continue;
      const value = idolNormalizeValue(field, raw);
      if (value === undefined) rejected.push(idolEditFields[field].label);
      else fields[field] = value;
    }
    if (rejected.length) { status.textContent = `Check ${rejected.join(" and ")}.`; return; }
    if (idolSaveEdit(record.id, kind, record.name, fields)) onSaved();
  });
  reset.addEventListener("click", () => { if (idolSaveEdit(record.id, kind, record.name, {})) onSaved(); });
  box.append(form);
  return box;
}

function idolsBack() {
  const link = element("a", "idol-back", "← Idol directory");
  link.href = "#kpop/idols";
  return link;
}

// ---------- pages ----------

async function idolsPersonPage(container, id) {
  const [person, index, groups] = await Promise.all([idolsPerson(id), idolsIndex(), idolsGroups()]);
  if (!person) { container.replaceChildren(idolsBack(), element("p", "", "This idol isn’t in the database.")); return; }
  const record = idolsWithEdits(person, "person");
  const mine = new Set(record.mine);
  const age = idolsAge(record.birth, record.death);
  const currentGroups = record.groups.filter((group) => !group.end);
  const birthday = idolsBirthdayIn(record.birth);
  const page = element("article", "idol-page");
  page.setAttribute("aria-labelledby", "idol-title");
  const names = [record.name, ...record.aliases.filter((alias) => alias.length > 2)];
  const groupNames = currentGroups.map((group) => group.name);
  page.append(idolsBack(), idolsHero(record, [
    groupNames.length ? groupNames.join(", ") : record.groups.length ? "Former group member" : "Soloist",
    age !== null && !record.death ? `${age} years old` : "",
    birthday === 0 ? "🎂 Birthday today" : birthday !== null && birthday <= 7 ? `🎂 Birthday in ${birthday} day${birthday === 1 ? "" : "s"}` : ""
  ], [record.groups.length ? null : idolsFollowButton(names)]));

  const groupList = element("ul", "idol-timeline");
  for (const membership of record.groups) {
    const item = element("li", membership.end ? "is-former" : "");
    const link = element("a", "", membership.name);
    link.href = `#kpop/group/${membership.id}`;
    item.append(link, element("small", "", idolsYears(membership.start, membership.end)));
    groupList.append(item);
  }
  const agencies = record.agencies.filter((agency) => !agency.end).map((agency) => agency.name);
  page.append(idolsFacts([
    ["Birth name", [record.birthName, record.birthNameEn && record.birthNameEn !== record.birthName ? record.birthNameEn : ""].filter(Boolean).join(" · ")],
    ["Born", [idolsDate(record.birth), record.birthplace].filter(Boolean).join(", ")],
    ["Died", record.death ? idolsDate(record.death) : ""],
    ["Nationality", record.nationality],
    ["Positions", record.positions, mine.has("positions")],
    ["Height", record.height ? `${record.height} cm` : "", mine.has("height")],
    ["MBTI", record.mbti, mine.has("mbti")],
    ["Occupation", record.occupations],
    ["Debut", idolsDate(record.debut)],
    ["Agency", agencies.length ? agencies : record.agencies.map((agency) => agency.name).slice(-1)],
    ["Groups", record.groups.length ? groupList : ""],
    ["Your note", record.note, mine.has("note")]
  ]));
  const linkRow = idolsLinks(record.links);
  if (linkRow) page.append(linkRow);
  const bio = idolsBio(record);
  if (bio) page.append(bio);
  const grid = element("div", "idol-columns");
  grid.append(idolsUpcomingSection([...names, ...groupNames.map((group) => `${group} ${record.name}`)]));
  if (!record.groups.length || !currentGroups.length) grid.append(idolsToursSection(record.name));
  page.append(grid);
  const discography = idolsDiscographySection(record.links?.musicbrainz);
  if (discography) page.append(discography);
  // Bandmates
  const mates = currentGroups.flatMap((group) => (groups[group.id]?.members || []).filter((member) => !member.end && member.id !== record.id).map((member) => member.id));
  if (mates.length) {
    const section = element("section", "idol-section");
    section.append(element("h3", "", currentGroups.length === 1 ? `Also in ${currentGroups[0].name}` : "Bandmates"));
    const byId = new Map(index.people.map((row) => [row.id, row]));
    section.append(idolsCardGrid([...new Set(mates)].map((mate) => byId.get(mate)).filter(Boolean), index, "person"));
    page.append(section);
  }
  page.append(idolsEditor(person, "person", () => idolsRender(container, `idol/${id}`)));
  container.replaceChildren(page);
}

async function idolsGroupPage(container, id) {
  const [groups, index] = await Promise.all([idolsGroups(), idolsIndex()]);
  const group = groups[id];
  if (!group) { container.replaceChildren(idolsBack(), element("p", "", "This group isn’t in the database.")); return; }
  const record = idolsWithEdits(group, "group");
  const mine = new Set(record.mine);
  const page = element("article", "idol-page");
  page.setAttribute("aria-labelledby", "idol-title");
  const current = record.members.filter((member) => !member.end);
  const former = record.members.filter((member) => member.end);
  const names = [record.name, ...record.aliases.filter((alias) => alias.length > 2)];
  page.append(idolsBack(), idolsHero(record, [
    record.disbanded ? `Active ${idolsYears(record.debut, record.disbanded)}` : record.debut ? `Debuted ${idolsDate(record.debut)}` : "",
    current.length ? `${current.length} member${current.length === 1 ? "" : "s"}` : ""
  ], [idolsFollowButton(names)]));
  const agencies = record.agencies.filter((agency) => !agency.end).map((agency) => agency.name);
  const parentLinks = element("span");
  record.parents.forEach((parent, position) => {
    const link = element("a", "", parent.name);
    link.href = `#kpop/group/${parent.id}`;
    parentLinks.append(...(position ? [", "] : []), link);
  });
  const subunitLinks = element("span");
  record.subunits.forEach((unit, position) => {
    const link = element("a", "", unit.name);
    link.href = `#kpop/group/${unit.id}`;
    subunitLinks.append(...(position ? [", "] : []), link);
  });
  page.append(idolsFacts([
    ["Debut", idolsDate(record.debut)],
    ["Disbanded", idolsDate(record.disbanded)],
    ["Fandom", record.fandom, mine.has("fandom")],
    ["Agency", agencies.length ? agencies : record.agencies.map((agency) => agency.name).slice(-1)],
    ["Former agencies", record.agencies.filter((agency) => agency.end).map((agency) => `${agency.name} (${idolsYears(agency.start, agency.end)})`)],
    ["Country", record.country],
    ["Part of", record.parents.length ? parentLinks : ""],
    ["Sub-units", record.subunits.length ? subunitLinks : ""],
    ["Your note", record.note, mine.has("note")]
  ]));
  const linkRow = idolsLinks(record.links);
  if (linkRow) page.append(linkRow);
  const byId = new Map(index.people.map((row) => [row.id, row]));
  for (const [title, list] of [["Members", current], ["Former members", former]]) {
    if (!list.length) continue;
    const section = element("section", "idol-section");
    section.append(element("h3", "", title));
    section.append(idolsCardGrid(list.map((member) => ({ ...(byId.get(member.id) || { id: member.id, n: member.name, g: [] }), years: idolsYears(member.start || (member.end ? "" : record.debut), member.end) || "Member" })), index, "person"));
    page.append(section);
  }
  if (record.members.some((member) => member.start || member.end)) page.append(idolsLineupTimeline(record));
  const bio = idolsBio(record);
  if (bio) page.append(bio);
  const grid = element("div", "idol-columns");
  grid.append(idolsUpcomingSection(names), idolsToursSection(record.name));
  page.append(grid);
  const discography = idolsDiscographySection(record.links?.musicbrainz);
  if (discography) page.append(discography);
  page.append(idolsEditor(group, "group", () => idolsRender(container, `group/${id}`)));
  container.replaceChildren(page);
}

// Lineup over the years: one bar per member from their start year to their end year (or now).
function idolsLineupTimeline(record) {
  const section = element("section", "idol-section");
  section.append(element("h3", "", "Lineup over time"));
  const thisYear = new Date().getFullYear();
  const startOf = (member) => Number((member.start || record.debut || "").slice(0, 4)) || null;
  const endOf = (member) => Number((member.end || record.disbanded || "").slice(0, 4)) || thisYear;
  const members = record.members.filter((member) => startOf(member));
  if (!members.length) return element("span");
  const first = Math.min(...members.map(startOf), Number((record.debut || "").slice(0, 4)) || thisYear);
  const last = Math.max(...members.map(endOf), thisYear);
  const span = Math.max(1, last - first + 1);
  const chart = element("div", "idol-lineup");
  chart.setAttribute("role", "list");
  for (const member of members) {
    const row = element("div", "idol-lineup-row");
    row.setAttribute("role", "listitem");
    const name = element("a", "idol-lineup-name", member.name);
    name.href = `#kpop/idol/${member.id}`;
    const track = element("span", "idol-lineup-track");
    const bar = element("span", `idol-lineup-bar${member.end ? " is-former" : ""}`);
    bar.style.left = `${((startOf(member) - first) / span) * 100}%`;
    bar.style.width = `${(Math.max(1, endOf(member) - startOf(member) + 1) / span) * 100}%`;
    bar.title = `${member.name}: ${idolsYears(member.start || record.debut, member.end)}`;
    track.append(bar);
    row.append(name, track, element("small", "", idolsYears(member.start || record.debut, member.end)));
    chart.append(row);
  }
  const axis = element("div", "idol-lineup-axis");
  axis.append(element("span", "", String(first)), element("span", "", String(last)));
  section.append(chart, axis);
  return section;
}

function idolsCardGrid(rows, index, kind) {
  const groupsById = new Map(index.groups.map((group) => [group.id, group]));
  const list = element("ul", "idol-grid");
  for (const row of rows) {
    const item = element("li");
    const link = element("a", "idol-card");
    link.href = `#kpop/${kind === "group" ? "group" : "idol"}/${row.id}`;
    link.append(idolsPhoto(row.p, row.n));
    const body = element("span", "idol-card-body");
    body.append(element("strong", "", row.n));
    if (row.k) body.append(element("small", "idol-hangul-small", row.k));
    if (kind === "group") {
      body.append(element("small", "", [row.d ? `Debut ${row.d.slice(0, 4)}` : "", row.x ? "Disbanded" : row.m ? `${row.m} members` : "", ...(row.ag || []).slice(0, 1)].filter(Boolean).join(" · ")));
    } else {
      const groupNames = (row.g || []).map((id) => groupsById.get(id)?.n).filter(Boolean);
      const age = idolsAge(row.b);
      body.append(element("small", "", [row.years || groupNames.slice(0, 2).join(", ") || "Soloist", age !== null ? `${age}` : ""].filter(Boolean).join(" · ")));
    }
    link.append(body);
    item.append(link);
    list.append(item);
  }
  return list;
}

// ---------- directory ----------

const idolsDirectory = { query: "", mode: "people", group: "", agency: "", month: "", debut: "", status: "", shown: 60 };

function idolsFilter(index) {
  const state = idolsDirectory;
  const words = idolsFold(state.query).split(/\s+/).filter(Boolean);
  const groupsById = new Map(index.groups.map((group) => [group.id, group]));
  const matchText = (row, extra = []) => {
    if (!words.length) return true;
    const text = idolsFold([row.n, row.k, ...(row.a || []), ...extra].join(" "));
    return words.every((word) => text.includes(word));
  };
  if (state.mode === "groups") {
    return index.groups.filter((row) => matchText(row, row.ag || []) &&
      (!state.agency || (row.ag || []).includes(state.agency)) &&
      (!state.debut || (row.d || "").startsWith(state.debut.slice(0, 3))) &&
      (!state.status || (state.status === "active" ? !row.x : row.x)));
  }
  return index.people.filter((row) => {
    const groups = (row.g || []).map((id) => groupsById.get(id)).filter(Boolean);
    return matchText(row, groups.map((group) => group.n)) &&
      (!state.group || (row.g || []).includes(state.group)) &&
      (!state.agency || groups.some((group) => (group.ag || []).includes(state.agency))) &&
      (!state.month || (row.b || "").slice(5, 7) === state.month) &&
      (!state.debut || groups.some((group) => (group.d || "").startsWith(state.debut.slice(0, 3)))) &&
      (!state.status || (state.status === "soloist" ? !groups.length : groups.length));
  });
}

function idolsDirectoryPage(container, index) {
  const state = idolsDirectory;
  const page = element("section", "idol-directory");
  page.setAttribute("aria-labelledby", "idol-directory-title");
  const head = element("div", "idol-directory-head");
  const titleBlock = element("div");
  const title = element("h2", "", "Idol directory");
  title.id = "idol-directory-title";
  titleBlock.append(title, element("p", "idol-muted", `${index.people.length.toLocaleString()} idols and ${index.groups.length.toLocaleString()} groups from Wikidata, refreshed ${new Date(index.generatedAt).toLocaleDateString()}.`));
  const back = element("a", "idol-back", "← K-Pop channel");
  back.href = "#kpop";
  head.append(titleBlock, back);
  page.append(head);

  // Birthdays in the next 7 days, for idols in active groups or with a photo (so it isn't a wall of unknowns).
  const groupsById = new Map(index.groups.map((group) => [group.id, group]));
  const soon = index.people.map((row) => ({ row, days: idolsBirthdayIn(row.b) }))
    .filter(({ row, days }) => days !== null && days <= 7 && ((row.g || []).some((id) => groupsById.get(id) && !groupsById.get(id).x) || row.p))
    .sort((a, b) => a.days - b.days || a.row.n.localeCompare(b.row.n)).slice(0, 16);
  if (soon.length) {
    const strip = element("section", "idol-birthdays");
    strip.append(element("h3", "", "🎂 Birthdays this week"));
    const list = element("ul");
    for (const { row, days } of soon) {
      const item = element("li");
      const link = element("a", "");
      link.href = `#kpop/idol/${row.id}`;
      link.append(idolsPhoto(row.p, row.n, "idol-photo-small"));
      const groupName = (row.g || []).map((id) => groupsById.get(id)?.n).filter(Boolean)[0];
      const text = element("span");
      text.append(element("strong", "", row.n), element("small", "", [groupName, days === 0 ? "Today" : days === 1 ? "Tomorrow" : new Date(`${new Date().getFullYear() + (row.b.slice(5) < idolsToday().slice(5) ? 1 : 0)}-${row.b.slice(5)}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })].filter(Boolean).join(" · ")));
      link.append(text);
      item.append(link);
      list.append(item);
    }
    strip.append(list);
    page.append(strip);
  }

  const controls = element("form", "idol-controls");
  controls.addEventListener("submit", (event) => event.preventDefault());
  const search = element("input");
  search.type = "search";
  search.placeholder = "Search by name, Hangul or group";
  search.setAttribute("aria-label", "Search idols and groups");
  search.value = state.query;
  const select = (label, value, options) => {
    const wrap = element("label", "field idol-filter", label);
    const input = element("select");
    for (const [optionValue, text] of options) {
      const option = element("option", "", text);
      option.value = optionValue;
      option.selected = optionValue === value;
      input.append(option);
    }
    wrap.append(input);
    return [wrap, input];
  };
  const [modeWrap, mode] = select("Show", state.mode, [["people", "Idols"], ["groups", "Groups"]]);
  const agencies = [...new Set(index.groups.flatMap((group) => group.ag || []))].sort((a, b) => a.localeCompare(b));
  const [agencyWrap, agency] = select("Agency", state.agency, [["", "Any agency"], ...agencies.map((name) => [name, name])]);
  const decades = [...new Set(index.groups.map((group) => (group.d || "").slice(0, 3)).filter((value) => /^\d{3}$/.test(value)))].sort().reverse();
  const [debutWrap, debut] = select("Group debut", state.debut, [["", "Any time"], ...decades.map((decade) => [`${decade}0`, `${decade}0s`])]);
  const months = Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, "0"), new Date(2000, i, 1).toLocaleDateString(undefined, { month: "long" })]);
  const [monthWrap, month] = select("Birthday", state.month, [["", "Any month"], ...months]);
  const [statusWrap, status] = select("Status", state.status, state.mode === "groups" ? [["", "Active and disbanded"], ["active", "Active"], ["disbanded", "Disbanded"]] : [["", "Everyone"], ["member", "Group members"], ["soloist", "Soloists"]]);
  monthWrap.hidden = state.mode === "groups";
  const searchWrap = element("label", "field idol-search", "Search");
  searchWrap.append(search);
  controls.append(searchWrap, modeWrap, agencyWrap, debutWrap, monthWrap, statusWrap);
  page.append(controls);

  const summary = element("p", "idol-muted");
  summary.setAttribute("role", "status");
  const results = element("div");
  const more = element("button", "secondary", "Show more");
  more.type = "button";
  page.append(summary, results, more);

  const draw = () => {
    const found = idolsFilter(index);
    summary.textContent = `${found.length.toLocaleString()} ${state.mode === "groups" ? "group" : "idol"}${found.length === 1 ? "" : "s"}${state.query ? ` matching “${state.query}”` : ""}`;
    results.replaceChildren(idolsCardGrid(found.slice(0, state.shown), index, state.mode === "groups" ? "group" : "person"));
    more.hidden = found.length <= state.shown;
  };
  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.query = search.value.trim(); state.shown = 60; draw(); }, 150);
  });
  for (const [input, key] of [[agency, "agency"], [debut, "debut"], [month, "month"], [status, "status"]]) {
    input.addEventListener("change", () => { state[key] = input.value; state.shown = 60; draw(); });
  }
  mode.addEventListener("change", () => { state.mode = mode.value; state.status = ""; state.shown = 60; idolsDirectoryPage(container, index); });
  more.addEventListener("click", () => { state.shown += 60; draw(); });
  draw();

  // Your fixes, ready to paste into data/idols/overrides.json.
  const edits = idolOverridesExport();
  const count = Object.keys(edits.groups).length + Object.keys(edits.people).length;
  if (count) {
    const box = element("section", "idol-section idol-export");
    box.append(element("h3", "", "Your fixes"));
    box.append(element("p", "idol-muted", `You’ve added info to ${count} profile${count === 1 ? "" : "s"}. To publish them for everyone, copy them into data/idols/overrides.json in the repository (merge with what’s there).`));
    const copy = element("button", "secondary", "Copy as overrides");
    copy.type = "button";
    const done = element("span", "idol-muted");
    done.setAttribute("role", "status");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(edits, null, 2));
        done.textContent = " Copied.";
      } catch {
        done.textContent = " Your browser blocked the clipboard.";
      }
    });
    box.append(copy, done);
    page.append(box);
  }
  const credit = element("p", "idol-muted idol-credit");
  credit.textContent = "Facts from Wikidata (CC0), bios from Wikipedia (CC BY-SA 4.0), photos from Wikimedia Commons (credited on each profile). Positions, fandom names and other details can be added on any profile.";
  page.append(credit);
  container.replaceChildren(page);
}

async function idolsRender(container, route) {
  container.replaceChildren(element("p", "idol-muted", "Loading the idol directory…"));
  try {
    const person = /^idol\/(Q\d+)$/.exec(route);
    const group = /^group\/(Q\d+)$/.exec(route);
    if (person) await idolsPersonPage(container, person[1]);
    else if (group) await idolsGroupPage(container, group[1]);
    else idolsDirectoryPage(container, await idolsIndex());
  } catch (error) {
    console.error("Could not load the idol directory.", error);
    container.replaceChildren(element("p", "", "The idol directory couldn’t load. The data may not be published yet; try again later."));
  }
}

function createIdolsView(route) {
  const container = element("div", "idols-view");
  idolsRender(container, route.replace(/^kpop\//, ""));
  return container;
}
