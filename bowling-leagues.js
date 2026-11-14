// League tracker (#bowling/leagues): set up leagues once, then pick them when logging a session.

const bowlingNights = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
let bowlingLeagueDraft = null;
let bowlingLeagueStatus = { text: "", error: false };

function bowlingEmptyLeagueDraft() {
  return { id: null, name: "", center: "", night: "", time: "", team: "", seasonStart: "", seasonEnd: "" };
}

function bowlingFormatTime(value) {
  if (!value) return "";
  const [hours, minutes] = value.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes));
}

function bowlingLeagueSchedule(league) {
  const when = [league.night === null ? "" : `${bowlingNights[league.night]}s`, bowlingFormatTime(league.time)].filter(Boolean).join(" at ");
  return [when, league.center].filter(Boolean).join(" · ");
}

function bowlingLeagueSeason(league) {
  const today = bowlingToday();
  const short = { month: "short", day: "numeric", year: "numeric" };
  if (league.seasonStart && league.seasonStart > today) return `Season starts ${bowlingFormatDate(league.seasonStart, short)}`;
  if (league.seasonEnd && league.seasonEnd < today) return `Season ended ${bowlingFormatDate(league.seasonEnd, short)}`;
  if (league.seasonStart && league.seasonEnd) return `Season ${bowlingFormatDate(league.seasonStart, short)} – ${bowlingFormatDate(league.seasonEnd, short)}`;
  if (league.seasonEnd) return `Season ends ${bowlingFormatDate(league.seasonEnd, short)}`;
  if (league.seasonStart) return `Season started ${bowlingFormatDate(league.seasonStart, short)}`;
  return "";
}

// Opens League night with a new session set to this league.
function bowlingLogForLeague(league) {
  const draft = bowlingDraft && !bowlingDraft.id ? bowlingDraft : bowlingNewDraft();
  draft.leagueId = league.id;
  draft.type = "league";
  if (!draft.center.trim()) draft.center = league.center;
  bowlingDraft = draft;
  bowlingStatus.form = "";
  location.hash = "#bowling";
  requestAnimationFrame(() => {
    document.getElementById("bowling-log")?.scrollIntoView({ block: "start", behavior: bowlingScrollBehavior() });
    document.getElementById("bowling-date")?.focus({ preventScroll: true });
  });
}

