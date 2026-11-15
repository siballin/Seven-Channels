// Creator Studio channel (#creator): dashboard, channel stats, video library, idea board, content calendar
// and analytics. The reaction clip workspace lives in creator-clips.js. Uses the app's element()/showNotice().

let creatorRoot = null;
const creatorUi = {
  editing: null, // { collection, id } while a form is open; id "" for a new record
  draft: null,
  library: { query: "", status: "all", format: "all", category: "all", sort: "recent" },
  ideas: { query: "", status: "all", priority: "all", platform: "all", category: "all", sort: "priority" },
  calendar: { view: "month", cursor: "" },
  analyticsVideo: "",
  status: "",
  statusError: false,
  busy: false,
  confirm: ""
};
const creatorTypeColors = { youtube: "var(--cs-c1)", short: "var(--cs-c2)", tiktok: "var(--cs-c3)", reels: "var(--cs-c4)", live: "var(--cs-c5)" };
const creatorPlatformLabels = Object.fromEntries(creatorPlatforms);

function creatorRoute() {
  const parts = location.hash.replace(/^#creator\/?/, "").split("/");
  const view = ["library", "clips", "calendar", "ideas", "analytics", "channel"].includes(parts[0]) ? parts[0] : "home";
  return { view, id: parts[1] ? decodeURIComponent(parts[1]) : "" };
}

function creatorRefresh(focusId) {
  if (!creatorRoot?.isConnected) return;
  // The clip workspace keeps its embedded player; only its panels are redrawn.
  if (creatorRoute().view === "clips" && creatorRoute().id && typeof creatorClipsRefreshPanels === "function" && creatorClipsRefreshPanels()) return;
  const activeId = focusId || document.activeElement?.id;
  const scroll = window.scrollY;
  const previous = creatorRoot;
  const next = createCreatorStudio();
  previous.replaceWith(next);
  if (!focusId) window.scrollTo(0, scroll);
  if (activeId) document.getElementById(activeId)?.focus({ preventScroll: !focusId });
}

function creatorSetStatus(text, error = false) {
  creatorUi.status = text;
  creatorUi.statusError = error;
}

// ---------- Building blocks ----------

function csEl(tag, className, text) {
  return element(tag, className, text);
}

function csLink(text, href, className = "") {
  const link = csEl("a", className, text);
  link.href = href;
  return link;
}

function csButton(text, onClick, className = "secondary", id = "") {
  const button = csEl("button", className, text);
  button.type = "button";
  if (id) button.id = id;
  button.addEventListener("click", onClick);
  return button;
}

function csPanel(title, id, className = "") {
  const panel = csEl("section", `cs-panel ${className}`.trim());
  const heading = csEl("h3", "", title);
  heading.id = id;
  heading.tabIndex = -1;
  panel.setAttribute("aria-labelledby", id);
  panel.append(heading);
  return panel;
}

function csEmpty(text, action) {
  const box = csEl("div", "cs-empty");
  box.append(csEl("p", "", text));
  if (action) box.append(action);
  return box;
}

function csField(labelText, control, hint) {
  const field = csEl("div", "field");
  const label = csEl("label", "", labelText);
  label.htmlFor = control.id;
  field.append(label, control);
  if (hint) field.append(csEl("small", "cs-hint", hint));
  return field;
}

function csInput(id, value, { type = "text", placeholder = "", maxLength, list } = {}) {
  const input = document.createElement("input");
  input.id = id;
  input.type = type;
  input.value = value ?? "";
  if (placeholder) input.placeholder = placeholder;
  if (maxLength) input.maxLength = maxLength;
  if (list) input.setAttribute("list", list);
  return input;
}

function csSelect(id, options, value) {
  const select = document.createElement("select");
  select.id = id;
  for (const option of options) {
    const [optionValue, label] = Array.isArray(option) ? option : [option, option];
    const node = csEl("option", "", label);
    node.value = optionValue;
    node.selected = optionValue === value;
    select.append(node);
  }
  return select;
}

function csTextarea(id, value, placeholder = "", rows = 3) {
  const area = document.createElement("textarea");
  area.id = id;
  area.value = value ?? "";
  area.placeholder = placeholder;
  area.rows = rows;
  return area;
}

function csDatalist(id, values) {
  const list = document.createElement("datalist");
  list.id = id;
  for (const value of [...new Set(values.filter(Boolean))].sort()) {
    const option = document.createElement("option");
    option.value = value;
    list.append(option);
  }
  return list;
}

function csThumb(src, title, className = "cs-thumb") {
  const frame = csEl("span", `${className} cs-media`);
  if (src) {
    const image = document.createElement("img");
    image.src = src;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => image.remove(), { once: true });
    frame.append(image);
  } else {
    frame.append(csEl("span", "cs-thumb-fallback", "▶"));
  }
  frame.title = title || "";
  return frame;
}

function csDate(value, options = { month: "short", day: "numeric", year: "numeric" }) {
  if (!value) return "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, options).format(date);
}

function csBadge(text, className = "") {
  return csEl("span", `cs-badge ${className}`.trim(), text);
}

function csStatusBadge(status) {
  return csBadge(status, `cs-status-${status.toLowerCase()}`);
}

function csTypeChip(type) {
  const chip = csEl("span", "cs-type", creatorPlatformLabels[type] || type);
  chip.style.setProperty("--cs-type", creatorTypeColors[type] || "var(--muted)");
  return chip;
}

function csStatusLine() {
  const line = csEl("p", `cs-status-line${creatorUi.statusError ? " error" : ""}`, creatorUi.status);
  line.id = "cs-status";
  line.setAttribute("role", "status");
  line.tabIndex = -1;
  return line;
}

function csConfirmButton(key, label, onConfirm) {
  const armed = creatorUi.confirm === key;
  const button = csButton(armed ? `Confirm ${label.toLowerCase()}` : label, () => {
    if (!armed) {
      creatorUi.confirm = key;
      creatorRefresh(button.id);
      return;
    }
    creatorUi.confirm = "";
    onConfirm();
  }, "secondary cs-danger", `cs-confirm-${key.replace(/[^\w-]/g, "-")}`);
  button.addEventListener("blur", () => setTimeout(() => {
    if (button.isConnected && creatorUi.confirm === key) {
      creatorUi.confirm = "";
      button.textContent = label;
    }
  }, 0));
  return button;
}

// ---------- Shell ----------

function createCreatorTabs(active) {
  const nav = csEl("nav", "cs-tabs");
  nav.setAttribute("aria-label", "Creator Studio sections");
  for (const [view, label, href] of [["home", "Dashboard", "#creator"], ["library", "Video library", "#creator/library"], ["clips", "Clip workspace", "#creator/clips"],
    ["calendar", "Calendar", "#creator/calendar"], ["ideas", "Ideas", "#creator/ideas"], ["analytics", "Analytics", "#creator/analytics"], ["channel", "Channel", "#creator/channel"]]) {
    const link = csLink(label, href);
    if (view === active) link.setAttribute("aria-current", "page");
    nav.append(link);
  }
  return nav;
}

function createCreatorStudio() {
  const route = creatorRoute();
  const root = csEl("div", "creator-studio");
  root.append(createCreatorTabs(route.view));
  const views = {
    home: createCreatorDashboard, library: createCreatorLibrary, calendar: createCreatorCalendar, ideas: createCreatorIdeas,
    analytics: createCreatorAnalytics, channel: createCreatorChannel,
    clips: () => (typeof createCreatorClips === "function" ? createCreatorClips(route.id) : csEmpty("The clip workspace couldn’t load."))
  };
  if (creatorUi.status) root.append(csStatusLine());
  root.append(views[route.view]());
  creatorRoot = root;
  return root;
}

// ---------- Dashboard ----------

function creatorMetric(label, value, note) {
  const tile = csEl("div", "cs-metric");
  tile.append(csEl("span", "", label), csEl("strong", "", value));
  if (note) tile.append(csEl("small", "", note));
  return tile;
}

function creatorUpcoming(state, days = 14) {
  const today = creatorToday();
  const end = new Date(`${today}T00:00:00`);
  end.setDate(end.getDate() + days);
  const limit = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  return creatorCalendarItems(state).filter((item) => item.date >= today && item.date <= limit && item.status !== "published")
    .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
}

function creatorActivity(state, limit = 10) {
  const rows = [
    ...state.videos.map((item) => ({ when: item.updatedAt, text: `${item.title} · ${item.status}`, href: "#creator/library", kind: "Video" })),
    ...state.ideas.map((item) => ({ when: item.updatedAt, text: item.title, href: "#creator/ideas", kind: "Idea" })),
    ...state.schedule.map((item) => ({ when: item.updatedAt, text: `${item.title} · ${csDate(item.date, { month: "short", day: "numeric" })}`, href: "#creator/calendar", kind: "Calendar" })),
    ...state.projects.map((item) => ({ when: item.updatedAt, text: `${item.source.title} · ${item.clips.length} clip${item.clips.length === 1 ? "" : "s"}`, href: `#creator/clips/${encodeURIComponent(item.id)}`, kind: "Clips" }))
  ];
  return rows.filter((row) => row.when).sort((a, b) => b.when.localeCompare(a.when)).slice(0, limit);
}

