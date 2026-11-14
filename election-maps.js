// Election maps for the Politics channel: presidential results 1980–2024 and midterms 1982–2026.
// Loaded as a classic script before the main app script; element() comes from the app.
const electionBase = "data/elections/";
const electionCache = new Map();
const electionPartyNames = { D: "Democratic", R: "Republican", I: "Independent", L: "Libertarian", G: "Green", O: "Other" };
const electionRaces = [["president", "Presidential"], ["senate", "Senate"], ["house", "House"]];
const electionStateNames = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
};
let electionRoot = null;
let electionSelected = "";
let electionZoom = "";
let electionIndex = null;
let electionLastView = "";
let electionPendingFocus = "";

function electionView() {
  const match = /^#politics\/elections(?:\/(president|senate|house)(?:\/(\d{4}))?)?$/.exec(location.hash);
  if (!match) return null;
  return { race: match[1] || "", year: match[2] ? Number(match[2]) : null };
}

function electionFetch(name) {
  if (!electionCache.has(name)) {
    const request = fetch(electionBase + name).then((response) => {
      if (!response.ok) throw new Error(`${name} request failed (${response.status}).`);
      return response.json();
    });
    request.catch(() => electionCache.delete(name));
    electionCache.set(name, request);
  }
  return electionCache.get(name);
}

function electionRefresh(focusId) {
  if (!electionRoot?.isConnected) return;
  // The view fills in after its data loads, so focus is applied once it has rendered.
  electionPendingFocus = focusId || document.activeElement?.id || "";
  const previous = electionRoot;
  const next = createElectionMapsView();
  previous.replaceWith(next);
}

function electionHash(race, year) {
  return `#politics/elections/${race}/${year}`;
}

function electionYears(race) {
  if (!electionIndex) return [];
  return race === "president" ? electionIndex.presidentYears : electionIndex.midtermYears;
}

function electionOrdinal(number) {
  const suffix = number % 100 >= 11 && number % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[number % 10] || "th");
  return `${number}${suffix}`;
}

function electionDistrictName(key) {
  const [state, number] = key.split("-");
  const name = electionStateNames[state] || state;
  return Number(number) === 0 ? `${name} at-large` : `${name}’s ${electionOrdinal(Number(number))} District`;
}

// Margin bins: under 5, 5–15, 15–30, 30+ points.
function electionShade(race) {
  if (!race) return "none";
  if (race.called === false) return "uncalled";
  const party = ["D", "R"].includes(race.winner) ? race.winner.toLowerCase() : race.winner ? "o" : "none";
  if (party === "none") return "none";
  if (race.uncontested) return `${party}4`;
  const margin = race.margin;
  if (margin === null || margin === undefined) return `${party}3`;
  return `${party}${margin < 5 ? 1 : margin < 15 ? 2 : margin < 30 ? 3 : 4}`;
}

function electionNumber(value) {
  return Number.isFinite(value) ? value.toLocaleString() : "—";
}

function electionMarginText(race) {
  if (!race) return "No race";
  if (race.called === false) return "Not yet called";
  if (race.uncontested) return "Uncontested";
  if (race.margin === null || race.margin === undefined) return "Margin not yet available";
  return `Won by ${race.margin.toFixed(1)} points`;
}

function electionCandidateList(race) {
  const list = element("ul", "election-candidates");
  const total = race?.total;
  for (const candidate of race?.candidates || []) {
    const item = element("li", candidate.name === race.winnerName ? "is-winner" : "");
    item.append(element("span", `election-dot election-${["D", "R"].includes(candidate.party) ? candidate.party.toLowerCase() : "o"}`));
    const name = element("span", "election-candidate-name", candidate.name);
    item.append(name, element("small", "", electionPartyNames[candidate.party] || "Other"));
    const pct = Number.isFinite(candidate.pct) ? candidate.pct : total && Number.isFinite(candidate.votes) ? (candidate.votes / total) * 100 : null;
    const figures = [pct !== null ? `${pct.toFixed(1)}%` : "", Number.isFinite(candidate.votes) ? `${candidate.votes.toLocaleString()} votes` : ""].filter(Boolean).join(" · ");
    if (figures) item.append(element("small", "election-figures", figures));
    if (candidate.name === race.winnerName) item.append(element("span", "election-badge", "Won"));
    list.append(item);
  }
  if (!list.childElementCount && race?.uncontested) list.append(element("li", "", `${race.winnerName} (${electionPartyNames[race.winner] || "Other"}) ran unopposed.`));
  return list;
}

