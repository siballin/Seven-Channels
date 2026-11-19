// Movies and Anime hub: stats from your list, a release calendar, and where to watch.
// Anime uses AniList (airing schedule, streaming links); Movies use Wikidata release dates with Wikipedia posters.
// Loaded as a classic script before the main app script; element() and helpers come from the app at call time.

const mediaHubUi = { movies: { tab: "stats" }, anime: { tab: "stats" } };
const mediaHubCache = new Map(); // request key → { at, data }
const mediaHubTtl = 30 * 60 * 1000;

async function mediaHubCached(key, loader) {
  const hit = mediaHubCache.get(key);
  if (hit && Date.now() - hit.at < mediaHubTtl) return hit.data;
  const data = await loader();
  mediaHubCache.set(key, { at: Date.now(), data });
  return data;
}

function mediaHubDay(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// ---------- Stats (pure, from your saved entries) ----------

function mediaHubStats(entries, channelId) {
  const list = entries.filter((entry) => entry.channel === channelId);
  const meta = (entry) => (typeof cleanMediaMeta === "function" ? cleanMediaMeta(entry.meta, channelId) : entry.meta) || null;
  const done = list.filter((entry) => entry.status === "done");
  const ratings = list.map((entry) => Number(entry.rating)).filter((value) => Number.isInteger(value) && value >= 1 && value <= 10);
  const count = (pick) => {
    const tally = new Map();
    for (const entry of list) for (const value of pick(entry)) tally.set(value, (tally.get(value) || 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, 5);
  };
  const stats = {
    total: list.length,
    byStatus: { now: list.filter((e) => e.status === "now").length, next: list.filter((e) => e.status === "next").length, done: done.length },
    averageRating: ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null,
    rated: ratings.length,
    topGenres: count((entry) => meta(entry)?.genres || []),
    topRated: list.filter((entry) => Number(entry.rating) >= 1).sort((a, b) => Number(b.rating) - Number(a.rating) || a.title.localeCompare(b.title)).slice(0, 5)
      .map((entry) => ({ title: entry.title, rating: Number(entry.rating) })),
    byDecade: count((entry) => (meta(entry)?.year ? [`${Math.floor(meta(entry).year / 10) * 10}s`] : [])),
  };
  if (channelId === "anime") {
    stats.episodes = list.reduce((sum, entry) => sum + (Number.isInteger(entry.progress) ? entry.progress : 0), 0);
    // Typical TV episode length; AniList durations are used when a title has one.
    stats.hours = list.reduce((sum, entry) => sum + (Number.isInteger(entry.progress) ? entry.progress : 0) * (Number(entry.meta?.duration) || 24), 0) / 60;
    stats.formats = count((entry) => (meta(entry)?.format ? [animeFormatLabels?.[meta(entry).format] || meta(entry).format] : []));
  } else {
    stats.hours = done.reduce((sum, entry) => sum + (Number(meta(entry)?.runtime) || 0), 0) / 60;
    stats.topDirectors = count((entry) => (meta(entry)?.director ? [meta(entry).director] : []));
  }
  return stats;
}

function mediaHubStatsView(entries, channelId) {
  const stats = mediaHubStats(entries, channelId);
  const wrap = element("div", "media-hub-stats");
  if (!stats.total) {
    wrap.append(element("p", "media-hub-note", `Add ${channelId === "anime" ? "anime" : "movies"} below to see your stats.`));
    return wrap;
  }
  const labels = channelId === "anime" ? ["Watching", "Plan to watch", "Finished"] : ["Watching", "Watchlist", "Seen"];
  const metrics = element("div", "media-hub-metrics");
  const metric = (label, value, note) => {
    const box = element("div", "media-hub-metric");
    box.append(element("span", "", label), element("strong", "", value));
    if (note) box.append(element("small", "", note));
    metrics.append(box);
  };
  metric(labels[2], String(stats.byStatus.done), `${stats.byStatus.now} ${labels[0].toLowerCase()} · ${stats.byStatus.next} ${labels[1].toLowerCase()}`);
  metric("Average rating", stats.averageRating === null ? "—" : `★ ${stats.averageRating.toFixed(1)}`, `${stats.rated} rated`);
  if (channelId === "anime") metric("Episodes watched", String(stats.episodes), `About ${Math.round(stats.hours)} hours`);
  else metric("Time watched", `${Math.round(stats.hours)}h`, "Runtime of what you’ve seen");
  metric("In your list", String(stats.total), "");
  wrap.append(metrics);
  const bars = (title, rows) => {
    if (!rows.length) return null;
    const box = element("section", "media-hub-bars");
    box.append(element("h4", "", title));
    const top = Math.max(...rows.map(([, value]) => value));
    for (const [name, value] of rows) {
      const row = element("div", "media-hub-bar");
      const track = element("span", "media-hub-track");
      const fill = element("span", "media-hub-fill");
      fill.style.width = `${value / top * 100}%`;
      track.append(fill);
      row.append(element("span", "", name), track, element("strong", "", String(value)));
      box.append(row);
    }
    return box;
  };
  const grid = element("div", "media-hub-grid");
  for (const box of [bars("Top genres", stats.topGenres), channelId === "anime" ? bars("Formats", stats.formats) : bars("Top directors", stats.topDirectors), bars("By decade", stats.byDecade)]) if (box) grid.append(box);
  if (stats.topRated.length) {
    const box = element("section", "media-hub-bars");
    box.append(element("h4", "", "Your highest rated"));
    const list = element("ol", "media-hub-ranked");
    for (const item of stats.topRated) list.append(element("li", "", `${item.title} · ★ ${item.rating}`));
    box.append(list);
    grid.append(box);
  }
  wrap.append(grid);
  return wrap;
}

// ---------- Anime: airing schedule, upcoming season, streaming links (AniList) ----------

async function mediaHubAniList(query, variables, signal) {
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST", signal, headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`AniList request failed (${response.status}).`);
  const data = await response.json();
  if (data.errors?.length) throw new Error(data.errors[0].message || "AniList returned an error.");
  return data.data;
}

function mediaHubAnimeSchedule(signal) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const from = Math.floor(start.getTime() / 1000);
  const to = from + 7 * 86400;
  return mediaHubCached(`anime-schedule-${from}`, async () => {
    const query = `query ($from: Int, $to: Int, $page: Int) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage }
      airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) { airingAt episode
        media { id isAdult popularity format title { romaji english } coverImage { medium } siteUrl } } } }`;
    const all = [];
    for (let page = 1; page <= 6; page++) {
      const data = await mediaHubAniList(query, { from, to, page }, signal);
      all.push(...(data.Page?.airingSchedules || []));
      if (!data.Page?.pageInfo?.hasNextPage) break;
    }
    return all.filter((item) => item.media && !item.media.isAdult);
  });
}

function mediaHubAnimeSeason(signal) {
  const now = new Date();
  const seasons = ["WINTER", "SPRING", "SUMMER", "FALL"];
  const index = Math.floor(now.getMonth() / 3);
  const next = { season: seasons[(index + 1) % 4], year: now.getFullYear() + (index === 3 ? 1 : 0) };
  return mediaHubCached(`anime-season-${next.season}-${next.year}`, async () => {
    const query = `query ($season: MediaSeason, $year: Int) { Page(perPage: 24) { media(season: $season, seasonYear: $year, type: ANIME, isAdult: false, sort: POPULARITY_DESC) {
      id format episodes title { romaji english } coverImage { medium } siteUrl startDate { year month day } genres } } }`;
    const data = await mediaHubAniList(query, next, signal);
    return { ...next, media: data.Page?.media || [] };
  });
}

function mediaHubAnimeLinks(ids, signal) {
  return mediaHubCached(`anime-links-${ids.join(",")}`, async () => {
    const query = `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids) { id duration
      nextAiringEpisode { airingAt episode } externalLinks { site url type language } } } }`;
    const data = await mediaHubAniList(query, { ids }, signal);
    return new Map((data.Page?.media || []).map((media) => [String(media.id), media]));
  });
}

function mediaHubCover(url, title) {
  const box = element("span", "media-hub-cover");
  if (typeof url === "string" && url.startsWith("https://")) {
    const img = element("img", "");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => img.remove(), { once: true });
    box.append(img);
  } else {
    box.textContent = (title || "?").slice(0, 1);
  }
  return box;
}

