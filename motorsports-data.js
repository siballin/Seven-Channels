// Motorsports summary for the Guide row and This week (the next race and last winner per series).
// data/motorsports/summary.json is built by scripts/update_motorsports.py. The channel's own views live in motorsports.js.

const motorsportsSeries = [["f1", "F1"], ["nascar", "NASCAR"], ["imsa", "IMSA"], ["wec", "WEC"]];
let motorsportsSummary = null;
let motorsportsSummaryRequest = null;

function loadMotorsportsSummary() {
  motorsportsSummaryRequest ||= fetch(new URL("data/motorsports/summary.json", location.href))
    .then((response) => {
      if (!response.ok) throw new Error(`Motorsports summary unavailable (${response.status}).`);
      return response.json();
    })
    .then((data) => { motorsportsSummary = Array.isArray(data.series) ? data.series : []; return motorsportsSummary; })
    .catch((error) => { motorsportsSummaryRequest = null; console.warn(error); return []; });
  return motorsportsSummaryRequest;
}

function motorsportsShortDate(start) {
  if (!start) return "";
  const date = /T/.test(start) ? new Date(start) : new Date(`${start}T12:00:00`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Guide cells: [on now / this weekend, up next, in the books]. Returns placeholders until the summary loads,
// then re-renders the Guide once.
function motorsportsGuideCells() {
  if (!motorsportsSummary) {
    loadMotorsportsSummary().then(() => { if (typeof currentRoute === "function" && currentRoute() === "guide" && typeof render === "function") render(); });
    return [{ title: "", note: "" }, { title: "", note: "" }, { title: "", note: "" }];
  }
  const short = Object.fromEntries(motorsportsSeries);
  const now = Date.now();
  const soonest = motorsportsSummary.filter((item) => item.next?.start).sort((a, b) => a.next.start.localeCompare(b.next.start));
  const thisWeekend = soonest.filter((item) => new Date(item.next.start) - now < 4 * 86400000);
  const latest = motorsportsSummary.filter((item) => item.last?.start).sort((a, b) => b.last.start.localeCompare(a.last.start))[0];
  return [
    thisWeekend.length ? { title: `${short[thisWeekend[0].id]} · ${thisWeekend[0].next.name}`, note: motorsportsShortDate(thisWeekend[0].next.start) } : { title: "No race this weekend", note: "" },
    soonest[0] ? { title: `${short[soonest[0].id]} · ${soonest[0].next.name}`, note: motorsportsShortDate(soonest[0].next.start) } : { title: "Off-season", note: "Calendars for next season aren’t out yet" },
    latest ? { title: `${latest.last.winner || "Result in"}`, note: `${short[latest.id]} · ${latest.last.name}` } : { title: "", note: "" },
  ];
}

// This week: each series' next race if it falls in the week.
async function motorsportsThisWeek(days) {
  const summary = await loadMotorsportsSummary();
  const first = days[0];
  const last = days[days.length - 1];
  const short = Object.fromEntries(motorsportsSeries);
  return summary.filter((item) => item.next?.start).map((item) => {
    const start = item.next.start;
    const local = /T/.test(start) ? new Date(start) : null;
    const day = local ? `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}` : start.slice(0, 10);
    return { kind: "race", label: short[item.id] || item.name, date: day,
      time: local ? `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}` : "",
      title: item.next.name, note: item.next.track || "", href: `#motorsports/${item.id}` };
  }).filter((item) => item.date >= first && item.date <= last);
}