// ---------- Summaries ----------

function electionBalance(label, before, after, preliminary) {
  const box = element("div", "election-balance");
  box.append(element("h4", "", label));
  const row = (title, data) => {
    const line = element("div", "election-balance-row");
    line.append(element("span", "", title));
    const bar = element("div", "election-bar");
    const total = (data.D || 0) + (data.R || 0) + (data.O || 0) + (data.I || 0) + (data.vacant || 0) + (data.uncalled || 0);
    for (const [key, cls, name] of [["D", "d", "Democrats"], ["O", "o", "Other"], ["I", "o", "Independent"], ["uncalled", "uncalled", "Not called"], ["vacant", "none", "Vacant"], ["R", "r", "Republicans"]]) {
      if (!data[key]) continue;
      const part = element("span", `election-bar-part election-${cls}`);
      part.style.flexGrow = String(data[key]);
      part.title = `${name}: ${data[key]}`;
      bar.append(part);
    }
    if (total) {
      const marker = element("span", "election-bar-majority");
      marker.style.left = `${(Math.floor(total / 2) + 1) / total * 100}%`;
      bar.append(marker);
    }
    const text = [`D ${data.D || 0}`, `R ${data.R || 0}`, (data.O || data.I) ? `Other ${(data.O || 0) + (data.I || 0)}` : "", data.uncalled ? `${data.uncalled} not called` : "", data.vacant ? `${data.vacant} vacant` : ""].filter(Boolean).join(" · ");
    line.append(bar, element("small", "", text));
    return line;
  };
  if (before) box.append(row("Before", before));
  if (after) box.append(row(preliminary ? "Called so far" : "After", after));
  return box;
}

function electionPresidentSummary(data) {
  const panel = element("div", "election-summary");
  const leaders = data.candidates.filter((candidate) => candidate.ev || candidate.pct >= 1).slice(0, 4);
  const cards = element("div", "election-summary-cards");
  for (const candidate of leaders) {
    const card = element("div", `election-candidate-card election-border-${["D", "R"].includes(candidate.party) ? candidate.party.toLowerCase() : "o"}`);
    card.append(element("strong", "", candidate.name), element("small", "", electionPartyNames[candidate.party] || "Other"));
    const figures = element("div", "election-card-figures");
    figures.append(element("span", "", `${candidate.ev} electoral`), element("span", "", Number.isFinite(candidate.pct) && candidate.pct > 0 ? `${candidate.pct.toFixed(1)}% popular` : ""));
    card.append(figures);
    if (candidate.ev >= 270) card.append(element("span", "election-badge", "Elected"));
    cards.append(card);
  }
  const bar = element("div", "election-bar election-ev-bar");
  bar.setAttribute("aria-hidden", "true");
  for (const candidate of data.candidates.filter((item) => item.ev).sort((a, b) => (a.party === "D" ? -1 : b.party === "D" ? 1 : a.party === "R" ? 1 : b.party === "R" ? -1 : 0))) {
    const part = element("span", `election-bar-part election-${["D", "R"].includes(candidate.party) ? candidate.party.toLowerCase() : "o"}`);
    part.style.flexGrow = String(candidate.ev);
    part.title = `${candidate.name}: ${candidate.ev}`;
    bar.append(part);
  }
  const marker = element("span", "election-bar-majority");
  marker.style.left = `${270 / 538 * 100}%`;
  bar.append(marker);
  panel.append(cards, bar, element("p", "politics-meta", `270 electoral votes needed to win. ${electionNumber(data.totalVotes)} votes cast.`));
  return panel;
}

