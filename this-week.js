// "This week" on the Guide: the next seven days across channels, in one list grouped by day.
// Concerts (Live Events plans), league nights (bowling leagues), K-pop releases from followed artists,
// game releases (favorites first), US movie releases (Wikidata) and planned uploads (Creator Studio).

function thisWeekDay(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function thisWeekRange(start = new Date()) {
  const days = [];
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    days.push(thisWeekDay(date));
  }
  return days;
}

function thisWeekSafe(read) {
  try { return read() || []; } catch (error) { console.warn("This week: a source was unavailable.", error); return []; }
}

// Local sources: read synchronously from each channel's saved state.
function thisWeekLocalItems(days) {
  const first = days[0];
  const last = days[days.length - 1];
  const inWeek = (date) => typeof date === "string" && date >= first && date <= last;
  const items = [];
  thisWeekSafe(() => liveGetState().plans).forEach((plan) => {
    if (!["Planning", "Ticket Purchased", "Attending"].includes(plan.status) || !inWeek(plan.event?.date)) return;
    items.push({ kind: "concert", label: "Concert", date: plan.event.date, time: plan.event.time || "",
      title: plan.event.attractions?.[0]?.name || plan.event.name, note: [plan.event.venue?.name, plan.status === "Planning" ? "Planning" : ""].filter(Boolean).join(" · "),
      href: `#live/event/${plan.event.id}` });
  });
  thisWeekSafe(() => bowlingGetState().leagues).forEach((league) => {
    if (league.archived || !Number.isInteger(league.night)) return;
    for (const date of days) {
      if (new Date(`${date}T12:00:00`).getDay() !== league.night) continue;
      if ((league.seasonStart && date < league.seasonStart) || (league.seasonEnd && date > league.seasonEnd)) continue;
      items.push({ kind: "bowling", label: "League night", date, time: league.time || "", title: league.name,
        note: [league.center, league.team ? `Team ${league.team}` : ""].filter(Boolean).join(" · "), href: "#bowling/leagues" });
    }
  });
  thisWeekSafe(() => creatorGetState().schedule).forEach((event) => {
    if (event.status === "published" || !inWeek(event.date)) return;
    const platform = (typeof creatorPlatforms !== "undefined" ? creatorPlatforms.find(([id]) => id === event.type)?.[1] : "") || "Upload";
    items.push({ kind: "creator", label: "Planned upload", date: event.date, time: event.time || "", title: event.title,
      note: `${platform}${event.status === "draft" ? " · Draft" : ""}`, href: "#creator" });
  });
  return items;
}

async function thisWeekJson(path, signal) {
  const response = await fetch(new URL(path, location.href), { signal });
  if (!response.ok) throw new Error(`${path} request failed (${response.status}).`);
  return response.json();
}

