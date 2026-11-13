// Capitol Hill member database for the Politics channel.
// Loaded as a classic script before the main app script; element() and showNotice() come from the app.
const congressDataUrl = "data/congress-members.json";
const congressHomeKey = "seven-channels.politics-home-district.v1";
const congressFilterDefaults = { query: "", chamber: "all", state: "all", party: "all", committee: "all" };
let congressFilters = { ...congressFilterDefaults };
let congressLimit = 40;
let congressPromise = null;
let congressData = null;
let congressFailed = false;
let congressRoot = null;
const congressPartyNames = { R: "Republican", D: "Democrat", I: "Independent", ID: "Independent", L: "Libertarian" };
const congressVoteLabels = { Y: "Yea", N: "Nay", P: "Present", X: "Not voting", "-": "Not a member yet" };
const congressSocial = [
  ["twitter", "X", (handle) => `https://x.com/${encodeURIComponent(handle)}`],
  ["facebook", "Facebook", (handle) => `https://www.facebook.com/${encodeURIComponent(handle)}`],
  ["instagram", "Instagram", (handle) => `https://www.instagram.com/${encodeURIComponent(handle)}`],
  ["youtube", "YouTube", (handle) => `https://www.youtube.com/${encodeURIComponent(handle)}`],
  ["youtube_id", "YouTube", (id) => `https://www.youtube.com/channel/${encodeURIComponent(id)}`]
];

function congressView() {
  const match = /^#politics\/members(?:\/([A-Z]\d{6}))?$/.exec(location.hash);
  if (!match) return null;
  return { profile: match[1] || "" };
}

