// News row at the top of each channel (and the Guide's top headlines): thumbnail cards with outlet icons.
// Headlines come from data/channel-news.json, built by scripts/update_channel_news.py when the site is published.
// Loaded as a classic script before the main app script; element() comes from the app.

let channelNewsData = null;
let channelNewsRequest = null;
const channelNewsUi = new Map(); // channel id → { source, limit }
const channelNewsStep = 10; // 10 fills two rows of 5, five of 2, or ten of 1 (see .channel-news-list)

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

// The outlet's site icon, by the domain of its homepage (or the story's own site).
function channelNewsIcon(item, size = 16) {
  const page = channelNewsSafeUrl(item.home || "") || channelNewsSafeUrl(item.url || "");
  if (!page) return null;
  const host = new URL(page).hostname;
  if (host === "news.google.com") return null;
  const icon = element("img", "channel-news-icon");
  icon.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  icon.alt = "";
  icon.width = size;
  icon.height = size;
  icon.loading = "lazy";
  icon.referrerPolicy = "no-referrer";
  icon.addEventListener("error", () => icon.remove(), { once: true });
  return icon;
}

function channelNewsPlaceholder(item) {
  const box = element("span", "channel-news-placeholder");
  const icon = channelNewsIcon(item, 36);
  if (icon) box.append(icon);
  box.append(element("span", "", item.source));
  return box;
}

function channelNewsCard(item, isGuide) {
  const url = channelNewsSafeUrl(item.url);
  const card = element("li", "channel-news-card");
  // The picture links to the story too; it's decorative, so the headline carries the meaning.
  const thumb = element("a", "channel-news-thumb");
  thumb.href = url;
  thumb.target = "_blank";
  thumb.rel = "noopener noreferrer";
  thumb.tabIndex = -1;
  thumb.setAttribute("aria-hidden", "true");
  const image = channelNewsSafeUrl(item.image || "");
  if (image) {
    const img = element("img", "");
    img.src = image;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => img.replaceWith(channelNewsPlaceholder(item)), { once: true });
    thumb.append(img);
  } else {
    thumb.append(channelNewsPlaceholder(item));
  }
  const meta = element("span", "channel-news-meta");
  if (isGuide && item.channel) {
    const channelLink = element("a", "channel-news-channel", item.channelName);
    channelLink.href = `#${item.channel}`;
    channelLink.dataset.channel = item.channel;
    meta.append(channelLink, document.createTextNode(" · "));
  }
  const icon = channelNewsIcon(item);
  if (icon) meta.append(icon);
  meta.append(element("strong", "", item.source));
  if (item.published) meta.append(document.createTextNode(` · ${channelNewsWhen(item.published)}`));
  const link = element("a", "channel-news-title", item.title);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  card.append(thumb, meta, link);
  if (typeof item.summary === "string" && item.summary) card.append(element("p", "channel-news-summary", item.summary));
  return card;
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
  panel.append(title, filters, status, list, more);
  const ui = channelNewsUi.get(channelId) || { source: "all", limit: channelNewsStep };
  channelNewsUi.set(channelId, ui);

  const render = (block) => {
    if (block?.title) title.textContent = block.title;
    const key = isGuide ? "channelName" : "source";
    const homes = new Map((block?.sources || []).map((source) => [source.name, source.home]));
    const items = (Array.isArray(block?.items) ? block.items : [])
      .filter((item) => item && typeof item.title === "string" && item.title.trim() && channelNewsSafeUrl(item.url))
      .map((item) => ({ ...item, home: item.home || homes.get(item.source) || "" }));
    const groups = isGuide ? [...new Set(items.map((item) => item.channelName))] : (block?.sources || []).map((source) => source.name);
    filters.replaceChildren();
    for (const [value, label] of [["all", "All"], ...groups.map((name) => [name, name])]) {
      const count = value === "all" ? items.length : items.filter((item) => item[key] === value).length;
      if (value !== "all" && !count) continue;
      const button = element("button", "secondary", "");
      const sample = !isGuide && value !== "all" ? items.find((item) => item.source === value) : null;
      const chipIcon = sample ? channelNewsIcon(sample, 14) : null;
      if (chipIcon) button.append(chipIcon);
      button.append(`${label} ${count}`);
      button.type = "button";
      button.id = `channel-news-${channelId}-${value.replace(/\W+/g, "-").toLowerCase()}`;
      button.setAttribute("aria-pressed", String(ui.source === value));
      button.addEventListener("click", () => {
        ui.source = value;
        ui.limit = channelNewsStep;
        render(block);
        document.getElementById(button.id)?.focus();
      });
      filters.append(button);
    }
    filters.hidden = filters.childElementCount < 3;
    const shown = items.filter((item) => ui.source === "all" || item[key] === ui.source);
    list.replaceChildren();
    for (const item of shown.slice(0, ui.limit)) list.append(channelNewsCard(item, isGuide));
    if (!shown.length) list.append(element("li", "channel-news-empty", items.length ? "No recent headlines from this outlet." : "No headlines yet."));
    more.hidden = shown.length <= ui.limit;
    const fetched = Date.parse(channelNewsData?.fetchedAt || "");
    const missing = (block?.sources || []).filter((source) => source.status === "stale" || source.status === "unavailable")
      .map((source) => `${source.name} ${source.status === "stale" ? "not refreshed" : "unavailable"}`);
    status.textContent = [Number.isFinite(fetched) ? `Updated ${new Date(fetched).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "",
      ...missing, "Headlines open on each outlet’s site; some need a subscription."].filter(Boolean).join(" · ");
  };
  more.addEventListener("click", () => {
    ui.limit += channelNewsStep;
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

// Puts the news row at the top of a channel's content.
function withChannelNews(channelId, content) {
  const stack = element("div", "news-stack");
  stack.append(createChannelNews(channelId), ...content);
  return stack;
}
