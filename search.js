// Search everything: one box (the Search button, or press / or Ctrl+K) over saved items in every channel,
// bowling sessions and balls, concerts, Live Events plans and follows, Music Lab, Creator Studio and the headlines.
// Local data is read when the box opens; headlines and the Music Lab catalog are fetched once on first use.

function searchFold(value) {
  return String(value || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function searchSafe(read) {
  try { return read() || []; } catch (error) { console.warn("Search: a source was unavailable.", error); return []; }
}

// Records: { group, title, detail, href, external, text }. `text` holds every searchable field.
function searchLocalRecords(entries, channelList) {
  const records = [];
  const add = (group, title, detail, href, extra = [], external = false) => {
    if (!title) return;
    records.push({ group, title, detail, href, external, text: searchFold([title, detail, ...extra].join(" ")) });
  };
  for (const channel of channelList) add("Channels", `CH ${channel.number} ${channel.name}`, channel.description, `#${channel.id}`);
  const labels = { now: 0, next: 1, done: 2 };
  for (const entry of entries) {
    const channel = channelList.find((item) => item.id === entry.channel);
    if (!channel) continue;
    const column = entry.channel === "betting" ? ({ open: "Open", won: "Won", lost: "Lost", push: "Push" })[entry.status] || "" : channel.labels[labels[entry.status]] || "";
    add("Your lists", entry.title, [channel.name, column].filter(Boolean).join(" · "), `#${entry.channel}`, [entry.note, entry.notes, entry.meta?.title, entry.meta?.director, ...(entry.meta?.genres || [])]);
  }
  const bowling = searchSafe(() => [bowlingGetState()])[0] || {};
  for (const session of bowling.sessions || []) {
    const scores = session.games.map((game) => game.score).filter(Number.isFinite);
    add("Bowling", `${session.league?.name || session.center || "Session"} · ${session.date}`, [session.center, scores.length ? `Games ${scores.join(", ")}` : ""].filter(Boolean).join(" · "), "#bowling", [session.notes, session.type]);
  }
  for (const ball of bowling.balls || []) add("Bowling", ball.name, ["Your arsenal", ball.layout, ball.surface].filter(Boolean).join(" · "), "#bowling", [ball.notes]);
  for (const league of bowling.leagues || []) add("Bowling", league.name, ["League", league.center].filter(Boolean).join(" · "), "#bowling/leagues", [league.team]);
  const live = searchSafe(() => [liveGetState()])[0] || {};
  for (const show of live.journal || []) add("Concerts", show.artist.name, ["Journal", show.date, show.venue, show.city].filter(Boolean).join(" · "), "#live/journal", [show.tour, show.notes, show.favorite, ...(show.lineup || [])]);
  for (const plan of live.plans || []) add("Concerts", plan.event.attractions?.[0]?.name || plan.event.name, [plan.status, plan.event.date, plan.event.venue?.name].filter(Boolean).join(" · "), `#live/event/${plan.event.id}`, [plan.event.name, plan.notes, plan.friends]);
  for (const follow of (live.follows || []).filter((item) => item.following)) add("Concerts", follow.name, "Followed artist", "#live/artists");
  const music = searchSafe(() => [musicLabGetState()])[0] || {};
  for (const item of music.items || []) {
    const [kind, id] = item.key.split(":");
    const href = kind === "person" ? `#music/network/${id}` : kind === "album" ? `#music/album/${id}` : item.release ? `#music/album/${item.release}` : "#music";
    add("Music Lab", item.title, [item.subtitle, item.following ? "Following" : item.favorite ? "Saved" : item.rating ? `Rated ${item.rating}/10` : ""].filter(Boolean).join(" · "), href, [item.note]);
  }
  for (const list of music.lists || []) add("Music Lab", list.name, `List · ${list.items.length} items`, "#music", [list.description, ...list.items.map((item) => item.title)]);
  const creator = searchSafe(() => [creatorGetState()])[0] || {};
  for (const video of creator.videos || []) add("Creator Studio", video.title, "Video library", "#creator/library", [video.description]);
  for (const idea of creator.ideas || []) add("Creator Studio", idea.title, ["Idea", idea.category].filter(Boolean).join(" · "), "#creator/ideas", [idea.description]);
  for (const event of creator.schedule || []) add("Creator Studio", event.title, ["Calendar", event.date, event.status].join(" · "), "#creator/calendar", [event.notes]);
  for (const project of creator.projects || []) add("Creator Studio", project.title || project.source?.title, "Clip project", "#creator/clips");
  return records;
}

let searchRemotePromise = null;
function searchRemoteRecords() {
  searchRemotePromise ||= Promise.allSettled([
    fetch(new URL("data/channel-news.json", location.href)).then((response) => response.ok ? response.json() : null),
    fetch(new URL("data/politics-news.json", location.href)).then((response) => response.ok ? response.json() : null),
    fetch(new URL("data/music-lab.json", location.href)).then((response) => response.ok ? response.json() : null),
    fetch(new URL("data/idols/index.json", location.href)).then((response) => response.ok ? response.json() : null),
    fetch(new URL("data/nba/index.json", location.href)).then((response) => response.ok ? response.json() : null)
  ]).then(([news, politics, musicLab, idols, nbaPlayers]) => {
    const records = [];
    const seen = new Set();
    const headline = (item, channelName) => {
      let url = "";
      try { url = new URL(item.url).protocol === "https:" ? item.url : ""; } catch (error) { url = ""; }
      if (!url || !item.title || seen.has(url)) return;
      seen.add(url);
      const when = Number.isFinite(Date.parse(item.published || "")) ? new Date(item.published).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
      records.push({ group: "Headlines", title: item.title, detail: [item.source, channelName, when].filter(Boolean).join(" · "), href: url, external: true, text: searchFold([item.title, item.source, channelName].join(" ")) });
    };
    const channelNames = typeof channels !== "undefined" ? new Map(channels.map((channel) => [channel.id, channel.name])) : new Map();
    if (news.status === "fulfilled" && news.value) {
      for (const [id, block] of Object.entries(news.value.channels || {})) for (const item of block.items || []) headline(item, channelNames.get(id) || "");
      for (const item of news.value.guide?.items || []) headline(item, "");
    }
    if (politics.status === "fulfilled" && politics.value) for (const item of politics.value.items || []) headline(item, "Politics");
    if (musicLab.status === "fulfilled" && musicLab.value) {
      for (const person of musicLab.value.people || []) {
        if (!person.name || !/^[0-9a-f-]{36}$/.test(person.mbid || "")) continue;
        records.push({ group: "Music Lab", title: person.name, detail: ["Producer and songwriter", person.area].filter(Boolean).join(" · "), href: `#music/network/${person.mbid}`, external: false,
          text: searchFold([person.name, person.sortName, ...(person.aliases || [])].join(" ")) });
      }
    }
    if (idols.status === "fulfilled" && idols.value) {
      const groupNames = new Map((idols.value.groups || []).map((group) => [group.id, group.n]));
      for (const group of idols.value.groups || []) {
        records.push({ group: "K-pop idols", title: group.n, detail: ["Group", group.k, group.d ? `debut ${group.d.slice(0, 4)}` : "", group.x ? "disbanded" : ""].filter(Boolean).join(" · "),
          href: `#kpop/group/${group.id}`, external: false, text: searchFold([group.n, group.k, ...(group.a || []), ...(group.ag || [])].join(" ")) });
      }
      for (const person of idols.value.people || []) {
        const groups = (person.g || []).map((id) => groupNames.get(id)).filter(Boolean);
        records.push({ group: "K-pop idols", title: person.n, detail: [person.k, groups.slice(0, 2).join(", ") || "Soloist"].filter(Boolean).join(" · "),
          href: `#kpop/idol/${person.id}`, external: false, text: searchFold([person.n, person.k, ...(person.a || []), ...groups].join(" ")) });
      }
    }
    if (nbaPlayers.status === "fulfilled" && nbaPlayers.value) {
      for (const player of nbaPlayers.value.players || []) {
        const years = player.a ? `${player.from - 1}–now` : `${player.from - 1}–${player.to}`;
        records.push({ group: "NBA players", title: player.n, detail: [player.pos, years, (player.t || []).slice(0, 3).join(", "), player.ppg != null ? `${player.ppg} PPG` : ""].filter(Boolean).join(" · "),
          href: `#sports/players/${player.id}`, external: false, text: searchFold([player.n, player.c, ...(player.t || [])].join(" ")) });
      }
    }
    return records;
  });
  return searchRemotePromise;
}

// Every word must match; titles that start with the query rank first, then title matches, then other fields.
function searchRank(records, query, limitPerGroup = 6) {
  const words = searchFold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const folded = searchFold(query).trim();
  const scored = [];
  const seen = new Set();
  for (const record of records) {
    if (!words.every((word) => record.text.includes(word))) continue;
    const key = `${record.group}|${record.title}|${record.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = searchFold(record.title);
    const score = title === folded ? 0 : title.startsWith(folded) ? 1 : words.every((word) => title.includes(word)) ? 2 : 3;
    scored.push({ record, score });
  }
  scored.sort((a, b) => a.score - b.score || a.record.title.length - b.record.title.length);
  const counts = new Map();
  const groups = new Map();
  for (const { record } of scored) {
    const count = counts.get(record.group) || 0;
    counts.set(record.group, count + 1);
    if (count >= limitPerGroup) continue;
    if (!groups.has(record.group)) groups.set(record.group, []);
    groups.get(record.group).push(record);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items, total: counts.get(group) }));
}

function createSiteSearch({ getEntries, channelList }) {
  const dialog = element("dialog", "site-search");
  dialog.setAttribute("aria-label", "Search everything");
  const form = element("form", "site-search-form");
  form.method = "dialog";
  const input = element("input");
  input.type = "search";
  input.placeholder = "Search your lists, bowling, concerts, Music Lab, headlines…";
  input.setAttribute("aria-label", "Search everything");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-controls", "site-search-results");
  input.setAttribute("aria-expanded", "true");
  input.autocomplete = "off";
  const close = element("button", "secondary", "Close");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  form.append(input, close);
  const status = element("p", "site-search-status");
  status.setAttribute("role", "status");
  const results = element("div", "site-search-results");
  results.id = "site-search-results";
  results.setAttribute("role", "listbox");
  dialog.append(form, status, results);
  document.body.append(dialog);

  let local = [];
  let remote = [];
  let remoteLoaded = false;
  let active = -1;
  const options = () => [...results.querySelectorAll("[role=option]")];
  function setActive(index) {
    const list = options();
    active = list.length ? (index + list.length) % list.length : -1;
    list.forEach((option, position) => option.setAttribute("aria-selected", String(position === active)));
    if (active >= 0) {
      input.setAttribute("aria-activedescendant", list[active].id);
      list[active].scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }
  function render() {
    const query = input.value.trim();
    results.replaceChildren();
    active = -1;
    if (!query) {
      status.textContent = "Type to search everything you’ve saved, plus the latest headlines.";
      return;
    }
    const groups = searchRank([...local, ...remote], query);
    let index = 0;
    for (const { group, items, total } of groups) {
      const section = element("div", "site-search-group");
      section.setAttribute("role", "group");
      section.setAttribute("aria-label", group);
      section.append(element("h3", "", total > items.length ? `${group} · ${items.length} of ${total}` : group));
      for (const item of items) {
        const link = element("a", "site-search-result");
        link.href = item.href;
        link.id = `site-search-option-${index++}`;
        link.setAttribute("role", "option");
        link.setAttribute("aria-selected", "false");
        if (item.external) {
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
        link.append(element("strong", "", item.title));
        if (item.detail) link.append(element("small", "", item.detail));
        link.addEventListener("click", () => { if (!item.external) dialog.close(); });
        section.append(link);
      }
      results.append(section);
    }
    const count = groups.reduce((sum, group) => sum + group.total, 0);
    status.textContent = count ? `${count} result${count === 1 ? "" : "s"}${remoteLoaded ? "" : " (headlines still loading)"}` : remoteLoaded ? "No matches." : "No matches yet. Still loading headlines…";
  }
  input.addEventListener("input", render);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(active + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = options()[active >= 0 ? active : 0];
      target?.click();
    }
  });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

  function open() {
    local = searchLocalRecords(getEntries(), channelList);
    if (!dialog.open) dialog.showModal();
    input.select();
    render();
    searchRemoteRecords().then((records) => {
      remote = records;
      remoteLoaded = true;
      if (dialog.open) render();
    });
  }
  document.addEventListener("keydown", (event) => {
    const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
    if ((event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) || (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey))) {
      event.preventDefault();
      open();
    }
  });
  return { open, dialog };
}