function electionMidtermSummary(data, race) {
  const panel = element("div", "election-summary");
  const block = race === "senate" ? data.senate : data.house;
  if (data.preliminary) {
    const after = { ...block.called, uncalled: block.uncalled };
    const balance = race === "senate"
      ? electionBalance("Senate races this year", null, after, true)
      : electionBalance("House seats", block.before, after, true);
    panel.append(balance);
    if (race === "senate") panel.append(element("p", "politics-meta", `Before the election: ${block.before.D} Democrats, ${block.before.R} Republicans, ${block.before.O} others. ${block.races.length} seats were up.`));
  } else {
    panel.append(electionBalance(race === "senate" ? "Senate balance" : "House balance", block.before, block.after, false));
  }
  const flips = race === "senate"
    ? block.races.filter((item) => item.flip)
    : Object.entries(block.districts).filter(([, item]) => item.flip).map(([key, item]) => ({ ...item, key }));
  if (race === "senate" || data.preliminary) {
    const label = race === "senate" ? "Seats changing party" : "Seats changing party (called so far)";
    const names = flips.map((item) => `${item.state || item.key}${item.special ? " (special)" : ""} → ${electionPartyNames[item.winner] || "Other"}`);
    const byParty = ["D", "R", "I", "O"].map((party) => [party, flips.filter((item) => item.winner === party).length]).filter(([, count]) => count);
    const counts = byParty.map(([party, count]) => `${count} to ${electionPartyNames[party] === "Democratic" ? "Democrats" : electionPartyNames[party] === "Republican" ? "Republicans" : "others"}`).join(", ");
    if (flips.length > 12) {
      // Long lists (a wave House year) go in a collapsible list so the map stays near the top.
      const more = element("details", "election-flips");
      more.append(element("summary", "", `${label}: ${flips.length} (${counts})`), element("p", "politics-meta", names.join(", ")));
      panel.append(more);
    } else {
      const list = element("p", "politics-meta election-flips");
      list.append(element("strong", "", `${label}: `), flips.length ? names.join(", ") : "None");
      panel.append(list);
    }
  }
  if (race === "house" && !data.preliminary) {
    const change = (block.after.R || 0) - (block.before.R || 0);
    panel.append(element("p", "politics-meta", change === 0 ? "No net change in party control of seats."
      : `Net change: Republicans ${change > 0 ? "+" : ""}${change}, Democrats ${change > 0 ? "" : "+"}${-change}.`));
  }
  return panel;
}

// ---------- Map ----------

function electionMapSvg(shapes, kind, results, onSelect) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", shapes.viewBox);
  svg.setAttribute("class", "election-map");
  svg.setAttribute("role", "img");
  const fillLayer = document.createElementNS(ns, "g");
  const keys = Object.keys(kind === "house" ? shapes.districts : shapes.states);
  for (const key of keys) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", (kind === "house" ? shapes.districts : shapes.states)[key]);
    const result = results(key);
    path.setAttribute("class", `election-shape election-fill-${electionShade(result)}${electionSelected === key ? " is-selected" : ""}`);
    path.dataset.key = key;
    fillLayer.append(path);
  }
  svg.append(fillLayer);
  if (kind === "house") {
    const outline = document.createElementNS(ns, "g");
    outline.setAttribute("class", "election-state-outline");
    for (const [key, d] of Object.entries(shapes.states)) {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", d);
      path.dataset.state = key;
      outline.append(path);
    }
    svg.append(outline);
  }
  const target = (event) => event.target.closest?.("[data-key]");
  svg.addEventListener("click", (event) => {
    const shape = target(event);
    if (shape) onSelect(shape.dataset.key);
  });
  return svg;
}

function electionTooltip(wrapper, svg, describe) {
  const tip = element("div", "election-tooltip");
  tip.hidden = true;
  wrapper.append(tip);
  svg.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    const shape = event.target.closest?.("[data-key]");
    if (!shape) {
      tip.hidden = true;
      return;
    }
    tip.replaceChildren(...describe(shape.dataset.key));
    tip.hidden = false;
    const box = wrapper.getBoundingClientRect();
    tip.style.left = `${Math.min(event.clientX - box.left + 14, box.width - 230)}px`;
    tip.style.top = `${event.clientY - box.top + 14}px`;
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; });
}

function electionZoomTo(svg, shapes, state) {
  if (!state) {
    svg.setAttribute("viewBox", shapes.viewBox);
    return;
  }
  const outline = svg.querySelector(`[data-state="${CSS.escape(state)}"]`);
  if (!outline) return;
  const box = outline.getBBox();
  const pad = Math.max(box.width, box.height) * 0.08 + 2;
  svg.setAttribute("viewBox", `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`);
  svg.classList.toggle("is-zoomed", true);
}

function electionLegend(preliminary, kind) {
  const legend = element("div", "election-legend");
  legend.setAttribute("aria-label", "Map key");
  for (const [party, name] of [["d", "Democratic"], ["r", "Republican"]]) {
    const row = element("div", "election-legend-row");
    row.append(element("span", "election-legend-label", name));
    [["1", "<5"], ["2", "5–15"], ["3", "15–30"], ["4", "30+"]].forEach(([bin, text]) => {
      const swatch = element("span", `election-swatch election-fill-${party}${bin}`);
      swatch.title = `${name}, won by ${text} points`;
      row.append(swatch, element("small", "", text));
    });
    legend.append(row);
  }
  const extras = element("div", "election-legend-row");
  extras.append(element("span", "election-swatch election-fill-o3"), element("small", "", "Independent or other"));
  if (preliminary) extras.append(element("span", "election-swatch election-fill-uncalled"), element("small", "", "Not yet called"));
  if (kind === "senate") extras.append(element("span", "election-swatch election-fill-none"), element("small", "", "No race"));
  extras.append(element("small", "", preliminary
    ? "Margin in percentage points. Called races without vote shares yet use the middle shade."
    : "Margin in percentage points; uncontested races use the darkest shade."));
  legend.append(extras);
  return legend;
}