function createCreatorDashboard() {
  const state = creatorGetState();
  const wrap = csEl("div", "cs-dashboard");
  const channel = state.channel;
  const metrics = csEl("div", "cs-metrics");
  const latestSnapshot = state.snapshots.at(-1);
  if (channel) {
    metrics.append(
      creatorMetric("Subscribers", channel.hiddenSubscribers ? "Hidden" : creatorFormatCount(channel.subscribers), channel.hiddenSubscribers ? "This channel hides its count" : `As of ${csDate(channel.fetchedAt)}`),
      creatorMetric("Channel views", creatorFormatCount(channel.views), `As of ${csDate(channel.fetchedAt)}`)
    );
  } else if (latestSnapshot) {
    metrics.append(creatorMetric("Subscribers", creatorFormatCount(latestSnapshot.subscribers), `Entered for ${csDate(latestSnapshot.date)}`),
      creatorMetric("Channel views", creatorFormatCount(latestSnapshot.views), `Entered for ${csDate(latestSnapshot.date)}`));
  } else {
    const connect = csEl("div", "cs-metric cs-metric-cta");
    connect.append(csEl("span", "", "Channel stats"), csEl("strong", "", "Not connected"), csLink("Connect your channel or enter stats", "#creator/channel", "cs-text-link"));
    metrics.append(connect);
  }
  const inProduction = state.videos.filter((video) => ["Recorded", "Editing", "Ready"].includes(video.status));
  metrics.append(creatorMetric("In production", String(inProduction.length), "Recorded, editing or ready"),
    creatorMetric("Idea backlog", String(state.ideas.filter((idea) => idea.status === "Idea").length), `${state.ideas.filter((idea) => idea.priority === "high" && idea.status === "Idea").length} high priority`));
  wrap.append(metrics);

  const grid = csEl("div", "cs-grid");
  const uploads = state.videos.filter((video) => video.youtubeId && video.publishedAt).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const recent = csPanel("Recent uploads", "cs-recent-title", "cs-span-2");
  if (uploads.length) {
    const row = csEl("div", "cs-card-row");
    for (const video of uploads.slice(0, 6)) row.append(creatorVideoCard(video, { compact: true }));
    recent.append(row);
  } else {
    recent.append(csEmpty(channel ? "Refresh your channel to pull in recent uploads." : "Connect your channel to see your uploads here, or add videos by hand in the library.", csLink(channel ? "Refresh on the Channel page" : "Connect your channel", "#creator/channel", "cs-text-link")));
  }
  grid.append(recent);

  const performance = csPanel("Recent performance", "cs-performance-title");
  const measured = uploads.filter((video) => video.views !== null).slice(0, 5);
  if (measured.length) {
    const table = csEl("table", "cs-table");
    table.innerHTML = "<thead><tr><th scope=\"col\">Video</th><th scope=\"col\">Views</th><th scope=\"col\">Per day</th><th scope=\"col\">Engagement</th></tr></thead>";
    const body = csEl("tbody");
    for (const video of measured) {
      const days = Math.max(1, (Date.parse(video.statsAt || video.updatedAt) - Date.parse(video.publishedAt)) / 86400000);
      const engagement = creatorEngagement(video);
      const row = csEl("tr");
      const name = csEl("th", "", video.title);
      name.scope = "row";
      row.append(name, csEl("td", "", creatorFormatCount(video.views)), csEl("td", "", creatorFormatCount(Math.round(video.views / days))),
        csEl("td", "", engagement === null ? "—" : `${(engagement * 100).toFixed(1)}%`));
      body.append(row);
    }
    table.append(body);
    performance.append(table, csEl("p", "cs-hint", "Public counts from the YouTube Data API at your last refresh. Per day = views ÷ days since publishing. Watch time, impressions and click-through rate need private YouTube Analytics access (see the Channel page)."));
  } else {
    performance.append(csEmpty("No view counts yet. They appear after you refresh a connected channel or enter them on a video."));
  }
  grid.append(performance);

  const upcoming = csPanel("Upcoming (next 14 days)", "cs-upcoming-title");
  const soon = creatorUpcoming(state);
  upcoming.append(soon.length ? creatorItemList(soon) : csEmpty("Nothing scheduled in the next two weeks.", csLink("Open the calendar", "#creator/calendar", "cs-text-link")));
  grid.append(upcoming);

  const editing = csPanel("Awaiting editing", "cs-editing-title");
  const awaiting = state.videos.filter((video) => video.status === "Recorded" || video.status === "Editing");
  editing.append(awaiting.length ? creatorSimpleList(awaiting.map((video) => ({ title: video.title, meta: `${video.status}${video.format === "short" ? " · Short" : ""}`, href: "#creator/library" })))
    : csEmpty("No recorded videos are waiting on an edit."));
  grid.append(editing);

  const shorts = csPanel("Unpublished Shorts", "cs-shorts-title");
  const pendingShorts = state.videos.filter((video) => video.format === "short" && video.status !== "Published");
  const pendingClips = state.projects.flatMap((project) => project.clips.filter((clip) => ["Approved", "Editing", "Exported"].includes(clip.status)).map((clip) => ({ project, clip })));
  const shortRows = [
    ...pendingShorts.map((video) => ({ title: video.title, meta: `Short · ${video.status}`, href: "#creator/library" })),
    ...pendingClips.map(({ project, clip }) => ({ title: clip.title || `Clip at ${creatorFormatTime(clip.start)}`, meta: `Clip · ${clip.status} · from ${project.source.title}`, href: `#creator/clips/${encodeURIComponent(project.id)}` }))
  ];
  shorts.append(shortRows.length ? creatorSimpleList(shortRows.slice(0, 8)) : csEmpty("No Shorts or approved clips waiting to be posted."));
  grid.append(shorts);

  const backlog = csPanel("Idea backlog", "cs-backlog-title");
  const rank = { high: 0, medium: 1, low: 2 };
  const top = state.ideas.filter((idea) => idea.status === "Idea").sort((a, b) => rank[a.priority] - rank[b.priority] || b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  backlog.append(top.length ? creatorSimpleList(top.map((idea) => ({ title: idea.title, meta: `${Object.fromEntries(creatorPriorities)[idea.priority]} priority · ${creatorPlatformLabels[idea.platform]}`, href: "#creator/ideas" })))
    : csEmpty("No ideas yet.", csLink("Add an idea", "#creator/ideas", "cs-text-link")));
  grid.append(backlog);

  const activity = csPanel("Production activity", "cs-activity-title");
  const recentActivity = creatorActivity(state);
  activity.append(recentActivity.length ? creatorSimpleList(recentActivity.map((row) => ({ title: row.text, meta: `${row.kind} · ${csDate(row.when, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`, href: row.href })))
    : csEmpty("Changes to videos, ideas, the calendar and clips show up here."));
  grid.append(activity);
  wrap.append(grid);
  return wrap;
}

function creatorSimpleList(rows) {
  const list = csEl("ul", "cs-simple-list");
  for (const row of rows) {
    const item = csEl("li");
    item.append(row.href ? csLink(row.title, row.href) : csEl("span", "", row.title), csEl("small", "", row.meta || ""));
    list.append(item);
  }
  return list;
}

function creatorItemList(items) {
  const list = csEl("ul", "cs-simple-list");
  for (const item of items) {
    const row = csEl("li", "cs-typed");
    row.style.setProperty("--cs-type", creatorTypeColors[item.type] || "var(--muted)");
    row.append(csLink(item.title, item.href), csEl("small", "", `${creatorPlatformLabels[item.type]} · ${csDate(item.date, { weekday: "short", month: "short", day: "numeric" })}${item.time ? ` · ${item.time}` : ""} · ${item.kindLabel}`));
    list.append(row);
  }
  return list;
}

// ---------- Channel ----------

function createCreatorChannel() {
  const state = creatorGetState();
  const wrap = csEl("div", "cs-stack");
  const panel = csPanel("Your YouTube channel", "cs-channel-title");
  const key = creatorApiKey();
  if (!key) {
    const note = csEl("div", "cs-banner");
    note.append(csEl("span", "", "Public channel stats need a YouTube Data API key. Add one in the YouTube settings at the top of the page; it stays in this browser only."),
      csButton("Open YouTube settings", () => {
        const settings = document.getElementById("youtube-key-settings");
        if (settings) {
          settings.open = true;
          settings.scrollIntoView({ block: "center", behavior: "smooth" });
          document.getElementById("youtube-api-key")?.focus();
        }
      }));
    panel.append(note);
  }
  if (state.channel) {
    const head = csEl("div", "cs-channel-head");
    head.append(csThumb(state.channel.thumbnail, state.channel.title, "cs-avatar"));
    const copy = csEl("div");
    copy.append(csEl("strong", "", state.channel.title), csEl("p", "cs-hint", `${state.channel.handle || state.channel.id} · last refreshed ${csDate(state.channel.fetchedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`));
    const link = csLink("Open on YouTube ↗", `https://www.youtube.com/channel/${state.channel.id}`, "cs-text-link");
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    copy.append(link);
    head.append(copy);
    panel.append(head);
    const metrics = csEl("div", "cs-metrics");
    metrics.append(creatorMetric("Subscribers", state.channel.hiddenSubscribers ? "Hidden" : creatorFormatCount(state.channel.subscribers)),
      creatorMetric("Views", creatorFormatCount(state.channel.views)), creatorMetric("Public videos", creatorFormatCount(state.channel.videos)));
    panel.append(metrics);
    const actions = csEl("div", "cs-actions");
    actions.append(csButton(creatorUi.busy ? "Refreshing…" : "Refresh stats and uploads", async () => {
      if (creatorUi.busy) return;
      creatorUi.busy = true;
      creatorRefresh("cs-refresh");
      try {
        const result = await creatorRefreshChannel();
        creatorSetStatus(`Refreshed: ${result.added} new upload${result.added === 1 ? "" : "s"} added, ${result.updated} updated, and today’s stats recorded.`);
      } catch (error) {
        creatorSetStatus(error.message, true);
      }
      creatorUi.busy = false;
      creatorRefresh("cs-status");
    }, "", "cs-refresh"), csConfirmButton("disconnect", "Disconnect", () => {
      creatorCommit((next) => { next.channel = null; });
      creatorSetStatus("Channel disconnected. Your library, snapshots and plans are kept.");
      creatorRefresh("cs-status");
    }));
    panel.append(actions, csEl("p", "cs-hint", "Each refresh records that day’s subscriber and view totals, so charts build a real history from the day you connect. YouTube’s public API doesn’t provide past totals, and none are made up."));
  } else {
    const form = csEl("form", "cs-form-row");
    const input = csInput("cs-channel-input", "", { placeholder: "@yourhandle, channel URL, or UC… ID" });
    const submit = csEl("button", "", creatorUi.busy ? "Looking up…" : "Connect channel");
    submit.type = "submit";
    form.append(csField("Channel", input), submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (creatorUi.busy) return;
      creatorUi.busy = true;
      try {
        const channel = await creatorLookupChannel(input.value);
        creatorCommit((next, now) => { next.channel = { ...channel, updatedAt: now }; });
        const result = await creatorRefreshChannel();
        creatorSetStatus(`Connected ${channel.title}. ${result.added} upload${result.added === 1 ? "" : "s"} added to your library.`);
      } catch (error) {
        creatorSetStatus(error.message, true);
      }
      creatorUi.busy = false;
      creatorRefresh("cs-status");
    });
    panel.append(form, csEl("p", "cs-hint", "Uses YouTube’s public data only: subscriber count (unless hidden), total views, and your uploads’ titles, thumbnails, dates, durations, views, likes and comments."));
  }
  wrap.append(panel);

  const manual = csPanel("Record stats by hand", "cs-manual-title");
  manual.append(csEl("p", "cs-hint", "No API key? Enter your totals from YouTube Studio whenever you like. Each entry is one day’s snapshot, used by the dashboard and analytics."));
  const form = csEl("form", "cs-form-row");
  const date = csInput("cs-snap-date", creatorToday(), { type: "date" });
  const subs = csInput("cs-snap-subs", "", { type: "number" });
  subs.min = "0";
  const views = csInput("cs-snap-views", "", { type: "number" });
  views.min = "0";
  const save = csEl("button", "", "Save snapshot");
  save.type = "submit";
  form.append(csField("Date", date), csField("Subscribers", subs), csField("Total views", views), save);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const subscribers = subs.value === "" ? null : Number(subs.value);
    const total = views.value === "" ? null : Number(views.value);
    if (!creatorDate(date.value) || (subscribers === null && total === null)) {
      creatorSetStatus("Enter a date and at least one number.", true);
      creatorRefresh("cs-status");
      return;
    }
    creatorCommit((next) => {
      const old = next.snapshots.find((item) => item.date === date.value) || {};
      next.snapshots = [...next.snapshots.filter((item) => item.date !== date.value), { ...old, date: date.value, subscribers: subscribers ?? old.subscribers ?? null, views: total ?? old.views ?? null }];
    });
    creatorSetStatus(`Saved the snapshot for ${csDate(date.value)}.`);
    creatorRefresh("cs-status");
  });
  manual.append(form);
  if (state.snapshots.length) {
    const details = csEl("details", "cs-details");
    details.append(csEl("summary", "", `${state.snapshots.length} recorded snapshot${state.snapshots.length === 1 ? "" : "s"}`));
    details.append(creatorTable(["Date", "Subscribers", "Views", "Videos"], [...state.snapshots].reverse().map((item) => [csDate(item.date), creatorFormatCount(item.subscribers), creatorFormatCount(item.views), creatorFormatCount(item.videos)])));
    manual.append(details);
  }
  wrap.append(manual);

  const oauth = csPanel("Private analytics (watch time, retention, impressions, CTR)", "cs-oauth-title");
  oauth.append(csEl("p", "", "Not connected. These metrics come only from the YouTube Analytics API, which needs you to sign in with Google (OAuth). Doing that safely needs a small server to hold the OAuth client secret and refresh token, so it can’t run from this static GitHub Pages site on its own."),
    csEl("p", "cs-hint", "The README’s Creator Studio section describes an optional setup with a Supabase Edge Function. Until it’s configured, Creator Studio shows only public stats and what you enter yourself, and marks private metrics as unavailable."));
  wrap.append(oauth);
  return wrap;
}

