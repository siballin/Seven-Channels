// Year in review (#wrapped or #wrapped/2026): one page summing up a year across channels,
// built from data already saved on this device (and synced, when signed in). Nothing new is stored.

function wrappedYearOf(value) {
  const match = /^(\d{4})-\d{2}/.exec(typeof value === "string" ? value : "");
  return match ? Number(match[1]) : null;
}

function wrappedSafe(read, fallback) {
  try { return read() ?? fallback; } catch (error) { console.warn("Year in review: a source was unavailable.", error); return fallback; }
}

function wrappedCount(list, key) {
  const counts = new Map();
  for (const item of list) {
    const name = key(item);
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// Every number on the page comes from here, so it can be tested without a browser.
function wrappedStats(year, { entries = [], bowling = {}, live = {}, creator = {}, musicLab = {} } = {}) {
  const inYear = (value) => wrappedYearOf(value) === year;
  const stats = { year };

  const concerts = (live.journal || []).filter((show) => inYear(show.date)).sort((a, b) => a.date.localeCompare(b.date));
  const artists = wrappedCount(concerts.flatMap((show) => [show.artist?.name, ...(show.lineup || [])].filter(Boolean).map((name) => ({ name }))), (item) => item.name);
  const rated = concerts.filter((show) => Number.isInteger(show.rating)).sort((a, b) => b.rating - a.rating || a.date.localeCompare(b.date));
  stats.concerts = {
    count: concerts.length,
    artists: artists.length,
    venues: new Set(concerts.map((show) => show.venue).filter(Boolean)).size,
    cities: new Set(concerts.map((show) => show.city).filter(Boolean)).size,
    spent: concerts.reduce((sum, show) => sum + (Number(show.price) || 0), 0),
    best: rated[0] ? { artist: rated[0].artist.name, venue: rated[0].venue, date: rated[0].date, rating: rated[0].rating } : null,
    first: concerts[0] ? { artist: concerts[0].artist.name, date: concerts[0].date } : null,
    mostSeen: artists[0] && artists[0][1] > 1 ? { name: artists[0][0], times: artists[0][1] } : null
  };

  const sessions = (bowling.sessions || []).filter((session) => inYear(session.date));
  const games = sessions.flatMap((session) => session.games.map((game) => game.score).filter((score) => Number.isFinite(score)));
  const series = sessions.filter((session) => session.games.length >= 3)
    .map((session) => ({ date: session.date, total: session.games.slice(0, 3).reduce((sum, game) => sum + (game.score || 0), 0) }))
    .sort((a, b) => b.total - a.total);
  const half = (from, to) => {
    const scores = sessions.filter((session) => session.date.slice(5, 7) >= from && session.date.slice(5, 7) <= to)
      .flatMap((session) => session.games.map((game) => game.score).filter((score) => Number.isFinite(score)));
    return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
  };
  stats.bowling = {
    sessions: sessions.length,
    games: games.length,
    average: games.length ? games.reduce((sum, score) => sum + score, 0) / games.length : null,
    high: games.length ? Math.max(...games) : null,
    highSeries: series[0]?.total ?? null,
    twoHundreds: games.filter((score) => score >= 200).length,
    firstHalf: half("01", "06"),
    secondHalf: half("07", "12")
  };

  const finished = (channel) => entries.filter((entry) => entry.channel === channel && entry.status === "done" && inYear(entry.updatedAt));
  const top = (list) => list.filter((entry) => Number.isFinite(Number(entry.rating)) && Number(entry.rating) > 0)
    .sort((a, b) => Number(b.rating) - Number(a.rating) || a.title.localeCompare(b.title)).slice(0, 3).map((entry) => ({ title: entry.title, rating: Number(entry.rating) }));
  stats.media = Object.fromEntries(["movies", "anime", "games", "kpop", "sports"].map((channel) => {
    const list = finished(channel);
    return [channel, { count: list.length, top: top(list), titles: list.map((entry) => entry.title).slice(0, 12) }];
  }));

  const settled = entries.filter((entry) => entry.channel === "betting" && inYear(typeof bettingDateOf === "function" ? bettingDateOf(entry) : entry.updatedAt));
  const betting = typeof bettingStats === "function" ? bettingStats(settled) : null;
  stats.betting = betting && betting.bets ? {
    bets: betting.bets, wins: betting.wins, losses: betting.losses, pushes: betting.pushes, net: betting.net, roi: betting.roi,
    bestSport: [...betting.bySport].filter((group) => group.bets >= 3).sort((a, b) => b.net - a.net)[0]?.name || "",
    best: betting.best ? { title: betting.best.title, profit: betting.best.profit } : null
  } : { bets: 0 };

  const touched = (item) => inYear(item.discoveredAt) || inYear(item.updatedAt);
  const items = (musicLab.items || []).filter(touched);
  stats.music = {
    producers: items.filter((item) => item.following).map((item) => item.title).filter(Boolean),
    rated: items.filter((item) => item.rating).length,
    favorites: items.filter((item) => item.favorite).length,
    topRated: items.filter((item) => item.rating).sort((a, b) => b.rating - a.rating || a.title.localeCompare(b.title)).slice(0, 3).map((item) => ({ title: item.title, subtitle: item.subtitle, rating: item.rating }))
  };

  const uploads = (creator.schedule || []).filter((event) => event.status === "published" && inYear(event.date));
  stats.creator = {
    published: uploads.length,
    byPlatform: wrappedCount(uploads, (event) => (typeof creatorPlatforms !== "undefined" ? creatorPlatforms.find(([id]) => id === event.type)?.[1] : event.type) || event.type),
    ideas: (creator.ideas || []).filter((idea) => inYear(idea.createdAt)).length
  };
  return stats;
}

function wrappedYears(sources) {
  const years = new Set([new Date().getFullYear()]);
  const add = (value) => { const year = wrappedYearOf(value); if (year && year >= 2000 && year <= new Date().getFullYear()) years.add(year); };
  (sources.live?.journal || []).forEach((show) => add(show.date));
  (sources.bowling?.sessions || []).forEach((session) => add(session.date));
  (sources.entries || []).forEach((entry) => add(entry.updatedAt));
  (sources.creator?.schedule || []).forEach((event) => add(event.date));
  return [...years].sort((a, b) => b - a);
}

function wrappedNumber(value, digits = 0) {
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function wrappedDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function wrappedCard(kind, title, big, bigLabel, lines, href) {
  const card = element("article", `wrapped-card ${kind}`);
  const head = element("h3", "", title);
  card.append(head);
  if (big !== null && big !== undefined) {
    const figure = element("p", "wrapped-big");
    figure.append(element("strong", "", String(big)), element("span", "", bigLabel));
    card.append(figure);
  }
  const list = element("ul");
  for (const line of lines.filter(Boolean)) list.append(element("li", "", line));
  if (list.childElementCount) card.append(list);
  if (href) {
    const link = element("a", "wrapped-more", "Open channel");
    link.href = href;
    card.append(link);
  }
  return card;
}

function wrappedSummaryText(stats) {
  const lines = [`My ${stats.year} on Seven Channels`];
  if (stats.concerts.count) lines.push(`🎤 ${stats.concerts.count} concert${stats.concerts.count === 1 ? "" : "s"}${stats.concerts.best ? `, best: ${stats.concerts.best.artist}` : ""}`);
  if (stats.bowling.games) lines.push(`🎳 ${stats.bowling.games} games, ${wrappedNumber(stats.bowling.average, 1)} average, high game ${stats.bowling.high}`);
  for (const [channel, emoji, noun] of [["movies", "🎬", "movie"], ["anime", "📺", "anime"], ["games", "🎮", "game"]]) {
    const block = stats.media[channel];
    if (block.count) lines.push(`${emoji} ${block.count} ${noun}${block.count === 1 || noun === "anime" ? "" : "s"} finished${block.top[0] ? `, top: ${block.top[0].title}` : ""}`);
  }
  if (stats.music.producers.length) lines.push(`🎛️ Followed ${stats.music.producers.length} producer${stats.music.producers.length === 1 ? "" : "s"} in Music Lab`);
  if (stats.betting.bets) lines.push(`🎲 ${stats.betting.wins}-${stats.betting.losses}${stats.betting.pushes ? `-${stats.betting.pushes}` : ""} betting, ${stats.betting.net >= 0 ? "+" : ""}${wrappedNumber(stats.betting.net, 2)} units`);
  if (stats.creator.published) lines.push(`📹 ${stats.creator.published} upload${stats.creator.published === 1 ? "" : "s"} published`);
  return lines.join("\n");
}

function createYearInReview(year, entries) {
  const sources = {
    entries,
    bowling: wrappedSafe(() => bowlingGetState(), {}),
    live: wrappedSafe(() => liveGetState(), {}),
    creator: wrappedSafe(() => creatorGetState(), {}),
    musicLab: wrappedSafe(() => musicLabGetState(), {})
  };
  const years = wrappedYears(sources);
  if (!years.includes(year)) year = years[0];
  const stats = wrappedStats(year, sources);
  const page = element("section", "wrapped");
  page.setAttribute("aria-labelledby", "wrapped-title");

  const head = element("div", "wrapped-head");
  const titleBlock = element("div");
  const title = element("h2", "", `Your ${year} in review`);
  title.id = "wrapped-title";
  titleBlock.append(title, element("p", "wrapped-sub", year === new Date().getFullYear() ? "So far this year, from what you’ve logged on Seven Channels." : "From what you logged on Seven Channels."));
  const tools = element("div", "wrapped-tools");
  const back = element("a", "wrapped-more", "Back to Guide");
  back.href = "#guide";
  const picker = element("select");
  picker.setAttribute("aria-label", "Year");
  for (const value of years) {
    const option = element("option", "", String(value));
    option.value = String(value);
    option.selected = value === year;
    picker.append(option);
  }
  picker.addEventListener("change", () => { location.hash = `#wrapped/${picker.value}`; });
  const copy = element("button", "secondary", "Copy summary");
  copy.type = "button";
  const copied = element("span", "wrapped-copied");
  copied.setAttribute("role", "status");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(wrappedSummaryText(stats));
      copied.textContent = "Copied.";
    } catch (error) {
      copied.textContent = "Couldn’t copy. Your browser blocked the clipboard.";
    }
  });
  tools.append(picker, copy, back, copied);
  head.append(titleBlock, tools);
  page.append(head);

  const grid = element("div", "wrapped-grid");
  const c = stats.concerts;
  if (c.count) grid.append(wrappedCard("live", "Concerts", c.count, c.count === 1 ? "show" : "shows", [
    `${c.artists} artist${c.artists === 1 ? "" : "s"} across ${c.venues} venue${c.venues === 1 ? "" : "s"}${c.cities > 1 ? ` in ${c.cities} cities` : ""}`,
    c.best && `Best show: ${c.best.artist}${c.best.venue ? ` at ${c.best.venue}` : ""} (${c.best.rating}/10)`,
    c.mostSeen && `Saw ${c.mostSeen.name} ${c.mostSeen.times} times`,
    c.first && `First of the year: ${c.first.artist}, ${wrappedDate(c.first.date)}`,
    c.spent ? `Spent ${wrappedNumber(c.spent, 2)} on tickets` : ""
  ], "#live/journal"));
  const bw = stats.bowling;
  if (bw.games) {
    const trend = bw.firstHalf !== null && bw.secondHalf !== null
      ? `Average ${bw.secondHalf >= bw.firstHalf ? "up" : "down"} ${wrappedNumber(Math.abs(bw.secondHalf - bw.firstHalf), 1)} pins from the first half of the year` : "";
    grid.append(wrappedCard("bowling", "Bowling", wrappedNumber(bw.average, 1), "average", [
      `${bw.games} games over ${bw.sessions} session${bw.sessions === 1 ? "" : "s"}`,
      `High game ${bw.high}${bw.highSeries ? `, high series ${bw.highSeries}` : ""}`,
      bw.twoHundreds ? `${bw.twoHundreds} game${bw.twoHundreds === 1 ? "" : "s"} of 200 or more` : "",
      trend
    ], "#bowling/stats"));
  }
  for (const [channel, label, noun] of [["movies", "Movies", "watched"], ["anime", "Anime", "finished"], ["games", "Video Games", "finished"], ["kpop", "K-Pop", "played out"]]) {
    const block = stats.media[channel];
    if (!block.count) continue;
    grid.append(wrappedCard(channel, label, block.count, noun, [
      ...block.top.map((item, index) => `${index + 1}. ${item.title} (${item.rating}/10)`),
      !block.top.length && block.titles.length ? block.titles.slice(0, 4).join(", ") : ""
    ], `#${channel}`));
  }
  const m = stats.music;
  if (m.producers.length || m.rated || m.favorites) grid.append(wrappedCard("music", "Music Lab", m.producers.length || m.rated, m.producers.length ? `producer${m.producers.length === 1 ? "" : "s"} followed` : "ratings", [
    m.producers.length ? m.producers.slice(0, 6).join(", ") + (m.producers.length > 6 ? ` and ${m.producers.length - 6} more` : "") : "",
    m.rated && m.producers.length ? `${m.rated} rating${m.rated === 1 ? "" : "s"}` : "",
    m.favorites ? `${m.favorites} saved` : "",
    ...m.topRated.map((item) => `${item.title}${item.subtitle ? ` – ${item.subtitle}` : ""} (${item.rating}/10)`)
  ], "#music"));
  const b = stats.betting;
  if (b.bets) grid.append(wrappedCard("betting", "Betting", `${b.wins}-${b.losses}${b.pushes ? `-${b.pushes}` : ""}`, "record", [
    `${b.net >= 0 ? "+" : "−"}${wrappedNumber(Math.abs(b.net), 2)} units${b.roi === null ? "" : `, ${b.roi >= 0 ? "+" : "−"}${wrappedNumber(Math.abs(b.roi), 1)}% ROI`}`,
    b.bestSport ? `Best sport: ${b.bestSport}` : "",
    b.best && b.best.profit > 0 ? `Biggest win: ${b.best.title} (+${wrappedNumber(b.best.profit, 2)})` : ""
  ], "#betting"));
  const cr = stats.creator;
  if (cr.published || cr.ideas) grid.append(wrappedCard("creator", "Creator Studio", cr.published, `upload${cr.published === 1 ? "" : "s"} published`, [
    cr.byPlatform.map(([name, count]) => `${count} ${name}`).join(", "),
    cr.ideas ? `${cr.ideas} new idea${cr.ideas === 1 ? "" : "s"}` : ""
  ], "#creator"));
  if (!grid.childElementCount) {
    grid.append(element("p", "wrapped-empty", `Nothing logged for ${year} yet. Concerts in your journal, bowling sessions, finished movies, anime and games, Music Lab follows, settled bets and published uploads all show up here.`));
  }
  page.append(grid);
  page.append(element("p", "wrapped-note", "Movies, anime, games and K-Pop count items moved to the finished column during the year. Betting uses the date each bet was placed."));
  return page;
}