function electionDetail(kind, key, result, extra) {
  const panel = element("section", "election-detail");
  panel.setAttribute("aria-live", "polite");
  if (!key) {
    panel.append(element("p", "politics-meta", `Select a ${kind === "house" ? "district" : "state"} on the map or in the table below to see its results.`));
    return panel;
  }
  const title = element("h4", "", kind === "house" ? electionDistrictName(key) : electionStateNames[key] || key);
  title.id = "election-detail-title";
  title.tabIndex = -1;
  panel.append(title);
  if (!result) {
    panel.append(element("p", "politics-meta", kind === "senate" ? "No Senate race this year." : "No results available."));
    return panel;
  }
  const races = Array.isArray(result) ? result : [result];
  for (const race of races) {
    if (races.length > 1 || race.special) panel.append(element("h5", "", race.special ? "Special election" : "Regular election"));
    const meta = [electionMarginText(race)];
    if (race.flip) meta.push(`${electionPartyNames[race.winner] || "Other"} gain${race.previousParty ? ` from ${electionPartyNames[race.previousParty] || "Other"}` : ""}`);
    if (race.runoff) meta.push("Decided in a runoff");
    panel.append(element("p", "election-detail-meta", meta.join(" · ")));
    panel.append(electionCandidateList(race));
    if (race.result) panel.append(element("p", "politics-meta", race.result));
  }
  if (extra) panel.append(extra);
  return panel;
}

function electionTable(kind, entries, onSelect) {
  const details = element("details", "election-table");
  details.append(element("summary", "", kind === "house" ? "Results by district" : "Results by state"));
  const table = element("table", "");
  const head = element("tr", "");
  [kind === "house" ? "District" : "State", "Winner", "Party", "Margin", ...(kind === "president" ? ["Electoral votes"] : [])].forEach((text) => head.append(element("th", "", text)));
  const thead = element("thead", "");
  thead.append(head);
  const tbody = element("tbody", "");
  for (const [key, race, ev] of entries) {
    const row = element("tr", "");
    const cell = element("td", "");
    const button = element("button", "election-link", kind === "house" ? electionDistrictName(key) : electionStateNames[key] || key);
    button.type = "button";
    button.addEventListener("click", () => onSelect(key));
    cell.append(button);
    row.append(cell, element("td", "", race?.winnerName || (race?.called === false ? "Not yet called" : "—")),
      element("td", "", race?.winner ? electionPartyNames[race.winner] || "Other" : "—"), element("td", "", electionMarginText(race)));
    if (kind === "president") row.append(element("td", "", ev || ""));
    tbody.append(row);
  }
  table.append(thead, tbody);
  details.append(table);
  return details;
}

// ---------- View ----------

function electionControls(race, year) {
  const controls = element("div", "election-controls");
  const tabs = element("div", "election-race-tabs");
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "Election type");
  for (const [value, label] of electionRaces) {
    const link = element("a", "", label);
    const years = electionYears(value);
    const target = value === race ? year : value === "president" ? years.filter((item) => item <= year).pop() || years[0] : years.filter((item) => item <= year + 2).pop() || years[0];
    link.href = electionHash(value, target);
    if (value === race) link.setAttribute("aria-current", "page");
    tabs.append(link);
  }
  const years = electionYears(race);
  const index = years.indexOf(year);
  const stepper = element("div", "election-year");
  const previous = element("a", "election-step", "‹");
  previous.setAttribute("aria-label", "Previous election");
  if (index > 0) previous.href = electionHash(race, years[index - 1]); else previous.setAttribute("aria-disabled", "true");
  const slider = document.createElement("input");
  slider.type = "range";
  slider.id = "election-year-slider";
  slider.min = "0";
  slider.max = String(years.length - 1);
  slider.value = String(Math.max(0, index));
  slider.setAttribute("aria-label", "Election year");
  slider.setAttribute("aria-valuetext", String(year));
  slider.addEventListener("input", () => {
    slider.setAttribute("aria-valuetext", String(years[Number(slider.value)]));
    label.textContent = String(years[Number(slider.value)]);
  });
  slider.addEventListener("change", () => {
    electionSelected = "";
    location.hash = electionHash(race, years[Number(slider.value)]);
  });
  const label = element("strong", "election-year-label", String(year));
  const next = element("a", "election-step", "›");
  next.setAttribute("aria-label", "Next election");
  if (index < years.length - 1) next.href = electionHash(race, years[index + 1]); else next.setAttribute("aria-disabled", "true");
  stepper.append(previous, label, slider, next);
  controls.append(tabs, stepper);
  return controls;
}