function creatorTable(headers, rows) {
  const table = csEl("table", "cs-table");
  const head = csEl("thead");
  const headRow = csEl("tr");
  for (const header of headers) {
    const cell = csEl("th", "", header);
    cell.scope = "col";
    headRow.append(cell);
  }
  head.append(headRow);
  const body = csEl("tbody");
  for (const row of rows) {
    const tr = csEl("tr");
    row.forEach((value, index) => {
      const cell = csEl(index ? "td" : "th", "", value);
      if (!index) cell.scope = "row";
      tr.append(cell);
    });
    body.append(tr);
  }
  table.append(head, body);
  return table;
}

// ---------- Video library ----------

function creatorVideoCard(video, { compact = false } = {}) {
  const state = creatorGetState();
  const card = csEl("article", `cs-video${compact ? " is-compact" : ""}`);
  card.dataset.id = video.id;
  const thumb = csThumb(video.thumbnail, video.title);
  if (video.duration !== null) thumb.append(csEl("span", "cs-duration", creatorFormatTime(video.duration)));
  if (video.youtubeId) {
    const link = csLink("", `https://www.youtube.com/watch?v=${video.youtubeId}`, "cs-thumb-link");
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `Watch ${video.title} on YouTube`);
    link.append(thumb);
    card.append(link);
  } else {
    card.append(thumb);
  }
  const body = csEl("div", "cs-video-body");
  body.append(csEl("strong", "cs-video-title", video.title));
  const when = video.publishedAt ? `Published ${csDate(video.publishedAt)}` : video.plannedDate ? `Planned ${csDate(video.plannedDate)}` : "No date";
  const meta = csEl("p", "cs-meta");
  meta.append(csStatusBadge(video.status), ` ${video.format === "short" ? "Short" : video.format === "long" ? "Long-form" : ""}${video.category ? ` · ${video.category}` : ""} · ${when}`);
  body.append(meta);
  if (!compact) {
    const engagement = creatorEngagement(video);
    const stats = csEl("p", "cs-stats");
    stats.append(`${creatorFormatCount(video.views)} views · ${creatorFormatCount(video.likes)} likes · ${creatorFormatCount(video.comments)} comments · ${engagement === null ? "engagement —" : `${(engagement * 100).toFixed(1)}% engagement`}`);
    if (video.views === null) stats.title = "No public stats yet";
    body.append(stats);
    if (video.notes) body.append(csEl("p", "cs-notes", video.notes.length > 180 ? `${video.notes.slice(0, 177)}…` : video.notes));
    const shorts = state.videos.filter((item) => item.parentId === video.id);
    if (shorts.length) {
      const list = csEl("p", "cs-children");
      list.append(csEl("span", "cs-hint", "Shorts: "), shorts.map((item) => `${item.title} (${item.status})`).join(", "));
      body.append(list);
    }
    const parent = video.parentId ? state.videos.find((item) => item.id === video.parentId) : null;
    if (parent) body.append(csEl("p", "cs-hint", `Short from “${parent.title}”`));
    const actions = csEl("div", "cs-actions");
    const status = csSelect(`cs-video-status-${video.id}`, creatorStatuses, video.status);
    status.setAttribute("aria-label", `Status of ${video.title}`);
    status.addEventListener("change", () => {
      creatorUpsert("videos", { ...video, status: status.value });
      creatorRefresh(status.id);
    });
    actions.append(status, csButton("Edit", () => creatorOpenEditor("videos", video.id), "secondary", `cs-edit-${video.id}`));
    if (video.youtubeId) actions.append(csButton("Clip workspace", () => creatorOpenClipProject(video)));
    actions.append(csConfirmButton(`video-${video.id}`, "Delete", () => {
      creatorRemove("videos", video.id);
      creatorSetStatus(`Deleted “${video.title}”.`);
      creatorRefresh("cs-status");
    }));
    body.append(actions);
  }
  card.append(body);
  return card;
}

