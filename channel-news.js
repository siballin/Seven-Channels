// News column shown on the left of channels without their own news (and the Guide's top headlines).
// Headlines come from data/channel-news.json, built by scripts/update_channel_news.py when the site is published.
// Loaded as a classic script before the main app script; element() comes from the app.

let channelNewsData = null;
let channelNewsRequest = null;
const channelNewsUi = new Map(); // channel id → { source, limit }

function channelNewsLoad() {
  channelNewsRequest ||= fetch("data/channel-news.json")
    .then((response) => {
      if (!response.ok) throw new Error(`Channel news unavailable (${response.status}).`);
      return response.json();
    })
    .then((data) => { channelNewsData = data; return data; })
    .catch((error) => { channelNewsRequest = null; throw error; });
  return channelNewsRequest;
}

function channelNewsSafeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function channelNewsWhen(iso) {
  const time = Date.parse(iso || "");
  if (!Number.isFinite(time)) return "";
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h ago`;
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function createChannelNews(channelId) {
  const isGuide = channelId === "guide";
  const panel = element("section", "channel-news");
  const titleId = `channel-news-title-${channelId}`;
  panel.setAttribute("aria-labelledby", titleId);
  const title = element("h3", "", isGuide ? "Top headlines" : "News");
  title.id = titleId;
  const filters = element("div", "channel-news-filters");
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", isGuide ? "Filter by channel" : "Filter by outlet");
  const status = element("p", "channel-news-status", "Loading headlines…");
  status.setAttribute("role", "status");
  const list = element("ol", "channel-news-list");
  const more = element("button", "secondary channel-news-more", "Show more");
  more.type = "button";
  more.hidden = true;
  panel.append(title, filters, list, more, status);
  const ui = channelNewsUi.get(channelId) || { source: "all", limit: 10 };
  channelNewsUi.set(channelId, ui);

  const render = (block) => {
    if (block?.title) title.textContent = block.title;
    const key = isGuide ? "channelName" : "source";
    const items = (Array.isArray(block?.items) ? block.items : [])
      .filter((item) => item && typeof item.title === "string" && item.title.trim() && channelNewsSafeUrl(item.url));
    const groups = isGuide ? [...new Set(items.map((item) => item.channelName))] : (block?.sources || []).map((source) => source.name);
    filters.replaceChildren();
    for (const [value, label] of [["all", "All"], ...groups.map((name) => [name, name])]) {
      const count = value === "all" ? items.length : items.filter((item) => item[key] === value).length;
      if (value !== "all" && !count) continue;
      const button = element("button", "secondary", `${label} ${count}`);
      button.type = "button";
      button.id = `channel-news-${channelId}-${value.replace(/\W+/g, "-").toLowerCase()}`;
      button.setAttribute("aria-pressed", String(ui.source === value));
      button.addEventListener("click", () => {
        ui.source = value;
        ui.limit = 10;
        render(block);
        document.getElementById(button.id)?.focus();
      });
      filters.append(button);
    }
    filters.hidden = filters.childElementCount < 3;
    const shown = items.filter((item) => ui.source === "all" || item[key] === ui.source);
    list.replaceChildren();
    for (const item of shown.slice(0, ui.limit)) {
      const row = element("li", "channel-news-item");
      const meta = element("span", "channel-news-meta");
      if (isGuide && item.channel) {
        const channelLink = element("a", "channel-news-channel", item.channelName);
        channelLink.href = `#${item.channel}`;
        channelLink.dataset.channel = item.channel;
        meta.append(channelLink, document.createTextNode(` · ${item.source}`));
      } else {
        meta.append(element("strong", "", item.source));
      }
      if (item.published) meta.append(document.createTextNode(` · ${channelNewsWhen(item.published)}`));
      const link = element("a", "channel-news-title", item.title);
      link.href = channelNewsSafeUrl(item.url);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      row.append(meta, link);
      list.append(row);
    }
    if (!shown.length) list.append(element("li", "channel-news-empty", items.length ? "No recent headlines from this outlet." : "No headlines yet."));
    more.hidden = shown.length <= ui.limit;
    const fetched = Date.parse(channelNewsData?.fetchedAt || "");
    const missing = (block?.sources || []).filter((source) => source.status === "stale" || source.status === "unavailable").map((source) => `${source.name} ${source.status === "stale" ? "not refreshed" : "unavailable"}`);
    status.textContent = [Number.isFinite(fetched) ? `Updated ${new Date(fetched).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "",
      ...missing, "Headlines open on each outlet’s site."].filter(Boolean).join(" · ");
  };
  more.addEventListener("click", () => {
    ui.limit += 10;
    render(isGuide ? channelNewsData?.guide : channelNewsData?.channels?.[channelId]);
  });
  channelNewsLoad().then((data) => {
    render(isGuide ? data.guide : data.channels?.[channelId]);
  }).catch((error) => {
    console.error("Could not load channel news.", error);
    status.textContent = "Headlines couldn’t be loaded right now.";
  });
  return panel;
}

// Puts the news column on the left of a channel's content (below it on narrow screens).
function withChannelNews(channelId, content) {
  const layout = element("div", "news-layout");
  const aside = element("aside", "news-layout-side");
  aside.setAttribute("aria-label", channelId === "guide" ? "Top headlines" : "News");
  aside.append(createChannelNews(channelId));
  const main = element("div", "news-layout-main");
  main.append(...content);
  layout.append(aside, main);
  return layout;
}