function electionSources(data, race) {
  const note = element("div", "election-sources");
  if (data?.preliminary) {
    const source = data.source || {};
    const fetched = Date.parse(source.fetchedAt || "");
    const text = element("p", "election-preliminary", `Preliminary results from Wikipedia${Number.isFinite(fetched) ? `, refreshed ${new Date(fetched).toLocaleString()}` : ""}. Counts and calls can change until states certify. Text is available under `);
    const license = element("a", "", "CC BY-SA 4.0");
    license.href = source.licenseUrl || "https://creativecommons.org/licenses/by-sa/4.0/";
    license.target = "_blank";
    license.rel = "noopener noreferrer";
    text.append(license, ". Sources: ");
    (source.pages || []).forEach((page, i) => {
      const link = element("a", "", page.title);
      link.href = page.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      text.append(...(i ? [", "] : []), link);
    });
    text.append(".");
    note.append(text);
  }
  const list = element("p", "politics-meta");
  list.append("Results: ");
  (electionIndex?.sources || []).forEach((source, i) => {
    const link = element("a", "", source.name);
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    list.append(...(i ? ["; "] : []), `${source.label}, `, link);
  });
  list.append(". MIT’s datasets are compiled from official state results by a university research lab.");
  note.append(list);
  if (race === "house") note.append(element("p", "politics-meta", "District lines are the ones used in that election. 1982–1990 maps lack New York’s 33rd District, whose boundary isn’t in the source data; its result is in the table."));
  return note;
}