function creatorOpenClipProject(video) {
  const state = creatorGetState();
  let project = state.projects.find((item) => item.videoId === video.id || (video.youtubeId && item.source.youtubeId === video.youtubeId));
  if (!project) {
    const id = creatorId("clips");
    creatorUpsert("projects", { id, source: { youtubeId: video.youtubeId, title: video.title, duration: video.duration }, videoId: video.id, chapters: [], transcript: [], moments: [], clips: [] });
    project = { id };
  }
  location.hash = `#creator/clips/${encodeURIComponent(project.id)}`;
}

function creatorOpenEditor(collection, id = "", preset = {}) {
  const record = id ? creatorGetState()[collection].find((item) => item.id === id) : null;
  creatorUi.editing = { collection, id };
  creatorUi.draft = record ? structuredClone(record) : { ...preset };
  creatorRefresh(`cs-form-${collection}-title`);
  requestAnimationFrame(() => document.getElementById(`cs-form-${collection}`)?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
}

function creatorCloseEditor(focusId) {
  creatorUi.editing = null;
  creatorUi.draft = null;
  creatorRefresh(focusId);
}

function createCreatorVideoForm() {
  const state = creatorGetState();
  const draft = creatorUi.draft || {};
  const editing = Boolean(creatorUi.editing?.id);
  const form = csEl("form", "cs-panel cs-form");
  form.id = "cs-form-videos";
  form.noValidate = true;
  const heading = csEl("h3", "", editing ? `Edit “${draft.title}”` : "Add a video");
  heading.id = "cs-form-videos-title";
  heading.tabIndex = -1;
  const title = csInput("cs-v-title", draft.title, { maxLength: creatorLimits.title });
  const url = csInput("cs-v-url", draft.youtubeId ? `https://www.youtube.com/watch?v=${draft.youtubeId}` : "", { placeholder: "https://youtu.be/… (optional)" });
  const status = csSelect("cs-v-status", creatorStatuses, draft.status || "Idea");
  const format = csSelect("cs-v-format", [["long", "Long-form"], ["short", "Short"]], draft.format || "long");
  const parent = csSelect("cs-v-parent", [["", "None"], ...state.videos.filter((video) => video.id !== draft.id && video.format !== "short").map((video) => [video.id, video.title])], draft.parentId || "");
  const category = csInput("cs-v-category", draft.category, { list: "cs-categories", placeholder: "e.g. K-pop reaction" });
  const planned = csInput("cs-v-planned", draft.plannedDate, { type: "date" });
  const published = csInput("cs-v-published", draft.publishedAt ? draft.publishedAt.slice(0, 10) : "", { type: "date" });
  const duration = csInput("cs-v-duration", draft.duration ? creatorFormatTime(draft.duration) : "", { placeholder: "12:34" });
  const views = csInput("cs-v-views", draft.views ?? "", { type: "number" });
  const likes = csInput("cs-v-likes", draft.likes ?? "", { type: "number" });
  const comments = csInput("cs-v-comments", draft.comments ?? "", { type: "number" });
  const notes = csTextarea("cs-v-notes", draft.notes, "Edit notes, B-roll, thumbnail ideas");
  const synced = Boolean(draft.youtubeId && draft.statsAt);
  [views, likes, comments].forEach((input) => { input.min = "0"; input.disabled = synced; });
  const grid = csEl("div", "cs-form-grid");
  grid.append(csField("Title", title), csField("YouTube link", url, "Linking a video lets refreshes keep its public stats current."), csField("Status", status), csField("Format", format),
    csField("Short from video", parent, "For Shorts cut from a full video."), csField("Category", category), csField("Planned date", planned), csField("Published", published),
    csField("Length", duration), csField("Views", views, synced ? "From YouTube at the last refresh." : "Optional, from YouTube Studio."), csField("Likes", likes), csField("Comments", comments));
  const notesField = csField("Notes", notes);
  notesField.classList.add("cs-wide");
  grid.append(notesField, csDatalist("cs-categories", [...state.videos.map((video) => video.category), ...state.ideas.map((idea) => idea.category)]));
  const actions = csEl("div", "cs-actions");
  const save = csEl("button", "", editing ? "Save video" : "Add video");
  save.type = "submit";
  actions.append(save, csButton("Cancel", () => creatorCloseEditor("cs-library-title")));
  const error = csEl("p", "cs-status-line error");
  error.setAttribute("role", "alert");
  form.append(heading, grid, actions, error);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const youtubeId = url.value.trim() ? creatorYoutubeId(url.value) : "";
    const seconds = duration.value.trim() ? creatorParseTime(duration.value) : null;
    const problem = !title.value.trim() ? [title, "Give the video a title."]
      : url.value.trim() && !youtubeId ? [url, "That doesn’t look like a YouTube video link."]
        : duration.value.trim() && seconds === null ? [duration, "Write the length like 12:34 or 1:02:03."] : null;
    if (problem) {
      error.textContent = problem[1];
      problem[0].setAttribute("aria-invalid", "true");
      problem[0].focus();
      return;
    }
    const number = (input) => (input.value === "" ? null : Math.max(0, Number(input.value)));
    const record = { ...draft, id: draft.id || creatorId("video"), title: title.value, youtubeId, status: status.value, format: format.value,
      parentId: format.value === "short" ? parent.value : "", category: category.value, plannedDate: planned.value,
      publishedAt: published.value ? (draft.publishedAt?.slice(0, 10) === published.value ? draft.publishedAt : `${published.value}T12:00:00Z`) : "",
      duration: seconds, notes: notes.value, thumbnail: youtubeId && youtubeId !== draft.youtubeId ? "" : draft.thumbnail || "" };
    if (!synced) Object.assign(record, { views: number(views), likes: number(likes), comments: number(comments) });
    creatorUpsert("videos", record);
    creatorSetStatus(editing ? `Saved “${record.title}”.` : `Added “${record.title}”.`);
    creatorCloseEditor("cs-status");
  });
  return form;
}

function createCreatorLibrary() {
  const state = creatorGetState();
  const filters = creatorUi.library;
  const wrap = csEl("div", "cs-stack");
  if (creatorUi.editing?.collection === "videos") wrap.append(createCreatorVideoForm());
  const panel = csPanel("Video library", "cs-library-title");
  const toolbar = csEl("div", "cs-toolbar");
  const search = csInput("cs-lib-search", filters.query, { type: "search", placeholder: "Search titles, notes, categories" });
  const status = csSelect("cs-lib-status", [["all", "All statuses"], ...creatorStatuses.map((value) => [value, value])], filters.status);
  const format = csSelect("cs-lib-format", [["all", "Long-form and Shorts"], ["long", "Long-form"], ["short", "Shorts"]], filters.format);
  const categories = [...new Set(state.videos.map((video) => video.category).filter(Boolean))].sort();
  const category = csSelect("cs-lib-category", [["all", "All categories"], ...categories.map((value) => [value, value])], filters.category);
  const sort = csSelect("cs-lib-sort", [["recent", "Newest first"], ["views", "Most views"], ["engagement", "Best engagement"], ["title", "Title A–Z"], ["status", "Production status"]], filters.sort);
  toolbar.append(csField("Search", search), csField("Status", status), csField("Format", format), csField("Category", category), csField("Sort", sort));
  const head = csEl("div", "cs-panel-head");
  head.append(toolbar, csButton("Add video", () => creatorOpenEditor("videos", "", { status: "Planned", format: "long" }), "", "cs-add-video"));
  const count = csEl("p", "cs-count");
  count.setAttribute("aria-live", "polite");
  const list = csEl("div", "cs-video-list");
  const render = () => {
    const words = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const date = (video) => video.publishedAt || video.plannedDate || video.createdAt || "";
    let rows = state.videos.filter((video) => (filters.status === "all" || video.status === filters.status)
      && (filters.format === "all" || (filters.format === "short" ? video.format === "short" : video.format !== "short"))
      && (filters.category === "all" || video.category === filters.category)
      && words.every((word) => `${video.title} ${video.notes} ${video.category}`.toLowerCase().includes(word)));
    const sorters = {
      recent: (a, b) => date(b).localeCompare(date(a)),
      views: (a, b) => (b.views ?? -1) - (a.views ?? -1),
      engagement: (a, b) => (creatorEngagement(b) ?? -1) - (creatorEngagement(a) ?? -1),
      title: (a, b) => a.title.localeCompare(b.title),
      status: (a, b) => creatorStatuses.indexOf(a.status) - creatorStatuses.indexOf(b.status) || date(b).localeCompare(date(a))
    };
    rows = rows.sort(sorters[filters.sort]);
    count.textContent = `${rows.length} of ${state.videos.length} video${state.videos.length === 1 ? "" : "s"}`;
    list.replaceChildren(...rows.map((video) => creatorVideoCard(video)));
    if (!rows.length) list.append(csEmpty(state.videos.length ? "No videos match these filters." : "Your library is empty. Connect your channel to import uploads, or add a planned video."));
  };
  const bind = (control, key, event = "change") => control.addEventListener(event, () => { filters[key] = control.value; render(); });
  bind(search, "query", "input");
  bind(status, "status");
  bind(format, "format");
  bind(category, "category");
  bind(sort, "sort");
  render();
  panel.append(head, count, list);
  wrap.append(panel);
  return wrap;
}

