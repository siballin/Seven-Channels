// Browser notifications while the site is open (opt-in, from the Guide's This week panel).
// Checks once a minute after load and then every 30 minutes: new shows announced for followed artists
// (Ticketmaster, needs your key in Live Events settings), K-pop releases out today from followed artists,
// favorite game releases out today, and today's own plans (concerts, league night, planned uploads).
// Each alert is sent once; what was sent is remembered on this device only.

const notifyStorageKey = "seven-channels.notifications.v1";
const notifyTypes = [
  ["tours", "New shows for artists you follow", "Uses Ticketmaster; near you when a location is set in Live Events."],
  ["kpop", "K-pop releases and birthdays today", "From artists you follow on the K-Pop channel."],
  ["games", "Favorite game releases out today", "Games you starred in the release calendar."],
  ["today", "Today’s plans", "Concerts, league night, planned uploads and race days, on the day."]
];
const notifyInterval = 30 * 60000;

function notifyTime(value) {
  return typeof thisWeekTime === "function" ? thisWeekTime(value) || value : value;
}

function notifySupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

function notifyLoad() {
  try {
    const value = JSON.parse(localStorage.getItem(notifyStorageKey) || "{}");
    const types = {};
    for (const [id] of notifyTypes) types[id] = value.types?.[id] !== false;
    return {
      enabled: value.enabled === true,
      types,
      sent: value.sent && typeof value.sent === "object" ? value.sent : {},
      seenEvents: value.seenEvents && typeof value.seenEvents === "object" ? value.seenEvents : {},
      lastCheck: Number.isFinite(value.lastCheck) ? value.lastCheck : 0
    };
  } catch {
    return { enabled: false, types: Object.fromEntries(notifyTypes.map(([id]) => [id, true])), sent: {}, seenEvents: {}, lastCheck: 0 };
  }
}

function notifySave(state) {
  // Keep the newest 400 sent keys and 80 artists' seen shows.
  const sent = Object.entries(state.sent).sort((a, b) => b[1] - a[1]).slice(0, 400);
  const seenEvents = Object.fromEntries(Object.entries(state.seenEvents).slice(-80).map(([id, list]) => [id, list.slice(-200)]));
  try {
    localStorage.setItem(notifyStorageKey, JSON.stringify({ ...state, sent: Object.fromEntries(sent), seenEvents }));
  } catch (error) {
    console.warn("Could not save notification settings.", error);
  }
}

function notifyShow({ key, title, body, href }, state) {
  if (state.sent[key]) return false;
  state.sent[key] = Date.now();
  try {
    const note = new Notification(title, { body, tag: key });
    note.addEventListener("click", () => {
      window.focus();
      if (href?.startsWith("#")) location.hash = href;
      else if (href) window.open(href, "_blank", "noopener");
      note.close();
    });
    return true;
  } catch (error) {
    // Some mobile browsers only allow notifications from installed apps.
    console.warn("This browser blocked the notification.", error);
    return false;
  }
}

// Alerts for today's own plans and releases. Exposed separately so it can be tested with plain data.
function notifyTodayAlerts(today, { plans = [], leagues = [], schedule = [], kpop = [], games = [] }) {
  const alerts = { today: [], kpop: [], games: [] };
  for (const plan of plans) {
    if (plan.event?.date !== today || !["Planning", "Ticket Purchased", "Attending"].includes(plan.status)) continue;
    const name = plan.event.attractions?.[0]?.name || plan.event.name;
    alerts.today.push({ key: `concert:${plan.event.id}:${today}`, title: `Tonight: ${name}`, body: [plan.event.venue?.name, plan.event.time ? `Starts ${notifyTime(plan.event.time)}` : ""].filter(Boolean).join(" · "), href: `#live/event/${plan.event.id}` });
  }
  const weekday = new Date(`${today}T12:00:00`).getDay();
  for (const league of leagues) {
    if (league.archived || league.night !== weekday) continue;
    if ((league.seasonStart && today < league.seasonStart) || (league.seasonEnd && today > league.seasonEnd)) continue;
    alerts.today.push({ key: `league:${league.id}:${today}`, title: `League night: ${league.name}`, body: [league.center, league.time ? `at ${notifyTime(league.time)}` : ""].filter(Boolean).join(" "), href: "#bowling" });
  }
  for (const event of schedule) {
    if (event.date !== today || event.status === "published") continue;
    alerts.today.push({ key: `upload:${event.id}:${today}`, title: `Planned upload today: ${event.title}`, body: event.status === "draft" ? "Still a draft." : "Scheduled.", href: "#creator/calendar" });
  }
  for (const release of kpop) {
    if (release.date !== today) continue;
    alerts.kpop.push({ key: `kpop:${release.title}:${today}`, title: `Out today: ${release.title}`, body: release.note || "K-pop release", href: release.href || "#kpop" });
  }
  for (const game of games) {
    if (game.date !== today) continue;
    alerts.games.push({ key: `game:${game.url}`, title: `Out today: ${game.title}`, body: (game.platforms || []).join(", "), href: game.url });
  }
  return alerts;
}