function mediaHubAnimeTitle(media) {
  return media?.title?.english || media?.title?.romaji || "Untitled";
}

function mediaHubLink(text, href, cls = "") {
  const link = element("a", cls, text);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function mediaHubAnimeCalendar(entries, container, signal) {
  const mine = new Set(entries.filter((entry) => entry.channel === "anime").map((entry) => String(entry.meta?.id || "")).filter(Boolean));
  container.append(element("p", "media-hub-note", "Loading this week’s airing schedule from AniList…"));
  Promise.all([mediaHubAnimeSchedule(signal), mediaHubAnimeSeason(signal).catch(() => null)]).then(([schedule, season]) => {
    container.replaceChildren();
    const onlyMine = element("label", "media-hub-toggle");
    const toggle = element("input", "");
    toggle.type = "checkbox";
    toggle.checked = Boolean(mediaHubUi.anime.onlyMine);
    onlyMine.append(toggle, " Only shows in my list");
    const days = element("div", "media-hub-week");
    const draw = () => {
      days.replaceChildren();
      const byDay = new Map();
      for (const item of schedule) {
        if (toggle.checked && !mine.has(String(item.media.id))) continue;
        const key = mediaHubDay(new Date(item.airingAt * 1000));
        byDay.set(key, [...(byDay.get(key) || []), item]);
      }
      for (let offset = 0; offset < 7; offset++) {
        const day = new Date();
        day.setDate(day.getDate() + offset);
        const key = mediaHubDay(day);
        const column = element("section", "media-hub-day");
        column.append(element("h4", "", offset === 0 ? "Today" : day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })));
        const items = (byDay.get(key) || []).sort((a, b) => Number(mine.has(String(b.media.id))) - Number(mine.has(String(a.media.id))) || b.media.popularity - a.media.popularity).slice(0, 12);
        if (!items.length) column.append(element("p", "media-hub-note", toggle.checked ? "None of yours" : "Nothing listed"));
        for (const item of items) {
          const row = mediaHubLink("", item.media.siteUrl, `media-hub-airing${mine.has(String(item.media.id)) ? " is-mine" : ""}`);
          const copy = element("span", "");
          copy.append(element("strong", "", mediaHubAnimeTitle(item.media)),
            element("small", "", `Ep ${item.episode} · ${new Date(item.airingAt * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}${mine.has(String(item.media.id)) ? " · in your list" : ""}`));
          row.append(mediaHubCover(item.media.coverImage?.medium, mediaHubAnimeTitle(item.media)), copy);
          column.append(row);
        }
        days.append(column);
      }
    };
    toggle.addEventListener("change", () => { mediaHubUi.anime.onlyMine = toggle.checked; draw(); });
    draw();
    container.append(element("h4", "media-hub-subhead", "Airing this week"), onlyMine, days);
    if (season?.media?.length) {
      const name = `${season.season[0]}${season.season.slice(1).toLowerCase()} ${season.year}`;
      const grid = element("div", "media-hub-season");
      for (const media of season.media.slice(0, 18)) {
        const card = mediaHubLink("", media.siteUrl, "media-hub-season-card");
        const start = media.startDate?.year ? new Date(media.startDate.year, (media.startDate.month || 1) - 1, media.startDate.day || 1) : null;
        card.append(mediaHubCover(media.coverImage?.medium, mediaHubAnimeTitle(media)), element("strong", "", mediaHubAnimeTitle(media)),
          element("small", "", [start && media.startDate.day ? start.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : start ? start.toLocaleDateString(undefined, { month: "long" }) : "Date TBA", (media.genres || []).slice(0, 2).join(", ")].filter(Boolean).join(" · ")));
        grid.append(card);
      }
      container.append(element("h4", "media-hub-subhead", `Coming in ${name}`), grid);
    }
    container.append(element("p", "media-hub-note", "Schedule and season from AniList. Times are in your time zone; streaming services may post episodes later."));
  }).catch((error) => {
    if (error.name === "AbortError") return;
    console.error("Could not load the anime schedule.", error);
    container.replaceChildren(element("p", "media-hub-note", "The airing schedule couldn’t be loaded from AniList right now."));
  });
}