function createElectionMapsView() {
  const root = element("div", "congress election-maps");
  root.append(congressTabs("elections"));
  electionRoot = root;
  const panel = element("section", "politics-panel election-panel");
  panel.setAttribute("aria-labelledby", "election-title");
  root.append(panel);
  const status = element("p", "politics-status", "Loading election maps…");
  status.setAttribute("role", "status");
  panel.append(status);
  const view = electionView() || { race: "", year: null };
  electionFetch("index.json").then((index) => {
    electionIndex = index;
    const race = view.race || "president";
    const years = electionYears(race);
    const year = years.includes(view.year) ? view.year : years[years.length - 1];
    if (view.race !== race || view.year !== year) {
      history.replaceState(null, "", electionHash(race, year));
    }
    // A selection belongs to one map; the House zoom carries across years so you can follow a state.
    const viewKey = `${race}/${year}`;
    if (electionLastView !== viewKey) {
      if (electionLastView.split("/")[0] !== race) electionZoom = "";
      electionSelected = "";
      electionLastView = viewKey;
    }
    const isMidterm = race !== "president";
    return Promise.all([
      electionFetch(isMidterm ? `midterm-${year}.json` : "president.json"),
      electionFetch(race === "house" ? `map-districts-${year}.json` : "map-states.json")
    ]).then(([data, shapes]) => ({ race, year, data: isMidterm ? data : data.years[String(year)], shapes }));
  }).then(({ race, year, data, shapes }) => {
    if (electionRoot !== root) return;
    const title = element("h3", "", `${year} ${race === "president" ? "presidential election" : race === "senate" ? "Senate elections" : "House elections"}`);
    title.id = "election-title";
    const heading = element("div", "election-heading");
    heading.append(title);
    if (data.preliminary) heading.append(element("span", "election-badge election-badge-warn", "Preliminary"));
    const results = race === "president" ? (key) => data.states[key]
      : race === "senate" ? (key) => {
        const races = data.senate.races.filter((item) => item.state === key);
        if (!races.length) return null;
        return races.find((item) => !item.special) || races[0];
      }
      : (key) => data.house.districts[key];
    const fullResult = race === "senate" ? (key) => {
      const races = data.senate.races.filter((item) => item.state === key);
      return races.length ? races : null;
    } : results;
    const wrapper = element("div", "election-map-wrap");
    const select = (key) => {
      electionSelected = key;
      if (race === "house") electionZoom = key.split("-")[0];
      electionRefresh("election-detail-title");
    };
    const svg = electionMapSvg(shapes, race, results, select);
    const label = race === "president" ? `Map of ${year} presidential results by state` : race === "senate" ? `Map of ${year} Senate races by state` : `Map of ${year} House results by district`;
    svg.setAttribute("aria-label", `${label}. Use the results table below the map for the same information.`);
    wrapper.append(svg);
    electionTooltip(wrapper, svg, (key) => {
      const result = results(key);
      const lines = [element("strong", "", race === "house" ? electionDistrictName(key) : electionStateNames[key] || key)];
      if (result) {
        lines.push(element("span", "", result.winnerName ? `${result.winnerName} (${electionPartyNames[result.winner] || "Other"})` : "Not yet called"));
        lines.push(element("small", "", electionMarginText(result)));
        if (race === "president" && result.ev) lines.push(element("small", "", `${result.ev} electoral votes`));
      } else {
        lines.push(element("small", "", race === "senate" ? "No race" : "No results"));
      }
      return lines;
    });
    const tools = element("div", "election-map-tools");
    if (race === "house") {
      const states = Object.keys(shapes.states).sort((a, b) => (electionStateNames[a] || a).localeCompare(electionStateNames[b] || b));
      const zoom = document.createElement("select");
      zoom.id = "election-zoom";
      zoom.setAttribute("aria-label", "Zoom to a state");
      zoom.append(new Option("Whole country", ""));
      states.forEach((state) => zoom.append(new Option(electionStateNames[state] || state, state, false, state === electionZoom)));
      zoom.addEventListener("change", () => {
        electionZoom = zoom.value;
        electionRefresh("election-zoom");  // also narrows the results table to that state
      });
      tools.append(zoom);
      requestAnimationFrame(() => electionZoomTo(svg, shapes, electionZoom));
    }
    let extra = null;
    if (race === "president" && electionSelected && data.states[electionSelected]) {
      const allocation = data.states[electionSelected].evAllocation || {};
      extra = element("p", "politics-meta", `Electoral votes: ${Object.entries(allocation).map(([who, count]) => `${electionPartyNames[who] ? electionPartyNames[who] : who} ${count}`).join(", ")}`);
    }
    const detail = electionDetail(race, electionSelected, electionSelected ? fullResult(electionSelected) : null, extra);
    const entries = race === "president" ? Object.keys(data.states).sort((a, b) => (electionStateNames[a] || a).localeCompare(electionStateNames[b] || b)).map((key) => [key, data.states[key], data.states[key].ev])
      : race === "senate" ? data.senate.races.map((item) => [item.state, item]).sort((a, b) => (electionStateNames[a[0]] || "").localeCompare(electionStateNames[b[0]] || ""))
      : Object.keys(data.house.districts).sort((a, b) => {
        const [sa, na] = a.split("-"); const [sb, nb] = b.split("-");
        return (electionStateNames[sa] || sa).localeCompare(electionStateNames[sb] || sb) || Number(na) - Number(nb);
      }).filter((key) => !electionZoom || key.startsWith(`${electionZoom}-`)).map((key) => [key, data.house.districts[key]]);
    const layout = element("div", "election-layout");
    const mapColumn = element("div", "election-map-column");
    mapColumn.append(tools, wrapper, electionLegend(Boolean(data.preliminary), race));
    layout.append(mapColumn, detail);
    panel.replaceChildren(heading, electionControls(race, year),
      race === "president" ? electionPresidentSummary(data) : electionMidtermSummary(data, race),
      layout, electionTable(race, entries, select), electionSources(race === "president" ? null : data, race));
    if (race === "house" && electionZoom) panel.querySelector(".election-table summary").textContent = `Results by district: ${electionStateNames[electionZoom] || electionZoom}`;
    if (electionPendingFocus) {
      document.getElementById(electionPendingFocus)?.focus({ preventScroll: electionPendingFocus !== "election-detail-title" });
      electionPendingFocus = "";
    }
  }).catch((error) => {
    console.error("Could not load election maps.", error);
    if (electionRoot !== root) return;
    const retry = element("button", "secondary", "Try again");
    retry.type = "button";
    retry.addEventListener("click", () => electionRefresh());
    status.textContent = "Election maps couldn’t be loaded. ";
    status.append(retry);
  });
  return root;
}