// ---------- Ideas ----------

function createCreatorIdeaForm() {
  const state = creatorGetState();
  const draft = creatorUi.draft || {};
  const editing = Boolean(creatorUi.editing?.id);
  const form = csEl("form", "cs-panel cs-form");
  form.id = "cs-form-ideas";
  form.noValidate = true;
  const heading = csEl("h3", "", editing ? "Edit idea" : "New idea");
  heading.id = "cs-form-ideas-title";
  heading.tabIndex = -1;
  const title = csInput("cs-i-title", draft.title, { maxLength: creatorLimits.title });
  const category = csInput("cs-i-category", draft.category, { list: "cs-idea-categories", placeholder: "e.g. Album reaction" });
  const description = csTextarea("cs-i-description", draft.description, "What the video is and why it works");
  const priority = csSelect("cs-i-priority", creatorPriorities, draft.priority || "medium");
  const platform = csSelect("cs-i-platform", creatorPlatforms, draft.platform || "youtube");
  const status = csSelect("cs-i-status", creatorStatuses, draft.status || "Idea");
  const release = csInput("cs-i-release", draft.release?.label || "", { list: "cs-release-suggestions", placeholder: "Song, album, comeback or event" });
  const planned = csInput("cs-i-planned", draft.plannedDate, { type: "date" });
  const notes = csTextarea("cs-i-notes", draft.notes, "Talking points, references, guests");
  const suggestions = [];
  if (typeof musicLabGetState === "function") {
    for (const item of musicLabGetState().items) if (item.favorite || item.rating || item.discoveredAt) suggestions.push(`${item.title}${item.subtitle ? ` – ${item.subtitle}` : ""}`);
  }
  const grid = csEl("div", "cs-form-grid");
  const wide = (field) => { field.classList.add("cs-wide"); return field; };
  grid.append(wide(csField("Video title", title)), csField("Category", category), csField("Priority", priority), csField("Target platform", platform), csField("Production status", status),
    csField("Planned publishing date", planned), csField("Music release or event", release, suggestions.length ? "Suggestions include albums and songs from your Music Lab library." : ""),
    wide(csField("Description", description)), wide(csField("Notes", notes)),
    csDatalist("cs-idea-categories", state.ideas.map((idea) => idea.category)), csDatalist("cs-release-suggestions", suggestions));
  const actions = csEl("div", "cs-actions");
  const save = csEl("button", "", editing ? "Save idea" : "Add idea");
  save.type = "submit";
  actions.append(save, csButton("Cancel", () => creatorCloseEditor("cs-ideas-title")));
  const error = csEl("p", "cs-status-line error");
  error.setAttribute("role", "alert");
  form.append(heading, grid, actions, error);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!title.value.trim()) {
      error.textContent = "Give the idea a title.";
      title.setAttribute("aria-invalid", "true");
      title.focus();
      return;
    }
    const keepRelease = draft.release && draft.release.label === release.value.trim();
    const record = { ...draft, id: draft.id || creatorId("idea"), title: title.value, category: category.value, description: description.value, priority: priority.value,
      platform: platform.value, status: status.value, plannedDate: planned.value, notes: notes.value,
      release: release.value.trim() ? (keepRelease ? draft.release : { label: release.value.trim(), href: "", source: "" }) : null };
    creatorUpsert("ideas", record);
    creatorSetStatus(editing ? "Idea saved." : `Added “${record.title}” to your ideas.`);
    creatorCloseEditor("cs-status");
  });
  return form;
}

function creatorIdeaCard(idea) {
  const card = csEl("article", `cs-idea cs-priority-${idea.priority}`);
  const head = csEl("header", "cs-idea-head");
  head.append(csEl("strong", "", idea.title), csBadge(`${Object.fromEntries(creatorPriorities)[idea.priority]} priority`, `cs-priority cs-priority-badge-${idea.priority}`));
  card.append(head);
  const meta = csEl("p", "cs-meta");
  meta.append(csStatusBadge(idea.status), " ", csTypeChip(idea.platform), `${idea.category ? ` · ${idea.category}` : ""}${idea.plannedDate ? ` · planned ${csDate(idea.plannedDate)}` : ""}`);
  card.append(meta);
  if (idea.description) card.append(csEl("p", "", idea.description));
  if (idea.release) {
    const release = csEl("p", "cs-release");
    release.append(csEl("span", "cs-hint", `${idea.release.source || "Release"}: `));
    if (idea.release.href) {
      const link = csLink(idea.release.label, idea.release.href);
      if (/^https?:/.test(idea.release.href)) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      release.append(link);
    } else {
      release.append(idea.release.label);
    }
    card.append(release);
  }
  if (idea.notes) card.append(csEl("p", "cs-notes", idea.notes));
  const actions = csEl("div", "cs-actions");
  actions.append(csButton("Edit", () => creatorOpenEditor("ideas", idea.id), "secondary", `cs-edit-idea-${idea.id}`));
  const video = creatorGetState().videos.find((item) => item.ideaId === idea.id);
  if (video) {
    actions.append(csLink(`Video: ${video.status}`, "#creator/library", "cs-text-link"));
  } else {
    actions.append(csButton("Make it a video", () => {
      const id = creatorId("video");
      creatorUpsert("videos", { id, title: idea.title, status: "Planned", format: idea.platform === "youtube" || idea.platform === "live" ? "long" : "short", category: idea.category, plannedDate: idea.plannedDate, notes: [idea.description, idea.notes].filter(Boolean).join("\n\n"), ideaId: idea.id });
      creatorUpsert("ideas", { ...idea, status: idea.status === "Idea" ? "Planned" : idea.status });
      creatorSetStatus(`“${idea.title}” is now a planned video in the library.`);
      creatorRefresh("cs-status");
    }));
  }
  actions.append(csButton("Schedule", () => {
    location.hash = "#creator/calendar";
    creatorOpenEditor("schedule", "", { title: idea.title, type: idea.platform, date: idea.plannedDate || creatorToday(), status: "draft", ideaId: idea.id });
  }), csConfirmButton(`idea-${idea.id}`, "Delete", () => {
    creatorRemove("ideas", idea.id);
    creatorSetStatus("Idea deleted.");
    creatorRefresh("cs-status");
  }));
  card.append(actions);
  return card;
}