function mediaHubAnimeWatch(entries, container, signal) {
  const list = entries.filter((entry) => entry.channel === "anime" && /^\d+$/.test(String(entry.meta?.id || "")) && entry.meta?.source === "anilist");
  if (!list.length) {
    container.append(element("p", "media-hub-note", "Add anime with the title search (so they’re linked to AniList) to see where each one streams."));
    return;
  }
  container.append(element("p", "media-hub-note", "Loading streaming links from AniList…"));
  mediaHubAnimeLinks(list.map((entry) => Number(entry.meta.id)).slice(0, 50), signal).then((byId) => {
    container.replaceChildren();
    const rows = element("ul", "media-hub-watch");
    const order = { now: 0, next: 1, done: 2 };
    for (const entry of [...list].sort((a, b) => order[a.status] - order[b.status] || a.title.localeCompare(b.title))) {
      const media = byId.get(String(entry.meta.id));
      const row = element("li", "");
      row.append(mediaHubCover(entry.meta.poster, entry.title));
      const copy = element("div", "");
      copy.append(element("strong", "", entry.title));
      const next = media?.nextAiringEpisode;
      if (next) copy.append(element("small", "", `Episode ${next.episode} airs ${new Date(next.airingAt * 1000).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`));
      const services = (media?.externalLinks || []).filter((link) => link.type === "STREAMING" && /^https:\/\//.test(link.url || "") && (!link.language || /english|japanese/i.test(link.language)));
      const chips = element("div", "media-hub-chips");
      for (const link of services.slice(0, 6)) chips.append(mediaHubLink(link.site, link.url, "media-hub-chip"));
      if (!services.length) chips.append(element("small", "media-hub-note", "No official streaming links listed on AniList"));
      copy.append(chips);
      row.append(copy);
      rows.append(row);
    }
    container.append(rows, element("p", "media-hub-note", "Official streaming links listed on AniList; availability can differ by country."));
  }).catch((error) => {
    if (error.name === "AbortError") return;
    console.error("Could not load streaming links.", error);
    container.replaceChildren(element("p", "media-hub-note", "Streaming links couldn’t be loaded from AniList right now."));
  });
}

// ---------- Movies: US release calendar (Wikidata + Wikipedia posters), where to watch (JustWatch links) ----------

function mediaHubMovieReleases(signal) {
  const start = new Date();
  start.setDate(start.getDate() - 14);
  const end = new Date();
  end.setDate(end.getDate() + 75);
  const from = mediaHubDay(start);
  const to = mediaHubDay(end);
  return mediaHubCached(`movie-releases-${from}`, async () => {
    // Films with a US release date (or an unqualified one) in the window and an English Wikipedia article.
    const query = `SELECT ?film ?filmLabel ?date ?article (SAMPLE(?genreLabel) AS ?genre) WHERE {
      ?film wdt:P31 wd:Q11424; p:P577 ?statement.
      ?statement ps:P577 ?date.
      OPTIONAL { ?statement pq:P291 ?place. }
      FILTER(!BOUND(?place) || ?place = wd:Q30)
      FILTER(?date >= "${from}T00:00:00Z"^^xsd:dateTime && ?date <= "${to}T00:00:00Z"^^xsd:dateTime)
      ?article schema:about ?film; schema:isPartOf <https://en.wikipedia.org/>.
      OPTIONAL { ?film wdt:P136 ?g. ?g rdfs:label ?genreLabel. FILTER(LANG(?genreLabel) = "en") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } GROUP BY ?film ?filmLabel ?date ?article ORDER BY ?date LIMIT 300`;
    const response = await fetch(`https://query.wikidata.org/sparql?${new URLSearchParams({ query, format: "json" })}`, { signal, headers: { Accept: "application/sparql-results+json" } });
    if (!response.ok) throw new Error(`Wikidata request failed (${response.status}).`);
    const data = await response.json();
    const seen = new Set();
    const films = [];
    for (const row of data.results?.bindings || []) {
      const id = row.film?.value?.split("/").pop();
      const date = row.date?.value?.slice(0, 10);
      const article = row.article?.value || "";
      if (!id || !date || seen.has(id) || !article.startsWith("https://en.wikipedia.org/wiki/")) continue;
      seen.add(id);
      films.push({ id, title: row.filmLabel?.value || "", date, article, genre: (row.genre?.value || "").replace(/\s+film$/i, "") });
    }
    // Posters from Wikipedia (film posters are non-free images, so any license is allowed).
    for (let index = 0; index < films.length; index += 50) {
      const batch = films.slice(index, index + 50);
      const titles = batch.map((film) => decodeURIComponent(film.article.split("/wiki/")[1]).replaceAll("_", " "));
      const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", origin: "*", prop: "pageimages", piprop: "thumbnail", pithumbsize: "200", pilicense: "any", titles: titles.join("|") });
      try {
        const pages = (await (await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal })).json())?.query?.pages || [];
        const byTitle = new Map(pages.map((page) => [page.title, page.thumbnail?.source || ""]));
        batch.forEach((film, offset) => { film.poster = byTitle.get(titles[offset]) || ""; });
      } catch (error) {
        if (error.name === "AbortError") throw error;
      }
    }
    return films;
  });
}