// K-pop releases on the KPOP OFFICIAL calendar for followed artists, plus MusicBrainz extras.
async function thisWeekKpop(days, signal) {
  const first = days[0];
  const last = days[days.length - 1];
  const follows = typeof kpopArtistFollows !== "undefined" ? kpopArtistFollows.filter((artist) => artist.followed) : [];
  const items = [];
  if (follows.length) {
    const calendar = (await thisWeekJson("data/kpop-sidebar.json", signal)).calendar;
    const dates = new Map((calendar?.dateTerms || []).map((term) => [term.id, Number(term.name)]));
    const decoder = document.createElement("textarea");
    for (const period of calendar?.periods || []) {
      for (const release of period.releases || []) {
        const day = dates.get(release["calendar-date"]?.[0]);
        if (!Number.isInteger(day) || !Number.isInteger(period.year) || !Number.isInteger(period.month)) continue;
        const date = `${period.year}-${String(period.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (date < first || date > last) continue;
        const artist = follows.find((follow) => Array.isArray(release[follow.taxonomy]) && release[follow.taxonomy].includes(follow.id));
        if (!artist) continue;
        decoder.innerHTML = release.title?.rendered || "";
        let href = "";
        try { href = new URL(release.link).hostname === "kpopofficial.com" ? release.link : ""; } catch (error) { href = ""; }
        items.push({ kind: "kpop", label: "K-pop release", date, title: decoder.value.trim() || artist.name, note: artist.name, href, external: true });
      }
    }
  }
  if (typeof loadKpopExtra === "function") {
    const extra = await loadKpopExtra();
    for (const release of extra.releases || []) {
      if (release.date < first || release.date > last) continue;
      if (items.some((item) => item.date === release.date && item.title.toLowerCase().includes(release.artist.toLowerCase()))) continue;
      items.push({ kind: "kpop", label: "K-pop release", date: release.date, title: `${release.artist} – ${release.title}`, note: release.type || "MusicBrainz", href: `#music/group/${release.id}` });
    }
  }
  return items;
}

// Birthdays of idols in groups you follow on the K-Pop channel (and followed soloists), from the idol directory.
async function thisWeekIdolBirthdays(days, signal) {
  const follows = typeof kpopArtistFollows !== "undefined" ? kpopArtistFollows.filter((artist) => artist.followed) : [];
  if (!follows.length) return [];
  const fold = (value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s*\(.*\)$/, "").trim();
  const wanted = new Set(follows.map((artist) => fold(artist.name)));
  const index = await thisWeekJson("data/idols/index.json", signal);
  const groups = new Map((index.groups || []).filter((group) => !group.x && wanted.has(fold(group.n))).map((group) => [group.id, group.n]));
  const byDay = new Map(days.map((day) => [day.slice(5), day]));
  const items = [];
  for (const person of index.people || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(person.b || "") || !byDay.has(person.b.slice(5))) continue;
    const group = (person.g || []).map((id) => groups.get(id)).find(Boolean);
    if (!group && !wanted.has(fold(person.n))) continue;
    const date = byDay.get(person.b.slice(5));
    const age = Number(date.slice(0, 4)) - Number(person.b.slice(0, 4));
    items.push({ kind: "birthday", label: "Birthday", date, title: `${person.n} turns ${age}`, note: group || "Soloist", href: `#kpop/idol/${person.id}`, image: person.p || "" });
  }
  return items;
}

async function thisWeekGames(days, signal) {
  const data = await thisWeekJson("data/game-releases.json", signal);
  const releases = (data.releases || []).filter((release) => release.date >= days[0] && release.date <= days[days.length - 1] && release.title);
  const favorites = new Set(typeof gamesReadFavorites === "function" ? gamesReadFavorites(data.releases || []).map((item) => item.url) : []);
  const ranked = [...releases].sort((a, b) => Number(favorites.has(b.url)) - Number(favorites.has(a.url)));
  const shown = [...ranked.filter((release) => favorites.has(release.url)), ...ranked.filter((release) => !favorites.has(release.url)).slice(0, 5)];
  return {
    items: shown.map((release) => ({ kind: "game", label: favorites.has(release.url) ? "Game release · Favorite" : "Game release", date: release.date,
      title: release.title, note: (release.platforms || []).slice(0, 3).join(", "), href: release.url, external: true, image: release.cover || "", starred: favorites.has(release.url) })),
    hidden: releases.length - shown.length
  };
}

async function thisWeekMovies(days, signal) {
  if (typeof mediaHubMovieReleases !== "function") return { items: [], hidden: 0 };
  const films = (await mediaHubMovieReleases(signal)).filter((film) => film.date >= days[0] && film.date <= days[days.length - 1]);
  const shown = films.slice(0, 6);
  return {
    items: shown.map((film) => ({ kind: "movie", label: "In theaters", date: film.date, title: film.title, note: film.genre || "", href: film.article, external: true, image: film.poster || "" })),
    hidden: films.length - shown.length
  };
}

function thisWeekDayLabel(date, today) {
  const value = new Date(`${date}T12:00:00`);
  const diff = Math.round((value - new Date(`${today}T12:00:00`)) / 86400000);
  const weekday = value.toLocaleDateString(undefined, { weekday: "long" });
  const short = value.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return diff === 0 ? `Today · ${short}` : diff === 1 ? `Tomorrow · ${short}` : `${weekday} · ${short}`;
}