function createCreatorIdeas() {
  const state = creatorGetState();
  const filters = creatorUi.ideas;
  const wrap = csEl("div", "cs-stack");
  if (creatorUi.editing?.collection === "ideas") wrap.append(createCreatorIdeaForm());
  const panel = csPanel("Idea board", "cs-ideas-title");
  const toolbar = csEl("div", "cs-toolbar");
  const search = csInput("cs-idea-search", filters.query, { type: "search", placeholder: "Search ideas" });
  const categories = [...new Set(state.ideas.map((idea) => idea.category).filter(Boolean))].sort();
  const category = csSelect("cs-idea-category", [["all", "All categories"], ...categories.map((value) => [value, value])], filters.category);
  const priority = csSelect("cs-idea-priority", [["all", "Any priority"], ...creatorPriorities], filters.priority);
  const platform = csSelect("cs-idea-platform", [["all", "Any platform"], ...creatorPlatforms], filters.platform);
  const status = csSelect("cs-idea-status", [["all", "Any status"], ...creatorStatuses.map((value) => [value, value])], filters.status);
  const sort = csSelect("cs-idea-sort", [["priority", "Priority"], ["planned", "Planned date"], ["newest", "Newest"], ["title", "Title A–Z"]], filters.sort);
  toolbar.append(csField("Search", search), csField("Category", category), csField("Priority", priority), csField("Platform", platform), csField("Status", status), csField("Sort", sort));
  const head = csEl("div", "cs-panel-head");
  head.append(toolbar, csButton("New idea", () => creatorOpenEditor("ideas", "", { priority: "medium", platform: "youtube", status: "Idea" }), "", "cs-add-idea"));
  const count = csEl("p", "cs-count");
  count.setAttribute("aria-live", "polite");
  const board = csEl("div", "cs-idea-grid");
  const rank = { high: 0, medium: 1, low: 2 };
  const render = () => {
    const words = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let rows = state.ideas.filter((idea) => (filters.category === "all" || idea.category === filters.category) && (filters.priority === "all" || idea.priority === filters.priority)
      && (filters.platform === "all" || idea.platform === filters.platform) && (filters.status === "all" || idea.status === filters.status)
      && words.every((word) => `${idea.title} ${idea.description} ${idea.notes} ${idea.category} ${idea.release?.label || ""}`.toLowerCase().includes(word)));
    const sorters = {
      priority: (a, b) => rank[a.priority] - rank[b.priority] || (a.plannedDate || "9999").localeCompare(b.plannedDate || "9999"),
      planned: (a, b) => (a.plannedDate || "9999").localeCompare(b.plannedDate || "9999"),
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
      title: (a, b) => a.title.localeCompare(b.title)
    };
    rows = rows.sort(sorters[filters.sort]);
    count.textContent = `${rows.length} of ${state.ideas.length} idea${state.ideas.length === 1 ? "" : "s"}`;
    board.replaceChildren(...rows.map(creatorIdeaCard));
    if (!rows.length) board.append(csEmpty(state.ideas.length ? "No ideas match these filters." : "No ideas yet. Add one here, or use “Reaction idea” on a Music Lab song or album, or on a K-Pop release."));
  };
  const bind = (control, key, event = "change") => control.addEventListener(event, () => { filters[key] = control.value; render(); });
  bind(search, "query", "input");
  bind(category, "category");
  bind(priority, "priority");
  bind(platform, "platform");
  bind(status, "status");
  bind(sort, "sort");
  render();
  panel.append(head, count, board);
  wrap.append(panel);
  return wrap;
}

// ---------- Calendar ----------

// Everything with a date: scheduled posts, ideas with a planned date, and planned (unpublished) library videos.
function creatorCalendarItems(state) {
  const items = state.schedule.map((event) => ({ key: `schedule:${event.id}`, collection: "schedule", id: event.id, title: event.title, date: event.date, time: event.time,
    type: event.type, status: event.status, kindLabel: Object.fromEntries(creatorScheduleStatuses)[event.status], href: "#creator/calendar" }));
  const linkedIdeas = new Set(state.schedule.map((event) => event.ideaId).filter(Boolean));
  const linkedVideos = new Set(state.schedule.map((event) => event.videoId).filter(Boolean));
  // An idea that became a library video is shown once, as the video.
  for (const video of state.videos) if (video.ideaId) linkedIdeas.add(video.ideaId);
  for (const idea of state.ideas) {
    if (idea.plannedDate && !linkedIdeas.has(idea.id) && idea.status !== "Published") {
      items.push({ key: `ideas:${idea.id}`, collection: "ideas", id: idea.id, title: idea.title, date: idea.plannedDate, time: "", type: idea.platform, status: "idea", kindLabel: "Idea", href: "#creator/ideas" });
    }
  }
  for (const video of state.videos) {
    if (video.plannedDate && video.status !== "Published" && !linkedVideos.has(video.id)) {
      items.push({ key: `videos:${video.id}`, collection: "videos", id: video.id, title: video.title, date: video.plannedDate, time: "", type: video.format === "short" ? "short" : "youtube", status: video.status.toLowerCase(), kindLabel: `Video · ${video.status}`, href: "#creator/library" });
    }
  }
  return items;
}

function creatorMoveItem(item, date) {
  const state = creatorGetState();
  const record = state[item.collection].find((entry) => entry.id === item.id);
  if (!record || !creatorDate(date)) return;
  const field = item.collection === "schedule" ? "date" : "plannedDate";
  if (record[field] === date) return;
  creatorUpsert(item.collection, { ...record, [field]: date });
  creatorSetStatus(`Moved “${record.title}” to ${csDate(date, { weekday: "long", month: "long", day: "numeric" })}.`);
}

function creatorDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function creatorCalendarChip(item) {
  const chip = csEl("button", `cs-chip cs-chip-${item.status}${item.collection !== "schedule" ? " is-planned" : ""}`);
  chip.type = "button";
  chip.draggable = true;
  chip.dataset.key = item.key;
  chip.style.setProperty("--cs-type", creatorTypeColors[item.type] || "var(--muted)");
  chip.append(csEl("span", "cs-chip-type", creatorPlatformLabels[item.type]), csEl("span", "cs-chip-title", `${item.time ? `${item.time} ` : ""}${item.title}`));
  chip.title = `${item.title} · ${creatorPlatformLabels[item.type]} · ${item.kindLabel}. Drag to another day to reschedule.`;
  chip.setAttribute("aria-label", `${item.title}, ${creatorPlatformLabels[item.type]}, ${item.kindLabel}, ${csDate(item.date, { weekday: "long", month: "long", day: "numeric" })}. Open to edit or reschedule.`);
  chip.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", item.key);
    event.dataTransfer.effectAllowed = "move";
    chip.classList.add("is-dragging");
  });
  chip.addEventListener("dragend", () => chip.classList.remove("is-dragging"));
  chip.addEventListener("click", () => creatorOpenEditor(item.collection, item.id));
  return chip;
}

function creatorDropTarget(cell, date, items) {
  cell.addEventListener("dragover", (event) => {
    event.preventDefault();
    cell.classList.add("is-drop");
  });
  cell.addEventListener("dragleave", () => cell.classList.remove("is-drop"));
  cell.addEventListener("drop", (event) => {
    event.preventDefault();
    cell.classList.remove("is-drop");
    const item = items.find((entry) => entry.key === event.dataTransfer.getData("text/plain"));
    if (item) {
      creatorMoveItem(item, date);
      creatorRefresh();
    }
  });
}

function createCreatorEventForm() {
  const state = creatorGetState();
  const draft = creatorUi.draft || {};
  const editing = Boolean(creatorUi.editing?.id);
  const form = csEl("form", "cs-panel cs-form");
  form.id = "cs-form-schedule";
  form.noValidate = true;
  const heading = csEl("h3", "", editing ? "Edit scheduled post" : "Schedule a post");
  heading.id = "cs-form-schedule-title";
  heading.tabIndex = -1;
  const title = csInput("cs-e-title", draft.title, { maxLength: creatorLimits.title });
  const type = csSelect("cs-e-type", creatorPlatforms, draft.type || "youtube");
  const date = csInput("cs-e-date", draft.date || creatorToday(), { type: "date" });
  const time = csInput("cs-e-time", draft.time, { type: "time" });
  const status = csSelect("cs-e-status", creatorScheduleStatuses, draft.status || "draft");
  const video = csSelect("cs-e-video", [["", "None"], ...state.videos.map((item) => [item.id, item.title])], draft.videoId || "");
  const notes = csTextarea("cs-e-notes", draft.notes, "Caption, cross-post plan, reminders");
  const grid = csEl("div", "cs-form-grid");
  const wide = (field) => { field.classList.add("cs-wide"); return field; };
  grid.append(wide(csField("Title", title)), csField("Type", type), csField("Date", date), csField("Time", time), csField("Status", status),
    csField("Library video", video, "Optional link to a video record."), wide(csField("Notes", notes)));
  const actions = csEl("div", "cs-actions");
  const save = csEl("button", "", editing ? "Save" : "Add to calendar");
  save.type = "submit";
  actions.append(save, csButton("Cancel", () => creatorCloseEditor("cs-calendar-title")));
  if (editing) {
    actions.append(csConfirmButton(`event-${draft.id}`, "Delete", () => {
      creatorRemove("schedule", draft.id);
      creatorSetStatus("Removed from the calendar.");
      creatorCloseEditor("cs-status");
    }));
  }
  const error = csEl("p", "cs-status-line error");
  error.setAttribute("role", "alert");
  form.append(heading, grid, actions, error);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const problem = !title.value.trim() ? [title, "Give the post a title."] : !creatorDate(date.value) ? [date, "Pick a date."] : null;
    if (problem) {
      error.textContent = problem[1];
      problem[0].setAttribute("aria-invalid", "true");
      problem[0].focus();
      return;
    }
    creatorUpsert("schedule", { ...draft, id: draft.id || creatorId("event"), title: title.value, type: type.value, date: date.value, time: time.value, status: status.value, videoId: video.value, notes: notes.value });
    creatorSetStatus(`${editing ? "Updated" : "Scheduled"} “${title.value.trim()}” for ${csDate(date.value, { weekday: "long", month: "long", day: "numeric" })}.`);
    creatorCloseEditor("cs-status");
  });
  return form;
}