function congressLoad() {
  if (!congressPromise) {
    congressFailed = false;
    congressPromise = fetch(congressDataUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Member data request failed (${response.status}).`);
        return response.json();
      })
      .then((data) => {
        if (!data || !Array.isArray(data.members)) throw new TypeError("Member data has an unexpected format.");
        const members = data.members.filter((member) => member && /^[A-Z]\d{6}$/.test(member.id) && typeof member.name === "string" &&
          ["House", "Senate"].includes(member.chamber) && typeof member.state === "string");
        congressData = {
          generatedAt: typeof data.generatedAt === "string" ? data.generatedAt : "",
          congress: Number.isInteger(data.congress) ? data.congress : null,
          sources: Array.isArray(data.sources) ? data.sources : [],
          rollCalls: data.rollCalls && typeof data.rollCalls === "object" ? data.rollCalls : {},
          members,
          byId: new Map(members.map((member) => [member.id, member]))
        };
        return congressData;
      })
      .catch((error) => {
        console.error("Could not load the member database.", error);
        congressPromise = null;
        congressFailed = true;
        throw error;
      });
  }
  return congressPromise;
}

function congressRefresh(focusId) {
  if (!congressRoot?.isConnected) return;
  const activeId = focusId || document.activeElement?.id;
  const previous = congressRoot;
  const next = createCongressMembersView();
  previous.replaceWith(next);
  if (activeId) document.getElementById(activeId)?.focus({ preventScroll: !focusId });
}

function congressSafeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : "";
  } catch {
    return "";
  }
}

function congressExternal(text, url, label) {
  const href = congressSafeUrl(url);
  if (!href) return element("span", "", text);
  const link = element("a", "congress-external", text);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  if (label) link.setAttribute("aria-label", label);
  return link;
}

function congressOrdinal(value) {
  const number = Number(value);
  if (!Number.isInteger(number)) return String(value);
  const suffix = number % 100 >= 11 && number % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[number % 10] || "th");
  return `${number}${suffix}`;
}

function congressTitle(member) {
  const place = member.stateName || member.state;
  if (member.chamber === "Senate") return `Senator for ${place}`;
  if (member.delegate) return `${member.state === "PR" ? "Resident Commissioner" : "Delegate"} for ${place}`;
  if (member.district === "At Large") return `Representative for ${place} (at large)`;
  return `Representative for ${place}’s ${congressOrdinal(member.district)} District`;
}

function congressShortPlace(member) {
  if (member.chamber === "Senate") return member.state;
  if (member.delegate || member.district === "At Large") return `${member.state}-AL`;
  return `${member.state}-${member.district}`;
}

function congressPartyLabel(member) {
  return congressPartyNames[member.party] || member.partyName || member.party || "No party listed";
}

// Senate classes are elected in a fixed six-year rotation: Class I in 2030, II in 2026, III in 2028 (and every six years after).
function congressNextElection(member, year = new Date().getFullYear()) {
  if (member.chamber === "House") return year % 2 === 0 ? year : year + 1;
  const base = { I: 2024, II: 2026, III: 2028 }[member.senateClass];
  if (!base) return null;
  let next = base;
  while (next < year) next += 6;
  return next;
}

function congressLeadership(member) {
  const roles = (member.detail?.leadership || []).filter((role) => typeof role === "string" && role);
  return [...new Set(roles)];
}

function congressPhoto(member, className) {
  const wrapper = element("span", `${className} congress-party-${(member.party || "").toLowerCase()}`);
  const fallback = () => wrapper.replaceChildren(element("span", "congress-initials", `${member.firstName?.[0] || ""}${member.lastName?.[0] || ""}`));
  const url = congressSafeUrl(member.photo);
  if (!url) {
    fallback();
    return wrapper;
  }
  const image = element("img", "");
  image.src = url;
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", fallback, { once: true });
  wrapper.append(image);
  return wrapper;
}

function congressReadHome() {
  try {
    const saved = JSON.parse(localStorage.getItem(congressHomeKey) || "null");
    if (saved && typeof saved.state === "string" && /^[A-Z]{2}$/.test(saved.state)) {
      return { state: saved.state, district: typeof saved.district === "string" ? saved.district : "" };
    }
  } catch (error) {
    console.error("Could not read your saved state.", error);
  }
  return { state: "", district: "" };
}

function congressSaveHome(home) {
  try {
    if (home.state) localStorage.setItem(congressHomeKey, JSON.stringify(home));
    else localStorage.removeItem(congressHomeKey);
  } catch (error) {
    console.error("Could not save your state.", error);
    if (typeof showNotice === "function") showNotice("Your state couldn’t be saved on this device.");
  }
}

function congressSelect(id, options, value, label) {
  const select = document.createElement("select");
  select.id = id;
  if (label) select.setAttribute("aria-label", label);
  for (const [optionValue, text] of options) {
    const option = element("option", "", text);
    option.value = optionValue;
    option.selected = optionValue === value;
    select.append(option);
  }
  return select;
}

function congressField(labelText, control) {
  const field = element("div", "field");
  const label = element("label", "", labelText);
  label.htmlFor = control.id;
  field.append(label, control);
  return field;
}

function congressTabs(active) {
  const nav = element("nav", "congress-tabs");
  nav.setAttribute("aria-label", "Politics sections");
  for (const [view, label, href] of [["overview", "Overview", "#politics"], ["members", "Members of Congress", "#politics/members"]]) {
    const link = element("a", "", label);
    link.href = href;
    if (view === active) link.setAttribute("aria-current", "page");
    nav.append(link);
  }
  return nav;
}

function congressStates(data) {
  const states = new Map();
  for (const member of data.members) states.set(member.state, member.stateName || member.state);
  return [...states.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

function congressCommittees(data) {
  return [...new Set(data.members.flatMap((member) => (member.committees || []).map((committee) => committee.name)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function congressMatches(member, filters) {
  if (filters.chamber !== "all" && member.chamber !== filters.chamber) return false;
  if (filters.state !== "all" && member.state !== filters.state) return false;
  // "Independent" covers every member who isn't a Republican or Democrat.
  if (filters.party !== "all" && (filters.party === "I" ? ["R", "D"].includes(member.party) : member.party !== filters.party)) return false;
  if (filters.committee !== "all" && !(member.committees || []).some((committee) => committee.name === filters.committee)) return false;
  const words = filters.query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [member.name, member.firstName, member.lastName, member.stateName, member.state, congressShortPlace(member)]
    .filter(Boolean).join(" ").toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

function congressSortMembers(members) {
  return members.slice().sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
}

function congressMemberCard(member) {
  const card = element("a", "congress-card");
  card.href = `#politics/members/${member.id}`;
  card.append(congressPhoto(member, "congress-photo"));
  const body = element("span", "congress-card-body");
  body.append(element("strong", "", member.name));
  body.append(element("small", "", `${member.chamber === "Senate" ? "Senator" : member.delegate ? "Delegate" : "Representative"} · ${congressShortPlace(member)}`));
  const meta = element("span", "congress-card-meta");
  meta.append(element("span", `congress-party congress-party-${(member.party || "").toLowerCase()}`, congressPartyLabel(member)));
  for (const role of congressLeadership(member).slice(0, 1)) meta.append(element("span", "congress-badge", role));
  if ((member.committees || []).some((committee) => committee.role === "Chair")) meta.append(element("span", "congress-badge", "Committee chair"));
  else if ((member.committees || []).some((committee) => committee.role === "Ranking Member")) meta.append(element("span", "congress-badge", "Ranking member"));
  body.append(meta);
  card.append(body);
  return card;
}

function congressDelegation(data) {
  const panel = element("section", "politics-panel congress-delegation");
  panel.setAttribute("aria-labelledby", "congress-delegation-title");
  const title = element("h3", "", "Your delegation");
  title.id = "congress-delegation-title";
  const home = congressReadHome();
  const states = congressStates(data);
  if (home.state && !states.some(([code]) => code === home.state)) home.state = "";
  const controls = element("div", "congress-delegation-controls");
  const state = congressSelect("congress-home-state", [["", "Choose your state"], ...states], home.state);
  const districts = congressSortMembers(data.members.filter((member) => member.chamber === "House" && member.state === home.state))
    .sort((a, b) => (Number(a.district) || 0) - (Number(b.district) || 0));
  const district = congressSelect("congress-home-district", [["", districts.length > 1 ? "All districts" : "District"],
    ...districts.map((member) => [member.district, member.district === "At Large" ? "At large" : `District ${member.district}`])], home.district);
  district.disabled = districts.length <= 1;
  controls.append(congressField("State", state), congressField("District", district));
  const note = element("p", "politics-meta", "Saved on this device only. Not sure of your district? Look it up with your ZIP code on house.gov.");
  note.append(" ", congressExternal("Find your representative ↗", "https://www.house.gov/representatives/find-your-representative"));
  state.addEventListener("change", () => {
    congressSaveHome({ state: state.value, district: "" });
    congressRefresh("congress-home-state");
  });
  district.addEventListener("change", () => {
    congressSaveHome({ state: state.value, district: district.value });
    congressRefresh("congress-home-district");
  });
  panel.append(title, controls);
  if (home.state) {
    const senators = congressSortMembers(data.members.filter((member) => member.chamber === "Senate" && member.state === home.state));
    const reps = districts.filter((member) => !home.district || member.district === home.district || districts.length === 1);
    const list = element("div", "congress-card-grid");
    [...senators, ...reps].forEach((member) => list.append(congressMemberCard(member)));
    panel.append(list);
  }
  panel.append(note);
  return panel;
}

function congressSourceNote(data) {
  const note = element("div", "congress-note");
  const generated = Date.parse(data.generatedAt);
  note.append(element("p", "", `Members, offices, committees and votes come from the House Clerk and Senate.gov; terms and bills from Congress.gov; photos from the Biographical Directory of the U.S. Congress. Social accounts come from the volunteer-maintained @unitedstates congress-legislators project.${Number.isFinite(generated) ? ` Refreshed ${new Date(generated).toLocaleString()}.` : ""}`));
  for (const source of data.sources) {
    if (source.status && source.status !== "ok") note.append(element("p", "congress-warning", `${source.name}: ${source.message || "Not refreshed."}`));
  }
  return note;
}

function congressDirectory(data) {
  const panel = element("section", "politics-panel congress-directory");
  panel.setAttribute("aria-labelledby", "congress-directory-title");
  const title = element("h3", "", "Members of Congress");
  title.id = "congress-directory-title";
  const states = congressStates(data);
  const committees = congressCommittees(data);
  if (congressFilters.state !== "all" && !states.some(([code]) => code === congressFilters.state)) congressFilters.state = "all";
  if (congressFilters.committee !== "all" && !committees.includes(congressFilters.committee)) congressFilters.committee = "all";
  const query = document.createElement("input");
  query.id = "congress-query";
  query.type = "search";
  query.placeholder = "Name or state";
  query.autocomplete = "off";
  query.value = congressFilters.query;
  const chamber = congressSelect("congress-chamber", [["all", "Both chambers"], ["Senate", "Senate"], ["House", "House"]], congressFilters.chamber);
  const state = congressSelect("congress-state", [["all", "All states"], ...states], congressFilters.state);
  const party = congressSelect("congress-party", [["all", "All parties"], ["R", "Republican"], ["D", "Democrat"], ["I", "Independent"]], congressFilters.party);
  const committee = congressSelect("congress-committee", [["all", "All committees"], ...committees.map((name) => [name, name])], congressFilters.committee);
  const filters = element("div", "congress-filters");
  filters.append(congressField("Search", query), congressField("Chamber", chamber), congressField("State", state),
    congressField("Party", party), congressField("Committee", committee));
  const count = element("p", "politics-meta congress-count");
  count.setAttribute("aria-live", "polite");
  const list = element("div", "congress-card-grid");
  const more = element("button", "secondary congress-more", "");
  more.type = "button";
  function render() {
    const matches = congressSortMembers(data.members.filter((member) => congressMatches(member, congressFilters)));
    const shown = matches.slice(0, congressLimit);
    const senate = matches.filter((member) => member.chamber === "Senate").length;
    count.textContent = `${matches.length} member${matches.length === 1 ? "" : "s"} (${senate} senator${senate === 1 ? "" : "s"}, ${matches.length - senate} House)${matches.length > shown.length ? `, showing ${shown.length}` : ""}`;
    list.replaceChildren();
    if (!matches.length) {
      const empty = element("div", "congress-empty");
      const clear = element("button", "secondary", "Clear filters");
      clear.type = "button";
      clear.addEventListener("click", () => {
        congressFilters = { ...congressFilterDefaults };
        congressLimit = 40;
        congressRefresh("congress-query");
      });
      empty.append(element("span", "", "No members match. "), clear);
      list.append(empty);
    }
    shown.forEach((member) => list.append(congressMemberCard(member)));
    more.hidden = matches.length <= shown.length;
    more.textContent = `Show ${Math.min(40, matches.length - shown.length)} more`;
  }
  const update = () => {
    congressFilters = { query: query.value, chamber: chamber.value, state: state.value, party: party.value, committee: committee.value };
    congressLimit = 40;
    render();
  };
  query.addEventListener("input", update);
  [chamber, state, party, committee].forEach((select) => select.addEventListener("change", update));
  more.addEventListener("click", () => {
    congressLimit += 40;
    render();
    list.children[congressLimit - 40]?.focus();
  });
  render();
  panel.append(title, filters, count, list, more);
  return panel;
}

function congressDefinition(list, term, value) {
  if (!value) return;
  const row = element("div", "");
  row.append(element("dt", "", term));
  const description = element("dd", "");
  if (value instanceof Node) description.append(value);
  else description.textContent = value;
  row.append(description);
  list.append(row);
}

function congressPercent(part, whole) {
  return whole ? `${Math.round((part / whole) * 100)}%` : "—";
}

function congressVotingSection(member, data) {
  const section = element("section", "politics-panel congress-votes");
  section.append(element("h3", "", "Voting record"));
  const calls = Array.isArray(data.rollCalls?.[member.chamber]) ? data.rollCalls[member.chamber] : [];
  const votes = member.votes;
  if (!votes || !calls.length || typeof votes.codes !== "string") {
    section.append(element("p", "politics-meta", "Roll-call votes aren’t available right now."));
    return section;
  }
  const eligible = votes.codes.replace(/-/g, "").length;
  const stats = element("div", "congress-stats");
  const stat = (label, value, note) => {
    const item = element("div", "congress-stat");
    item.append(element("span", "", label), element("strong", "", value));
    if (note) item.append(element("small", "", note));
    stats.append(item);
  };
  stat("Votes cast", `${votes.cast} of ${eligible}`, votes.missed ? `${votes.missed} missed` : "None missed");
  const ownParty = ["R", "D"].includes(member.party) ? member.party : "";
  if (ownParty) {
    stat(`With ${ownParty === "R" ? "Republican" : "Democratic"} majority`, congressPercent(ownParty === "R" ? votes.withR : votes.withD, votes.cast), "of yea/nay votes cast");
    stat(`With ${ownParty === "R" ? "Democratic" : "Republican"} majority`, congressPercent(ownParty === "R" ? votes.withD : votes.withR, votes.cast), "of yea/nay votes cast");
  } else {
    stat("With Democratic majority", congressPercent(votes.withD, votes.cast), "of yea/nay votes cast");
    stat("With Republican majority", congressPercent(votes.withR, votes.cast), "of yea/nay votes cast");
  }
  section.append(stats, element("p", "politics-meta",
    `Based on the ${calls.length} most recent ${member.chamber} roll calls this session${calls.length ? `, ${calls[calls.length - 1].date} to ${calls[0].date}` : ""}, not a full career record. Party majority is how most of that party’s members voted.`));
  const list = element("ol", "congress-vote-list");
  calls.slice(0, 15).forEach((call, index) => {
    const code = votes.codes[index] || "-";
    const item = element("li", "");
    const position = element("span", `congress-vote congress-vote-${code === "-" ? "none" : code.toLowerCase()}`, congressVoteLabels[code] || "—");
    const copy = element("div", "congress-vote-copy");
    copy.append(element("strong", "", call.question || "Roll call"));
    if (call.description) copy.append(element("span", "", call.description));
    const majorities = Object.entries(call.partyMajority || {}).map(([party, side]) => `${party === "R" ? "Republicans" : "Democrats"} ${side === "Y" ? "yea" : "nay"}`).join(", ");
    const meta = element("small", "", [call.date, call.result, majorities].filter(Boolean).join(" · "));
    meta.append(" · ", congressExternal("Official record ↗", call.url, `Official record of this ${member.chamber} roll call`));
    copy.append(meta);
    item.append(position, copy);
    list.append(item);
  });
  section.append(list);
  return section;
}

function congressLegislationSection(member) {
  const section = element("section", "politics-panel congress-bills");
  section.append(element("h3", "", "Sponsored legislation"));
  const legislation = member.legislation;
  if (!legislation) {
    section.append(element("p", "politics-meta", "Sponsored bills aren’t available. They need a Congress.gov API key on the site’s daily refresh."));
    return section;
  }
  const stats = element("div", "congress-stats");
  for (const [label, value] of [["Sponsored", legislation.sponsoredCount], ["Cosponsored", legislation.cosponsoredCount]]) {
    const item = element("div", "congress-stat");
    item.append(element("span", "", label), element("strong", "", Number.isFinite(value) ? value.toLocaleString() : "—"));
    stats.append(item);
  }
  section.append(stats, element("p", "politics-meta", "Career totals from Congress.gov, including amendments and resolutions."));
  const recent = Array.isArray(legislation.recent) ? legislation.recent : [];
  if (!recent.length) {
    section.append(element("p", "politics-meta", "No recent bills listed."));
    return section;
  }
  const list = element("ul", "congress-bill-list");
  for (const bill of recent) {
    const item = element("li", "");
    const head = element("div", "congress-bill-head");
    head.append(congressExternal(bill.number, bill.url, `${bill.number} on Congress.gov`));
    if (bill.introduced) head.append(element("small", "", `Introduced ${bill.introduced}`));
    item.append(head, element("span", "", bill.title || "Untitled"));
    if (bill.action) item.append(element("small", "", `Latest: ${bill.action}${bill.actionDate ? ` (${bill.actionDate})` : ""}`));
    list.append(item);
  }
  section.append(list);
  return section;
}

function congressProfile(member, data) {
  const page = element("div", "congress-profile");
  const back = element("a", "nba-data-back", "← All members");
  back.href = "#politics/members";
  const hero = element("section", "politics-panel congress-hero");
  hero.append(congressPhoto(member, "congress-hero-photo"));
  const heading = element("div", "congress-hero-copy");
  const name = element("h3", "", member.name);
  name.id = "congress-profile-name";
  name.tabIndex = -1;
  heading.append(name, element("p", "congress-hero-title", congressTitle(member)));
  const badges = element("div", "congress-card-meta");
  badges.append(element("span", `congress-party congress-party-${(member.party || "").toLowerCase()}`, congressPartyLabel(member)));
  for (const role of congressLeadership(member)) badges.append(element("span", "congress-badge", role));
  heading.append(badges);
  const facts = element("dl", "congress-facts");
  const first = member.detail?.firstYear;
  congressDefinition(facts, "In Congress since", Number.isInteger(first) ? String(first) : "");
  if (member.chamber === "House" && member.swornDate) congressDefinition(facts, "Sworn in this term", member.swornDate);
  if (member.chamber === "Senate" && member.senateClass) congressDefinition(facts, "Senate class", member.senateClass);
  const next = congressNextElection(member);
  if (next) congressDefinition(facts, "Seat next up for election", String(next));
  heading.append(facts);
  hero.append(heading);

  const contact = element("section", "politics-panel congress-contact");
  contact.append(element("h3", "", "Contact"));
  const contactList = element("dl", "congress-facts");
  congressDefinition(contactList, "Washington office", member.office);
  if (member.phone) {
    const phone = element("a", "", member.phone);
    phone.href = `tel:${member.phone.replace(/[^\d+]/g, "")}`;
    congressDefinition(contactList, "Phone", phone);
  }
  if (member.website) congressDefinition(contactList, "Website", congressExternal(member.website.replace(/^https:\/\/|\/$/g, ""), member.website));
  if (member.contactUrl && member.contactUrl !== member.website) congressDefinition(contactList, "Contact form", congressExternal("Send a message ↗", member.contactUrl));
  contact.append(contactList);
  const social = element("div", "congress-social");
  const seen = new Set();
  for (const [key, label, build] of congressSocial) {
    const handle = member.social?.[key];
    if (!handle || typeof handle !== "string" || seen.has(label)) continue;
    seen.add(label);
    social.append(congressExternal(label, build(handle), `${member.name} on ${label}`));
  }
  if (social.childElementCount) {
    contact.append(element("h4", "", "Social media"), social, element("p", "politics-meta", "From the volunteer-maintained @unitedstates congress-legislators list; check the account before relying on it."));
  }

  const committees = element("section", "politics-panel congress-committees");
  committees.append(element("h3", "", "Committees"));
  if (!(member.committees || []).length) committees.append(element("p", "politics-meta", "No committee assignments listed."));
  const committeeList = element("ul", "congress-committee-list");
  for (const committee of member.committees || []) {
    const item = element("li", "");
    const head = element("div", "");
    head.append(element("strong", "", committee.name));
    if (committee.role) head.append(element("span", "congress-badge", committee.role));
    item.append(head);
    if (committee.subcommittees?.length) {
      const subs = element("ul", "");
      for (const sub of committee.subcommittees) {
        const subItem = element("li", "", sub.name);
        if (sub.role) subItem.append(element("span", "congress-badge", sub.role));
        subs.append(subItem);
      }
      item.append(subs);
    }
    committeeList.append(item);
  }
  committees.append(committeeList);
  const grid = element("div", "congress-profile-grid");
  grid.append(contact, committees, congressVotingSection(member, data), congressLegislationSection(member));
  page.append(back, hero, grid, congressSourceNote(data));
  return page;
}

function createCongressMembersView() {
  const view = congressView() || { profile: "" };
  const root = element("div", "congress");
  root.append(congressTabs("members"));
  congressRoot = root;
  if (!congressData) {
    const status = element("p", "politics-status", congressFailed ? "The member database couldn’t be loaded." : "Loading members of Congress…");
    status.setAttribute("role", "status");
    root.append(status);
    if (congressFailed) {
      const retry = element("button", "secondary", "Try again");
      retry.type = "button";
      retry.addEventListener("click", () => {
        congressFailed = false;
        congressRefresh();
        congressLoad().then(() => congressRefresh(), () => congressRefresh());
      });
      root.append(retry);
    } else {
      congressLoad().then(() => congressRefresh(view.profile ? "congress-profile-name" : undefined), () => congressRefresh());
    }
    return root;
  }
  if (view.profile) {
    const member = congressData.byId.get(view.profile);
    if (!member) {
      const missing = element("section", "politics-panel");
      const back = element("a", "", "Browse all members");
      back.href = "#politics/members";
      missing.append(element("h3", "", "Member not found"), element("p", "politics-meta", "This member isn’t in the current Congress list. They may have left office."), back);
      root.append(missing);
      return root;
    }
    root.append(congressProfile(member, congressData));
    return root;
  }
  root.append(congressDelegation(congressData), congressDirectory(congressData), congressSourceNote(congressData));
  return root;
}