function createBowlingLeagueForm(state) {
  const draft = bowlingLeagueDraft || bowlingEmptyLeagueDraft();
  const editing = draft.id ? state.leagues.find((league) => league.id === draft.id) : null;
  const panel = element("section", "bowling-panel bowling-league-editor");
  panel.setAttribute("aria-labelledby", "bowling-league-form-title");
  const title = element("h3", "", editing ? `Edit ${editing.name}` : "Add a league");
  title.id = "bowling-league-form-title";
  title.tabIndex = -1;
  const form = element("form", "bowling-form");
  form.noValidate = true;
  const name = bowlingInput("bowling-league-name", draft.name, { maxLength: bowlingLimits.league, placeholder: "e.g. Tuesday Night Mixed" });
  name.required = true;
  name.autocomplete = "off";
  const centers = [...new Set([...state.leagues.map((league) => league.center), ...state.sessions.map((session) => session.center)].filter(Boolean))];
  const center = bowlingInput("bowling-league-center", draft.center, { maxLength: bowlingLimits.center, placeholder: "Optional", list: "bowling-league-center-list" });
  center.autocomplete = "off";
  const night = bowlingSelect("bowling-league-night", [["", "Not set"], ...bowlingNights.map((day, index) => [String(index), day])], draft.night);
  const time = bowlingInput("bowling-league-time", draft.time, { type: "time" });
  const team = bowlingInput("bowling-league-team", draft.team, { maxLength: bowlingLimits.team, placeholder: "Optional" });
  const seasonStart = bowlingInput("bowling-league-start", draft.seasonStart, { type: "date" });
  const seasonEnd = bowlingInput("bowling-league-end", draft.seasonEnd, { type: "date" });
  const keep = () => {
    bowlingLeagueDraft = { id: draft.id, name: name.value, center: center.value, night: night.value, time: time.value, team: team.value, seasonStart: seasonStart.value, seasonEnd: seasonEnd.value };
  };
  [name, center, time, team, seasonStart, seasonEnd].forEach((input) => input.addEventListener("input", keep));
  night.addEventListener("change", keep);
  const grid = element("div", "bowling-form-grid");
  const nameField = bowlingField("League name", name);
  nameField.classList.add("bowling-field-wide");
  const centerField = bowlingField("Bowling center", center);
  centerField.classList.add("bowling-field-wide");
  grid.append(nameField, centerField, bowlingField("Night", night), bowlingField("Start time", time),
    bowlingField("Season starts", seasonStart), bowlingField("Season ends", seasonEnd));
  const teamField = bowlingField("Team", team);
  teamField.classList.add("bowling-field-wide");
  grid.append(teamField, bowlingDatalist("bowling-league-center-list", centers));
  const footer = element("div", "bowling-form-footer");
  const save = element("button", "", editing ? "Save league" : "Add league");
  save.type = "submit";
  footer.append(save);
  if (editing) {
    const cancel = element("button", "secondary", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      bowlingLeagueDraft = null;
      bowlingLeagueStatus = { text: "", error: false };
      bowlingRefresh("bowling-league-form-title");
    });
    footer.append(cancel);
  }
  const status = element("p", `bowling-status${bowlingLeagueStatus.error ? " error" : ""}`, bowlingLeagueStatus.text);
  status.id = "bowling-league-status";
  status.setAttribute("role", "status");
  footer.append(status);
  form.append(grid, footer);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const leagueName = name.value.trim();
    const fail = (message, input) => {
      bowlingLeagueStatus = { text: message, error: true };
      status.textContent = message;
      status.classList.add("error");
      input.setAttribute("aria-invalid", "true");
      input.focus();
    };
    if (!leagueName) return fail("Enter the league's name.", name);
    const duplicate = state.leagues.find((league) => league.id !== draft.id && league.name.toLowerCase() === leagueName.toLowerCase());
    if (duplicate) return fail(`You already have a league called ${duplicate.name}.`, name);
    if (seasonStart.value && seasonEnd.value && seasonEnd.value < seasonStart.value) return fail("The season can't end before it starts.", seasonEnd);
    const saved = bowlingCommit((next, now) => {
      const previous = editing ? next.leagues.find((league) => league.id === editing.id) : null;
      const league = {
        id: previous?.id || bowlingId("league"),
        name: leagueName,
        center: center.value.trim(),
        night: night.value === "" ? null : Number(night.value),
        time: time.value,
        team: team.value.trim(),
        seasonStart: seasonStart.value,
        seasonEnd: seasonEnd.value,
        archived: previous?.archived || false,
        createdAt: previous?.createdAt || now,
        updatedAt: now
      };
      next.leagues = next.leagues.filter((item) => item.id !== league.id);
      next.leagues.push(league);
    });
    bowlingLeagueDraft = null;
    bowlingLeagueStatus = saved
      ? { text: editing ? `${leagueName} updated.` : `${leagueName} added. Pick it in League night when you log a session.`, error: false }
      : { text: "Saved for this visit only; browser storage is unavailable.", error: true };
    bowlingRefresh("bowling-league-name");
  });
  panel.append(title, form);
  return panel;
}