function createCreatorCalendar() {
  const state = creatorGetState();
  const settings = creatorUi.calendar;
  if (!settings.cursor) settings.cursor = creatorToday();
  const wrap = csEl("div", "cs-stack");
  // Opening an idea or video from the calendar edits it here.
  if (creatorUi.editing?.collection === "schedule") wrap.append(createCreatorEventForm());
  if (creatorUi.editing?.collection === "ideas") wrap.append(createCreatorIdeaForm());
  if (creatorUi.editing?.collection === "videos") wrap.append(createCreatorVideoForm());
  const panel = csPanel("Content calendar", "cs-calendar-title");
  const items = creatorCalendarItems(state);
  const cursor = new Date(`${settings.cursor}T00:00:00`);
  const toolbar = csEl("div", "cs-calendar-toolbar");
  const views = csEl("div", "cs-segmented");
  views.setAttribute("role", "group");
  views.setAttribute("aria-label", "Calendar view");
  for (const [value, label] of [["month", "Month"], ["week", "Week"], ["list", "List"]]) {
    const button = csButton(label, () => { settings.view = value; creatorRefresh(`cs-cal-view-${value}`); }, value === settings.view ? "is-active" : "secondary", `cs-cal-view-${value}`);
    button.setAttribute("aria-pressed", String(value === settings.view));
    views.append(button);
  }
  const shift = (direction) => {
    const date = new Date(cursor);
    if (settings.view === "week") date.setDate(date.getDate() + 7 * direction);
    else date.setMonth(date.getMonth() + direction, 1);
    settings.cursor = creatorDateKey(date);
  };
  const nav = csEl("div", "cs-actions");
  nav.append(csButton("‹ Previous", () => { shift(-1); creatorRefresh("cs-cal-prev"); }, "secondary", "cs-cal-prev"), csButton("Today", () => { settings.cursor = creatorToday(); creatorRefresh("cs-cal-today"); }, "secondary", "cs-cal-today"),
    csButton("Next ›", () => { shift(1); creatorRefresh("cs-cal-next"); }, "secondary", "cs-cal-next"));
  const label = settings.view === "week" ? (() => {
    const start = new Date(cursor);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${csDate(creatorDateKey(start), { month: "short", day: "numeric" })} – ${csDate(creatorDateKey(end), { month: "short", day: "numeric", year: "numeric" })}`;
  })() : settings.view === "month" ? new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(cursor) : "Upcoming and unpublished";
  const title = csEl("h4", "cs-calendar-label", label);
  title.setAttribute("aria-live", "polite");
  toolbar.append(views, settings.view === "list" ? csEl("span") : nav, title, csButton("Schedule a post", () => creatorOpenEditor("schedule", "", { date: settings.view === "list" ? creatorToday() : settings.cursor, status: "draft", type: "youtube" }), "", "cs-add-event"));
  const legend = csEl("ul", "cs-legend");
  legend.setAttribute("aria-label", "Content types");
  for (const [type, text] of creatorPlatforms) {
    const item = csEl("li", "", text);
    item.style.setProperty("--cs-type", creatorTypeColors[type]);
    legend.append(item);
  }
  legend.append(csEl("li", "is-planned", "Dashed: planned idea or video"));
  panel.append(toolbar, legend);
  const today = creatorToday();
  const byDate = new Map();
  for (const item of items) {
    if (!byDate.has(item.date)) byDate.set(item.date, []);
    byDate.get(item.date).push(item);
  }
  for (const list of byDate.values()) list.sort((a, b) => (a.time || "99").localeCompare(b.time || "99") || a.title.localeCompare(b.title));
  const dayCell = (date, { outside = false, tall = false } = {}) => {
    const key = creatorDateKey(date);
    const cell = csEl("div", `cs-day${outside ? " is-outside" : ""}${key === today ? " is-today" : ""}${tall ? " is-tall" : ""}`);
    cell.setAttribute("role", "gridcell");
    const head = csEl("div", "cs-day-head");
    head.append(csEl("span", "cs-day-number", tall ? csDate(key, { weekday: "short", day: "numeric" }) : String(date.getDate())));
    const add = csButton("+", () => creatorOpenEditor("schedule", "", { date: key, status: "draft", type: "youtube" }), "cs-day-add");
    add.setAttribute("aria-label", `Schedule a post on ${csDate(key, { weekday: "long", month: "long", day: "numeric" })}`);
    head.append(add);
    cell.append(head);
    for (const item of byDate.get(key) || []) cell.append(creatorCalendarChip(item));
    creatorDropTarget(cell, key, items);
    return cell;
  };
  if (settings.view === "list") {
    const rows = items.filter((item) => item.date >= today || item.status === "draft" || item.status === "idea").sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
    if (!rows.length) {
      panel.append(csEmpty("Nothing scheduled. Add posts here, or give ideas and planned videos a date."));
    } else {
      const list = csEl("ol", "cs-agenda");
      let lastDate = "";
      for (const item of rows) {
        if (item.date !== lastDate) {
          list.append(csEl("li", `cs-agenda-date${item.date < today ? " is-overdue" : ""}`, `${csDate(item.date, { weekday: "long", month: "long", day: "numeric" })}${item.date < today ? " · overdue" : ""}`));
          lastDate = item.date;
        }
        const row = csEl("li", "cs-agenda-item");
        const chip = creatorCalendarChip(item);
        const move = csInput(`cs-move-${item.key.replace(/[^\w-]/g, "-")}`, item.date, { type: "date" });
        move.setAttribute("aria-label", `Reschedule ${item.title}`);
        move.addEventListener("change", () => { creatorMoveItem(item, move.value); creatorRefresh(move.id); });
        row.append(chip, move);
        list.append(row);
      }
      panel.append(list);
    }
  } else {
    const grid = csEl("div", `cs-calendar cs-calendar-${settings.view}`);
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", label);
    const header = csEl("div", "cs-weekdays");
    header.setAttribute("role", "row");
    for (let day = 0; day < 7; day++) header.append(csEl("span", "", new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(2026, 10, 1 + day))));
    if (settings.view === "month") grid.append(header);
    const start = new Date(cursor);
    if (settings.view === "month") start.setDate(1);
    start.setDate(start.getDate() - start.getDay());
    const days = settings.view === "month" ? 42 : 7;
    const body = csEl("div", "cs-days");
    for (let index = 0; index < days; index++) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      body.append(dayCell(date, { outside: settings.view === "month" && date.getMonth() !== cursor.getMonth(), tall: settings.view === "week" }));
    }
    grid.append(body);
    panel.append(grid, csEl("p", "cs-hint", "Drag an item to another day to reschedule it, or open it to change its date. The List view has date pickers for rescheduling on touch screens."));
  }
  wrap.append(panel);
  if (typeof liveEventsPlannedConcerts === "function") {
    try {
      const concerts = liveEventsPlannedConcerts() || [];
      if (concerts.length) {
        const vlogs = csPanel("Concert vlog ideas from Live Events", "cs-live-title");
        vlogs.append(creatorSimpleList(concerts.slice(0, 6).map((concert) => ({ title: concert.title, meta: concert.date || "" }))));
        wrap.append(vlogs);
      }
    } catch (error) {
      console.error("Live Events integration failed.", error);
    }
  }
  return wrap;
}

// ---------- Analytics ----------

function creatorBarChart(rows, { label, format = creatorFormatCount, id }) {
  const box = csEl("figure", "cs-chart");
  box.setAttribute("aria-labelledby", `${id}-caption`);
  const caption = csEl("figcaption", "", label);
  caption.id = `${id}-caption`;
  box.append(caption);
  const max = Math.max(...rows.map((row) => row.value), 0) || 1;
  const list = csEl("ol", "cs-bars");
  for (const row of rows) {
    const item = csEl("li", "cs-bar-row");
    item.tabIndex = 0;
    item.setAttribute("aria-label", `${row.label}: ${format(row.value)}${row.note ? `, ${row.note}` : ""}`);
    const name = csEl("span", "cs-bar-label", row.label);
    const track = csEl("span", "cs-bar-track");
    const bar = csEl("span", "cs-bar");
    bar.style.width = `${Math.max(1.5, (row.value / max) * 100)}%`;
    track.append(bar);
    item.append(name, track, csEl("span", "cs-bar-value", format(row.value)));
    item.title = `${row.label}: ${format(row.value)}${row.note ? ` (${row.note})` : ""}`;
    list.append(item);
  }
  box.append(list);
  const details = csEl("details", "cs-details");
  details.append(csEl("summary", "", "Data table"), creatorTable(["Item", "Value"], rows.map((row) => [row.label, format(row.value)])));
  box.append(details);
  return box;
}

function creatorLineChart(points, { label, id, format = creatorFormatCount }) {
  const box = csEl("figure", "cs-chart");
  const caption = csEl("figcaption", "", label);
  caption.id = `${id}-caption`;
  box.setAttribute("aria-labelledby", caption.id);
  box.append(caption);
  const width = 640;
  const height = 220;
  const pad = { left: 56, right: 16, top: 12, bottom: 28 };
  const values = points.map((point) => point.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const times = points.map((point) => Date.parse(`${point.date}T00:00:00`));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times) || t0 + 1;
  const x = (time) => pad.left + ((time - t0) / ((t1 - t0) || 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - (value - min) / (max - min)) * (height - pad.top - pad.bottom);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "cs-line-chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${label}: ${points.length} recorded values from ${csDate(points[0].date)} to ${csDate(points.at(-1).date)}`);
  for (const fraction of [0, 0.5, 1]) {
    const value = min + (max - min) * fraction;
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", pad.left);
    line.setAttribute("x2", width - pad.right);
    line.setAttribute("y1", y(value));
    line.setAttribute("y2", y(value));
    line.setAttribute("class", "cs-grid-line");
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", pad.left - 8);
    text.setAttribute("y", y(value) + 4);
    text.setAttribute("text-anchor", "end");
    text.setAttribute("class", "cs-axis");
    text.textContent = format(Math.round(value));
    svg.append(line, text);
  }
  for (const [index, anchor] of [[0, "start"], [points.length - 1, "end"]]) {
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", x(times[index]));
    text.setAttribute("y", height - 8);
    text.setAttribute("text-anchor", anchor);
    text.setAttribute("class", "cs-axis");
    text.textContent = csDate(points[index].date, { month: "short", day: "numeric" });
    svg.append(text);
  }
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", points.map((point, index) => `${index ? "L" : "M"}${x(times[index]).toFixed(1)},${y(point.value).toFixed(1)}`).join(" "));
  path.setAttribute("class", "cs-line");
  svg.append(path);
  points.forEach((point, index) => {
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", x(times[index]));
    dot.setAttribute("cy", y(point.value));
    dot.setAttribute("r", "4");
    dot.setAttribute("class", "cs-dot");
    const tip = document.createElementNS(ns, "title");
    tip.textContent = `${csDate(point.date)}: ${format(point.value)}`;
    dot.append(tip);
    svg.append(dot);
  });
  box.append(svg);
  const details = csEl("details", "cs-details");
  details.append(csEl("summary", "", "Data table"), creatorTable(["Date", "Value"], points.map((point) => [csDate(point.date), format(point.value)])));
  box.append(details);
  return box;
}

function creatorMissing(text, tag = "Not enough data") {
  const note = csEl("p", "cs-missing");
  note.append(csEl("span", "cs-missing-tag", tag), ` ${text}`);
  return note;
}

function createCreatorAnalytics() {
  const state = creatorGetState();
  const wrap = csEl("div", "cs-stack");
  const measured = state.videos.filter((video) => video.views !== null);
  const growth = csPanel("Channel over time", "cs-growth-title");
  const viewPoints = state.snapshots.filter((item) => item.views !== null).map((item) => ({ date: item.date, value: item.views }));
  growth.append(viewPoints.length >= 2 ? creatorLineChart(viewPoints, { label: "Total channel views (recorded snapshots)", id: "cs-chart-views" })
    : creatorMissing(`Total views need snapshots on at least two different days (${viewPoints.length} so far). Refresh your channel or enter stats on the Channel page on different days; past totals aren’t available from YouTube’s public API.`));
  const subscriberPoints = state.snapshots.filter((item) => item.subscribers !== null);
  if (subscriberPoints.length >= 2) {
    const changes = subscriberPoints.slice(1).map((item, index) => ({ label: csDate(item.date, { month: "short", day: "numeric" }), value: item.subscribers - subscriberPoints[index].subscribers }));
    growth.append(creatorLineChart(subscriberPoints.map((item) => ({ date: item.date, value: item.subscribers })), { label: "Subscribers (recorded snapshots)", id: "cs-chart-subs" }));
    const box = csEl("div", "cs-changes");
    box.append(csEl("h4", "", "Change between snapshots"), creatorTable(["Snapshot", "Change"], changes.map((change) => [change.label, `${change.value >= 0 ? "+" : ""}${new Intl.NumberFormat().format(change.value)}`])));
    growth.append(box);
  } else {
    growth.append(creatorMissing(state.channel?.hiddenSubscribers ? "This channel hides its subscriber count, so YouTube doesn’t report it." : `Subscriber changes need at least two snapshots with a subscriber count (${subscriberPoints.length} so far).`));
  }
  wrap.append(growth);

  const videos = csPanel("Videos", "cs-video-analytics-title");
  if (measured.length) {
    const top = [...measured].sort((a, b) => b.views - a.views).slice(0, 12);
    videos.append(creatorBarChart(top.map((video) => ({ label: video.title, value: video.views, note: video.format === "short" ? "Short" : "" })), { label: "Views by video (top 12)", id: "cs-chart-by-video" }));
    const engaged = measured.filter((video) => creatorEngagement(video) !== null && video.views >= 50).sort((a, b) => creatorEngagement(b) - creatorEngagement(a)).slice(0, 12);
    if (engaged.length) {
      videos.append(creatorBarChart(engaged.map((video) => ({ label: video.title, value: creatorEngagement(video) })), { label: "Engagement rate: (likes + comments) ÷ views, videos with 50+ views", id: "cs-chart-engagement", format: (value) => `${(value * 100).toFixed(1)}%` }));
    } else {
      videos.append(creatorMissing("Engagement needs likes, comments and at least 50 views on a video."));
    }
    const withHistory = measured.filter((video) => video.history.filter((item) => item.views !== null).length >= 2);
    const choice = withHistory.find((video) => video.id === creatorUi.analyticsVideo) || withHistory[0];
    if (choice) {
      const select = csSelect("cs-analytics-video", withHistory.map((video) => [video.id, video.title]), choice.id);
      select.addEventListener("change", () => { creatorUi.analyticsVideo = select.value; creatorRefresh(select.id); });
      videos.append(csField("Views over time for", select), creatorLineChart(choice.history.filter((item) => item.views !== null).map((item) => ({ date: item.date, value: item.views })), { label: `Views over time: ${choice.title}`, id: "cs-chart-video-history" }));
    } else {
      videos.append(creatorMissing("Views over time per video need at least two refreshes on different days."));
    }
  } else {
    videos.append(creatorMissing("No view counts yet. Connect and refresh your channel, or enter views on videos in the library."));
  }
  wrap.append(videos);

  const compare = csPanel("Shorts vs long-form", "cs-format-title");
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
  };
  const groups = [["Long-form", measured.filter((video) => video.format !== "short")], ["Shorts", measured.filter((video) => video.format === "short")]];
  if (groups.every(([, list]) => list.length)) {
    compare.append(creatorBarChart(groups.map(([name, list]) => ({ label: `${name} (${list.length})`, value: median(list.map((video) => video.views)) })), { label: "Median views per video", id: "cs-chart-format" }));
    compare.append(csEl("p", "cs-hint", "Shorts are videos marked as Shorts; imported uploads of 3 minutes or less start out marked as Shorts, which you can change on the video."));
  } else {
    compare.append(creatorMissing("Comparing formats needs view counts for at least one Short and one long-form video."));
  }
  wrap.append(compare);

  const topics = csPanel("Best-performing topics", "cs-topics-title");
  const byTopic = new Map();
  for (const video of measured) if (video.category) byTopic.set(video.category, [...(byTopic.get(video.category) || []), video]);
  if (byTopic.size) {
    const rows = [...byTopic].map(([name, list]) => ({ label: `${name} (${list.length})`, value: median(list.map((video) => video.views)) })).sort((a, b) => b.value - a.value).slice(0, 10);
    topics.append(creatorBarChart(rows, { label: "Median views by category", id: "cs-chart-topics" }));
    const uncategorized = measured.filter((video) => !video.category).length;
    if (uncategorized) topics.append(csEl("p", "cs-hint", `${uncategorized} video${uncategorized === 1 ? " has" : "s have"} no category and ${uncategorized === 1 ? "isn’t" : "aren’t"} counted. Add categories in the library.`));
  } else {
    topics.append(creatorMissing("Give your videos categories in the library to compare topics."));
  }
  wrap.append(topics);

  const privateMetrics = csPanel("Watch time, retention, impressions and CTR", "cs-private-title");
  privateMetrics.append(creatorMissing("These come only from the YouTube Analytics API with your Google sign-in, which isn’t set up. See the Channel page.", "Unavailable"));
  wrap.append(privateMetrics);
  return wrap;
}