function thisWeekTime(value) {
  const match = /^(\d{2}):(\d{2})/.exec(value || "");
  if (!match) return "";
  return new Date(2000, 0, 1, Number(match[1]), Number(match[2])).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const thisWeekOrder = ["concert", "race", "bowling", "creator", "birthday", "kpop", "game", "movie"];

function createThisWeek({ signal } = {}) {
  const section = element("section", "this-week");
  section.setAttribute("aria-labelledby", "this-week-title");
  const head = element("div", "this-week-head");
  const title = element("h2", "", "This week");
  title.id = "this-week-title";
  const days = thisWeekRange();
  const range = `${new Date(`${days[0]}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${new Date(`${days[6]}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const side = element("div", "this-week-side");
  side.append(element("span", "this-week-range", range));
  if (typeof createNotifySettings === "function") side.append(createNotifySettings());
  head.append(title, side);
  const status = element("p", "this-week-status", "Loading releases…");
  status.setAttribute("role", "status");
  const body = element("div", "this-week-days");
  section.append(head, status, body);

  const items = thisWeekLocalItems(days);
  const notes = [];
  function render() {
    body.replaceChildren();
    const byDay = new Map(days.map((day) => [day, []]));
    for (const item of items) byDay.get(item.date)?.push(item);
    for (const [day, list] of byDay) {
      if (!list.length) continue;
      list.sort((a, b) => thisWeekOrder.indexOf(a.kind) - thisWeekOrder.indexOf(b.kind) || (a.time || "99").localeCompare(b.time || "99") || Number(Boolean(b.starred)) - Number(Boolean(a.starred)));
      const group = element("div", `this-week-day${day === days[0] ? " is-today" : ""}`);
      group.append(element("h3", "", thisWeekDayLabel(day, days[0])));
      const ul = element("ul");
      for (const item of list) {
        const li = element("li", `this-week-item ${item.kind}`);
        const link = element(item.href ? "a" : "div", "this-week-link");
        if (item.href) {
          link.href = item.href;
          if (item.external) {
            link.target = "_blank";
            link.rel = "noopener noreferrer";
          }
        }
        if (item.image && /^https:\/\//.test(item.image)) {
          const image = element("img", "this-week-image");
          image.src = item.image;
          image.alt = "";
          image.loading = "lazy";
          image.addEventListener("error", () => image.remove(), { once: true });
          link.append(image);
        } else {
          link.append(element("span", "this-week-dot"));
        }
        const text = element("span", "this-week-text");
        text.append(element("small", "this-week-kind", [item.label, thisWeekTime(item.time)].filter(Boolean).join(" · ")), element("strong", "", item.title));
        if (item.note) text.append(element("small", "", item.note));
        link.append(text);
        li.append(link);
        ul.append(li);
      }
      group.append(ul);
      body.append(group);
    }
    if (!body.childElementCount) body.append(element("p", "this-week-empty", "Nothing on the calendar this week. Plan a concert, set up a bowling league, follow K-pop artists or favorite a game release to fill this in."));
  }
  render();
  const sources = [
    ["K-pop releases", thisWeekKpop(days, signal).then((list) => ({ items: list, hidden: 0 }))],
    ["idol birthdays", thisWeekIdolBirthdays(days, signal).then((list) => ({ items: list, hidden: 0 }))],
    ["races", (typeof motorsportsThisWeek === "function" ? motorsportsThisWeek(days) : Promise.resolve([])).then((list) => ({ items: list, hidden: 0 }))],
    ["game releases", thisWeekGames(days, signal)],
    ["movie releases", thisWeekMovies(days, signal)]
  ];
  Promise.allSettled(sources.map(([, promise]) => promise)).then((results) => {
    if (signal?.aborted || !section.isConnected && signal) return;
    const failed = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        items.push(...result.value.items);
        if (result.value.hidden > 0) notes.push(`${result.value.hidden} more ${sources[index][0]}`);
      } else if (result.reason?.name !== "AbortError") failed.push(sources[index][0]);
    });
    render();
    status.textContent = [notes.length ? `Plus ${notes.join(" and ")} this week.` : "", failed.length ? `Couldn’t load ${failed.join(", ")}.` : ""].filter(Boolean).join(" ");
    status.hidden = !status.textContent;
  });
  return section;
}