function createBowlingLeagueCard(league, state) {
  const card = element("article", `bowling-league${league.archived ? " archived" : ""}`);
  const sessions = state.sessions.filter((session) => session.league?.id === league.id);
  const head = element("header", "bowling-league-head");
  const heading = element("div", "bowling-league-heading");
  const name = element("h4", "", league.name);
  name.id = `bowling-league-${league.id}`;
  name.tabIndex = -1;
  heading.append(name);
  const schedule = bowlingLeagueSchedule(league);
  if (schedule) heading.append(element("span", "bowling-league-meta", schedule));
  const extra = [league.team && `Team ${league.team}`, bowlingLeagueSeason(league)].filter(Boolean).join(" · ");
  if (extra) heading.append(element("span", "bowling-league-meta", extra));
  head.append(heading);
  if (league.archived) head.append(element("span", "bowling-badge", "Archived"));
  card.append(head);

  const overall = bowlingOverall(sessions);
  const metrics = element("div", "bowling-metrics bowling-league-metrics");
  for (const [label, value, note] of [
    ["Average", bowlingFormatAverage(overall.average), `${overall.games} game${overall.games === 1 ? "" : "s"}`],
    ["Weeks", String(sessions.length), sessions.length ? `Last ${bowlingFormatDate(sessions[0].date, { month: "short", day: "numeric" })}` : "None logged"],
    ["High game", overall.high === null ? "—" : String(overall.high), ""],
    ["High series", overall.highSeries === null ? "—" : String(overall.highSeries), ""]
  ]) {
    const metric = element("div", "bowling-metric");
    metric.append(element("span", "", label), element("strong", "", value));
    if (note) metric.append(element("small", "", note));
    metrics.append(metric);
  }
  card.append(metrics);
  const tracked = bowlingFrameStats(sessions);
  if (tracked.games) {
    const spares = tracked.chances ? ` · ${bowlingPercent(tracked.spares, tracked.chances)} of spares converted` : "";
    card.append(element("p", "bowling-tracked-line", `From ${tracked.games} tracked game${tracked.games === 1 ? "" : "s"}: ${bowlingPercent(tracked.strikes, tracked.firstBalls)} strikes${spares}.`));
  }
  if (sessions.length) {
    const details = element("details", "bowling-league-weeks");
    details.append(element("summary", "", `Week by week (${sessions.length})`));
    const table = element("table", "bowling-leaves");
    const headRow = element("tr", "");
    for (const text of ["Date", "Games", "Series"]) {
      const cell = element("th", "", text);
      cell.scope = "col";
      headRow.append(cell);
    }
    const thead = element("thead", "");
    thead.append(headRow);
    const body = element("tbody", "");
    for (const session of sessions) {
      const summary = bowlingSeriesSummary(session);
      const row = element("tr", "");
      const date = element("th", "", bowlingFormatDate(session.date, { month: "short", day: "numeric", year: "numeric" }));
      date.scope = "row";
      row.append(date,
        element("td", "", session.games.map((game) => game.score ?? "—").join(" · ")),
        element("td", "", summary.scores.length ? String(summary.total) : "—"));
      body.append(row);
    }
    table.append(thead, body);
    details.append(table);
    card.append(details);
  }

  const footer = element("div", "item-footer bowling-league-actions");
  if (!league.archived) {
    const log = element("button", "", "Log a session");
    log.type = "button";
    log.setAttribute("aria-label", `Log a session for ${league.name}`);
    log.addEventListener("click", () => bowlingLogForLeague(league));
    footer.append(log);
  }
  const edit = element("button", "secondary", "Edit");
  edit.type = "button";
  edit.setAttribute("aria-label", `Edit ${league.name}`);
  edit.addEventListener("click", () => {
    bowlingLeagueDraft = {
      id: league.id, name: league.name, center: league.center, night: league.night === null ? "" : String(league.night),
      time: league.time, team: league.team, seasonStart: league.seasonStart, seasonEnd: league.seasonEnd
    };
    bowlingLeagueStatus = { text: "", error: false };
    bowlingRefresh("bowling-league-name");
    document.getElementById("bowling-league-form-title")?.scrollIntoView({ block: "start", behavior: bowlingScrollBehavior() });
  });
  const archive = element("button", "secondary", league.archived ? "Restore" : "Archive");
  archive.type = "button";
  archive.id = `bowling-league-archive-${league.id}`;
  archive.setAttribute("aria-label", `${league.archived ? "Restore" : "Archive"} ${league.name}`);
  archive.addEventListener("click", () => {
    bowlingCommit((next, now) => {
      const target = next.leagues.find((item) => item.id === league.id);
      if (target) {
        target.archived = !league.archived;
        target.updatedAt = now;
      }
    });
    bowlingLeagueStatus = { text: league.archived ? `${league.name} is active again.` : `${league.name} archived. Its sessions keep the league name.`, error: false };
    bowlingRefresh(archive.id);
  });
  footer.append(edit, archive);
  card.append(footer);
  return card;
}

function createBowlingLeagueView() {
  const state = bowlingGetState();
  const layout = element("div", "bowling-leagues");
  const listPanel = element("section", "bowling-panel bowling-league-list");
  listPanel.setAttribute("aria-labelledby", "bowling-leagues-title");
  const head = element("div", "bowling-panel-head");
  const title = element("h3", "", "Your leagues");
  title.id = "bowling-leagues-title";
  const back = element("a", "bowling-head-link", "League night dashboard");
  back.href = "#bowling";
  head.append(title, back);
  listPanel.append(head);
  const ordered = [...state.leagues.filter((league) => !league.archived), ...state.leagues.filter((league) => league.archived)];
  if (!ordered.length) {
    listPanel.append(element("p", "bowling-empty", "Add your league with its night, center and season. Then pick it from the League menu when you log a session, and its average, high games and week-by-week scores collect here."));
  }
  for (const league of ordered) listPanel.append(createBowlingLeagueCard(league, state));
  const unassigned = state.sessions.filter((session) => session.type === "league" && !session.league).length;
  if (unassigned && state.leagues.length) {
    listPanel.append(element("p", "bowling-league-note", `${unassigned} league session${unassigned === 1 ? " isn't" : "s aren't"} linked to a league yet. Edit ${unassigned === 1 ? "it" : "them"} in League night and pick the league to include ${unassigned === 1 ? "it" : "them"} here.`));
  }
  layout.append(listPanel, createBowlingLeagueForm(state));
  return layout;
}