function mediaHubMovieCalendar(entries, container, signal) {
  container.append(element("p", "media-hub-note", "Loading upcoming releases from Wikidata…"));
  const mine = new Set(entries.filter((entry) => entry.channel === "movies").map((entry) => String(entry.meta?.id || "")).filter(Boolean));
  mediaHubMovieReleases(signal).then((films) => {
    container.replaceChildren();
    if (!films.length) {
      container.append(element("p", "media-hub-note", "No upcoming releases were found."));
      return;
    }
    const today = mediaHubDay(new Date());
    const months = new Map();
    for (const film of films) {
      const key = film.date.slice(0, 7);
      months.set(key, [...(months.get(key) || []), film]);
    }
    for (const [month, list] of months) {
      container.append(element("h4", "media-hub-subhead", new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })));
      const grid = element("div", "media-hub-season");
      for (const film of list) {
        const card = mediaHubLink("", film.article, `media-hub-season-card${film.date < today ? " is-past" : ""}${mine.has(film.id) ? " is-mine" : ""}`);
        card.append(mediaHubCover(film.poster, film.title), element("strong", "", film.title),
          element("small", "", [new Date(`${film.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }), film.genre, mine.has(film.id) ? "In your list" : film.date < today ? "Out now" : ""].filter(Boolean).join(" · ")));
        grid.append(card);
      }
      container.append(grid);
    }
    container.append(element("p", "media-hub-note", "US release dates from Wikidata (films with an English Wikipedia article), posters from Wikipedia. Dates can be festival premieres or limited releases."));
  }).catch((error) => {
    if (error.name === "AbortError") return;
    console.error("Could not load movie releases.", error);
    container.replaceChildren(element("p", "media-hub-note", "Upcoming releases couldn’t be loaded from Wikidata right now."));
  });
}

function mediaHubMovieWatch(entries, container) {
  const list = entries.filter((entry) => entry.channel === "movies" && entry.status !== "done");
  if (!list.length) {
    container.append(element("p", "media-hub-note", "Movies on your watchlist will appear here with a link to where they’re streaming."));
    return;
  }
  const rows = element("ul", "media-hub-watch");
  for (const entry of list) {
    const row = element("li", "");
    row.append(mediaHubCover(entry.meta?.poster, entry.title));
    const copy = element("div", "");
    const year = entry.meta?.year ? ` (${entry.meta.year})` : "";
    copy.append(element("strong", "", `${entry.title}${year}`));
    const chips = element("div", "media-hub-chips");
    chips.append(mediaHubLink("JustWatch ↗", `https://www.justwatch.com/us/search?${new URLSearchParams({ q: entry.title })}`, "media-hub-chip"),
      mediaHubLink("Reelgood ↗", `https://reelgood.com/search?${new URLSearchParams({ q: entry.title })}`, "media-hub-chip"));
    copy.append(chips);
    row.append(copy);
    rows.append(row);
  }
  container.append(rows, element("p", "media-hub-note", "There’s no free service for streaming availability, so these open the title on JustWatch or Reelgood, which list where it’s streaming, renting and buying."));
}

// ---------- Hub ----------

let mediaHubController = null;
function createMediaHub(channelId, entries) {
  mediaHubController?.abort();
  mediaHubController = new AbortController();
  const signal = mediaHubController.signal;
  const ui = mediaHubUi[channelId];
  const section = element("section", "media-hub");
  section.setAttribute("aria-label", channelId === "anime" ? "Anime stats, schedule and streaming" : "Movie stats, releases and streaming");
  const tabs = element("div", "media-hub-tabs");
  tabs.setAttribute("role", "tablist");
  const panel = element("div", "media-hub-panel");
  panel.setAttribute("role", "tabpanel");
  const names = [["stats", "Your stats"], ["calendar", channelId === "anime" ? "Airing schedule" : "Release calendar"], ["watch", "Where to watch"]];
  const show = (tab) => {
    ui.tab = tab;
    for (const button of tabs.children) {
      const active = button.dataset.tab === tab;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    panel.replaceChildren();
    panel.setAttribute("aria-labelledby", `media-hub-tab-${channelId}-${tab}`);
    if (tab === "stats") panel.append(mediaHubStatsView(entries, channelId));
    else if (tab === "calendar") (channelId === "anime" ? mediaHubAnimeCalendar : mediaHubMovieCalendar)(entries, panel, signal);
    else (channelId === "anime" ? mediaHubAnimeWatch : mediaHubMovieWatch)(entries, panel, signal);
  };
  for (const [tab, label] of names) {
    const button = element("button", "secondary", label);
    button.type = "button";
    button.id = `media-hub-tab-${channelId}-${tab}`;
    button.dataset.tab = tab;
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => show(tab));
    tabs.append(button);
  }
  tabs.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const buttons = [...tabs.children];
    const index = buttons.indexOf(event.target);
    const next = buttons[(index + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
    next.focus();
    next.click();
  });
  section.append(tabs, panel);
  show(ui.tab);
  return section;
}