// New Ticketmaster events for followed artists. The first check for an artist only records what's already listed.
async function notifyTourAlerts(state) {
  if (typeof liveLocal !== "function" || !liveLocal().ticketmasterKey) return [];
  const local = liveLocal();
  const near = local.location ? { latlong: `${local.location.lat},${local.location.lon}`, radius: String(local.location.radius) } : {};
  const follows = liveGetState().follows.filter((follow) => follow.following && follow.tmId).slice(0, 25);
  const alerts = [];
  for (const follow of follows) {
    let events;
    try {
      events = (await liveSearchEvents({ attractionId: follow.tmId, size: 50, ...near })).events;
    } catch (error) {
      console.warn("Tour check failed.", error);
      break;
    }
    const seen = state.seenEvents[follow.tmId];
    if (seen) {
      for (const event of events) {
        if (seen.includes(event.id)) continue;
        const date = event.date ? new Date(`${event.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
        alerts.push({ key: `show:${event.id}`, title: `New show: ${follow.name}`, body: [date, event.venue?.name, event.venue?.city].filter(Boolean).join(" · "), href: `#live/event/${event.id}` });
      }
    }
    state.seenEvents[follow.tmId] = [...new Set([...(seen || []), ...events.map((event) => event.id)])];
  }
  return alerts;
}

let notifyRunning = false;
async function notifyCheck({ force = false } = {}) {
  const state = notifyLoad();
  if (notifyRunning || !state.enabled || !notifySupported() || Notification.permission !== "granted") return 0;
  if (!force && Date.now() - state.lastCheck < notifyInterval - 60000) return 0;
  notifyRunning = true;
  let sent = 0;
  try {
    const today = typeof thisWeekDay === "function" ? thisWeekDay(new Date()) : new Date().toISOString().slice(0, 10);
    const safe = (read) => { try { return read() || []; } catch { return []; } };
    const kpop = state.types.kpop && typeof thisWeekKpop === "function" ? await thisWeekKpop([today]).catch(() => []) : [];
    const birthdays = state.types.kpop && typeof thisWeekIdolBirthdays === "function" ? await thisWeekIdolBirthdays([today]).catch(() => []) : [];
    let games = [];
    if (state.types.games && typeof gamesReadFavorites === "function") {
      try {
        const data = await (await fetch(new URL("data/game-releases.json", location.href))).json();
        games = gamesReadFavorites(data.releases || []);
      } catch (error) { console.warn("Game release check failed.", error); }
    }
    const alerts = notifyTodayAlerts(today, {
      plans: safe(() => liveGetState().plans), leagues: safe(() => bowlingGetState().leagues), schedule: safe(() => creatorGetState().schedule), kpop, games
    });
    alerts.kpop.push(...birthdays.map((item) => ({ key: `birthday:${item.href}:${today}`, title: `🎂 ${item.title} today`, body: item.note, href: item.href })));
    if (state.types.today && typeof motorsportsThisWeek === "function") {
      const races = await motorsportsThisWeek([today]).catch(() => []);
      alerts.today.push(...races.map((race) => ({ key: `race:${race.label}:${race.title}:${today}`, title: `Race day: ${race.label} ${race.title}`,
        body: [race.note, race.time ? `Starts ${notifyTime(race.time)}` : ""].filter(Boolean).join(" · "), href: race.href })));
    }
    const list = [...(state.types.today ? alerts.today : []), ...(state.types.kpop ? alerts.kpop : []), ...(state.types.games ? alerts.games : [])];
    if (state.types.tours) list.push(...await notifyTourAlerts(state));
    // Don't flood: at most five at once; the rest are marked sent and summed up.
    const fresh = list.filter((alert) => !state.sent[alert.key]);
    for (const alert of fresh.slice(0, 5)) if (notifyShow(alert, state)) sent++;
    if (fresh.length > 5) {
      fresh.slice(5).forEach((alert) => { state.sent[alert.key] = Date.now(); });
      notifyShow({ key: `more:${Date.now()}`, title: `${fresh.length - 5} more updates`, body: "Open Seven Channels to see them.", href: "#guide" }, state);
    }
    state.lastCheck = Date.now();
    notifySave(state);
  } finally {
    notifyRunning = false;
  }
  return sent;
}

function notifyStart() {
  setTimeout(() => notifyCheck(), 60000);
  setInterval(() => notifyCheck(), notifyInterval);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") notifyCheck(); });
}

// Settings, shown in the This week panel.
function createNotifySettings() {
  const box = element("details", "notify-settings");
  const state = notifyLoad();
  const summary = element("summary", "", state.enabled && notifySupported() && Notification.permission === "granted" ? "🔔 Notifications on" : "🔔 Notifications");
  box.append(summary);
  const panel = element("div", "notify-panel");
  const note = element("p", "notify-note", "Alerts show while Seven Channels is open in a tab. Nothing is sent from a server.");
  const status = element("p", "notify-status");
  status.setAttribute("role", "status");
  const toggle = element("button", "", "");
  toggle.type = "button";
  const test = element("button", "secondary", "Check now");
  test.type = "button";
  const checks = element("div", "notify-types");
  for (const [id, label, hint] of notifyTypes) {
    const row = element("label", "notify-type");
    const input = element("input");
    input.type = "checkbox";
    input.checked = state.types[id];
    input.addEventListener("change", () => {
      const next = notifyLoad();
      next.types[id] = input.checked;
      notifySave(next);
    });
    const text = element("span");
    text.append(element("strong", "", label), element("small", "", hint));
    row.append(input, text);
    checks.append(row);
  }
  function update() {
    const current = notifyLoad();
    const permission = notifySupported() ? Notification.permission : "unsupported";
    const on = current.enabled && permission === "granted";
    toggle.textContent = on ? "Turn off" : "Turn on notifications";
    toggle.className = on ? "secondary" : "";
    test.hidden = !on;
    checks.hidden = !on;
    summary.textContent = on ? "🔔 Notifications on" : "🔔 Notifications";
    status.textContent = permission === "unsupported" ? "This browser doesn’t support notifications."
      : permission === "denied" ? "Notifications are blocked for this site. Allow them in your browser’s site settings, then try again." : "";
    toggle.disabled = permission === "unsupported";
  }
  toggle.addEventListener("click", async () => {
    const current = notifyLoad();
    if (current.enabled && Notification.permission === "granted") {
      current.enabled = false;
      notifySave(current);
      update();
      return;
    }
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    current.enabled = permission === "granted";
    notifySave(current);
    update();
    if (current.enabled) {
      status.textContent = "Checking…";
      const sent = await notifyCheck({ force: true });
      status.textContent = sent ? `Sent ${sent} notification${sent === 1 ? "" : "s"}.` : "On. Nothing new right now; you’ll get alerts as things come up.";
    }
  });
  test.addEventListener("click", async () => {
    status.textContent = "Checking…";
    const sent = await notifyCheck({ force: true });
    status.textContent = sent ? `Sent ${sent} notification${sent === 1 ? "" : "s"}.` : "Nothing new right now.";
  });
  const actions = element("div", "notify-actions");
  actions.append(toggle, test);
  panel.append(note, actions, checks, status);
  box.append(panel);
  update();
  return box;
}
