// Creator Studio data layer: synced records, YouTube Data API (public data, using the browser's saved key),
// timestamp/transcript parsing and CSV export. Depends on nothing but the browser; views live in creator-studio.js.

const creatorStorageKey = "seven-channels.creator-studio.v1";
const creatorYoutubeKeyStorage = "seven-channels.youtube-api-key.v1";
const creatorStatuses = ["Idea", "Planned", "Recorded", "Editing", "Ready", "Published"];
const creatorClipLabels = [["funny", "Funny reaction"], ["analysis", "Musical analysis"], ["opinion", "Strong opinion"], ["surprise", "Surprising moment"], ["verdict", "Final verdict"]];
const creatorClipStatuses = ["Candidate", "Approved", "Editing", "Exported", "Posted"];
const creatorPlatforms = [["youtube", "YouTube upload"], ["short", "YouTube Short"], ["tiktok", "TikTok"], ["reels", "Instagram Reels"], ["live", "Livestream"]];
const creatorClipPlatforms = [["short", "YouTube Shorts"], ["tiktok", "TikTok"], ["reels", "Instagram Reels"], ["x", "X"], ["other", "Other"]];
const creatorPriorities = [["high", "High"], ["medium", "Medium"], ["low", "Low"]];
const creatorScheduleStatuses = [["draft", "Draft"], ["scheduled", "Scheduled"], ["published", "Published"]];
const creatorShortSeconds = 180;
const creatorLimits = { title: 150, text: 2000, note: 4000, transcript: 200000, tags: 500, url: 500 };

let creatorState = null;
let creatorOnChange = null;

// ---------- Small helpers ----------

function creatorText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function creatorId(prefix) {
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function creatorDateTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
}

function creatorDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00`)) ? value : "";
}

function creatorTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : "";
}

function creatorNumber(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function creatorPick(value, options, fallback) {
  return options.some((option) => (Array.isArray(option) ? option[0] : option) === value) ? value : fallback;
}

function creatorUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href.slice(0, creatorLimits.url) : "";
  } catch {
    return "";
  }
}

function creatorToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// ---------- Time and YouTube parsing ----------

// "1:02:03.5", "02:03", "123", "1h2m3s" -> seconds (null when unreadable).
function creatorParseTime(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const hms = /^(\d+)h(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$|^(\d+)m(?:(\d+(?:\.\d+)?)s)?$|^(\d+(?:\.\d+)?)s$/i.exec(text);
  if (hms) {
    if (hms[1] !== undefined) return Number(hms[1]) * 3600 + Number(hms[2] || 0) * 60 + Number(hms[3] || 0);
    if (hms[4] !== undefined) return Number(hms[4]) * 60 + Number(hms[5] || 0);
    return Number(hms[6]);
  }
  const parts = text.replace(",", ".").split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.slice(1).some((part) => part >= 60)) return null;
  return numbers.reduce((total, part) => total * 60 + part, 0);
}

function creatorFormatTime(seconds, { decimals = 0 } = {}) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const total = decimals ? Math.round(seconds * 10 ** decimals) / 10 ** decimals : Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total - hours * 3600 - minutes * 60;
  const secondText = decimals ? rest.toFixed(decimals).padStart(decimals + 3, "0") : String(Math.floor(rest)).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secondText}` : `${minutes}:${secondText}`;
}

// SMPTE-style timecode for editors: HH:MM:SS:FF at a whole-number frame rate (29.97 is written at 30).
function creatorTimecode(seconds, fps = 30) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const rate = Math.round(fps);
  const totalFrames = Math.round(seconds * fps);
  const frames = totalFrames % rate;
  const totalSeconds = Math.floor(totalFrames / rate);
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(totalSeconds % 60)}:${pad(frames)}`;
}

// ISO 8601 duration from the YouTube API ("PT1H2M3S") -> seconds.
function creatorIsoDuration(value) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(value || ""));
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match.map((part) => Number(part || 0));
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function creatorYoutubeId(value) {
  const text = String(value || "").trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  try {
    const url = new URL(text);
    const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
    if (host === "youtu.be") return /^[\w-]{11}$/.test(url.pathname.slice(1, 12)) ? url.pathname.slice(1, 12) : "";
    if (host !== "youtube.com" && host !== "youtube-nocookie.com") return "";
    if (url.searchParams.get("v") && /^[\w-]{11}$/.test(url.searchParams.get("v"))) return url.searchParams.get("v");
    const match = /^\/(?:shorts|embed|live|v)\/([\w-]{11})/.exec(url.pathname);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function creatorStartTimeFromUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return creatorParseTime(url.searchParams.get("t") || url.searchParams.get("start") || "") || 0;
  } catch {
    return 0;
  }
}

// Channel input: "@handle", a channel URL (/@handle, /channel/UC…), or a UC… channel ID.
function creatorChannelQuery(value) {
  const text = String(value || "").trim();
  if (/^UC[\w-]{22}$/.test(text)) return { id: text };
  if (/^@[\w.-]{3,30}$/.test(text)) return { handle: text };
  try {
    const url = new URL(text.startsWith("http") ? text : `https://${text}`);
    if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
    const channel = /^\/channel\/(UC[\w-]{22})/.exec(url.pathname);
    if (channel) return { id: channel[1] };
    const handle = /^\/(@[\w.-]{3,30})/.exec(url.pathname);
    if (handle) return { handle: handle[1] };
  } catch {
    return null;
  }
  return null;
}

// Lines like "0:00 Intro", "[1:23] Verse", "1:02:03 - Outro" -> [{ t, text }].
function creatorParseTimestampLines(text) {
  const rows = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    const match = /^[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?)[\])]?\s*[-–—:|]?\s*(.*)$/.exec(line);
    if (!match) continue;
    const t = creatorParseTime(match[1]);
    if (t !== null) rows.push({ t, text: match[2].trim() });
  }
  return rows;
}

// YouTube treats a description as chapters when it lists at least three timestamps, the first at 0:00.
function creatorChaptersFromDescription(description) {
  const rows = creatorParseTimestampLines(description).filter((row) => row.text);
  if (rows.length < 3 || rows[0].t !== 0) return [];
  return rows.filter((row, index) => index === 0 || row.t > rows[index - 1].t).map((row) => ({ t: row.t, title: row.text.slice(0, 120) }));
}

// Manual transcript import: SRT, WebVTT, or plain "timestamp text" lines.
function creatorParseTranscript(text) {
  const source = String(text || "").replace(/\r/g, "").trim();
  if (!source) return [];
  const cue = /(?:^|\n)(?:\d+\n)?((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})[^\n]*\n([\s\S]*?)(?=\n\n|$)/g;
  const cues = [];
  let match;
  while ((match = cue.exec(source))) {
    const t = creatorParseTime(match[1]);
    const words = match[3].replace(/<[^>]+>/g, "").replace(/\n+/g, " ").trim();
    if (t !== null && words) cues.push({ t, end: creatorParseTime(match[2]), text: words.slice(0, 1000) });
  }
  if (cues.length) return cues;
  return creatorParseTimestampLines(source).filter((row) => row.text).map((row) => ({ t: row.t, text: row.text.slice(0, 1000) }));
}

// ---------- CSV ----------

function creatorCsvCell(value, { text = false } = {}) {
  let cell = value === null || value === undefined ? "" : String(value);
  // Keep spreadsheet apps from treating free text as a formula.
  if (text && /^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function creatorClipCsv(project, clips, fps = 30) {
  const header = ["Source URL", "Source title", "Clip title", "Start", "End", "Duration", "Start seconds", "End seconds",
    `Start timecode (${fps} fps)`, `End timecode (${fps} fps)`, "Label", "Potential (1-5)", "Status", "Platform", "Hook", "Caption", "Hashtags", "Notes"];
  const sourceUrl = project.source.youtubeId ? `https://www.youtube.com/watch?v=${project.source.youtubeId}` : project.source.url || "";
  const labels = Object.fromEntries(creatorClipLabels);
  const platforms = Object.fromEntries(creatorClipPlatforms);
  const rows = [...clips].sort((a, b) => a.start - b.start).map((clip) => [
    creatorCsvCell(sourceUrl), creatorCsvCell(project.source.title, { text: true }), creatorCsvCell(clip.title, { text: true }),
    creatorFormatTime(clip.start, { decimals: 1 }), creatorFormatTime(clip.end, { decimals: 1 }), (clip.end - clip.start).toFixed(1),
    clip.start.toFixed(2), clip.end.toFixed(2), creatorTimecode(clip.start, fps), creatorTimecode(clip.end, fps),
    creatorCsvCell(labels[clip.label] || ""), clip.rating || "", creatorCsvCell(clip.status), creatorCsvCell(platforms[clip.platform] || ""),
    creatorCsvCell(clip.hook, { text: true }), creatorCsvCell(clip.caption, { text: true }), creatorCsvCell(clip.hashtags, { text: true }), creatorCsvCell(clip.notes, { text: true })
  ].join(","));
  return `${header.map((cell) => creatorCsvCell(cell)).join(",")}\r\n${rows.join("\r\n")}\r\n`;
}

// ---------- Records ----------

function creatorNormalizeHistory(list) {
  const byDate = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const date = creatorDate(item?.date);
    if (!date) continue;
    byDate.set(date, { date, views: creatorNumber(item.views), likes: creatorNumber(item.likes), comments: creatorNumber(item.comments),
      subscribers: creatorNumber(item.subscribers), videos: creatorNumber(item.videos) });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-400);
}

function creatorNormalizeVideo(value) {
  if (!value || typeof value.id !== "string" || !value.id) return null;
  const title = creatorText(value.title, creatorLimits.title);
  if (!title) return null;
  const youtubeId = creatorYoutubeId(value.youtubeId || "");
  return {
    id: value.id.slice(0, 80), title, youtubeId,
    thumbnail: creatorUrl(value.thumbnail || "") || (youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/mqdefault.jpg` : ""),
    publishedAt: creatorDateTime(value.publishedAt), plannedDate: creatorDate(value.plannedDate),
    duration: creatorNumber(value.duration), views: creatorNumber(value.views), likes: creatorNumber(value.likes), comments: creatorNumber(value.comments),
    statsAt: creatorDateTime(value.statsAt), history: creatorNormalizeHistory(value.history),
    category: creatorText(value.category, 60), status: creatorPick(value.status, creatorStatuses, "Idea"),
    format: value.format === "short" || value.format === "long" ? value.format : "",
    parentId: typeof value.parentId === "string" ? value.parentId.slice(0, 80) : "", notes: creatorText(value.notes, creatorLimits.note),
    ideaId: typeof value.ideaId === "string" ? value.ideaId.slice(0, 80) : "",
    createdAt: creatorDateTime(value.createdAt), updatedAt: creatorDateTime(value.updatedAt)
  };
}

function creatorNormalizeClip(value) {
  if (!value || typeof value.id !== "string" || !value.id) return null;
  const start = Number(value.start);
  const end = Number(value.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
  return {
    id: value.id.slice(0, 80), start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100,
    label: creatorPick(value.label, creatorClipLabels, "funny"), rating: Number.isInteger(value.rating) && value.rating >= 1 && value.rating <= 5 ? value.rating : null,
    title: creatorText(value.title, creatorLimits.title), hook: creatorText(value.hook, 300), caption: creatorText(value.caption, creatorLimits.text),
    hashtags: creatorText(value.hashtags, creatorLimits.tags), notes: creatorText(value.notes, creatorLimits.text),
    status: creatorPick(value.status, creatorClipStatuses, "Candidate"), platform: creatorPick(value.platform, creatorClipPlatforms, "short")
  };
}

function creatorNormalizeProject(value) {
  if (!value || typeof value.id !== "string" || !value.id) return null;
  const source = value.source || {};
  const youtubeId = creatorYoutubeId(source.youtubeId || "");
  const title = creatorText(source.title, creatorLimits.title) || (youtubeId ? `YouTube video ${youtubeId}` : "");
  if (!title) return null;
  const rows = (list, max) => (Array.isArray(list) ? list : []).map((row) => ({ t: Number(row?.t), text: creatorText(row?.text ?? row?.title, max) }))
    .filter((row) => Number.isFinite(row.t) && row.t >= 0 && row.text).sort((a, b) => a.t - b.t);
  let transcriptSize = 0;
  const transcript = rows(value.transcript, 1000).filter((row) => (transcriptSize += row.text.length) <= creatorLimits.transcript);
  return {
    id: value.id.slice(0, 80),
    source: { youtubeId, url: youtubeId ? "" : creatorUrl(source.url || ""), title, duration: creatorNumber(source.duration), channel: creatorText(source.channel, 120) },
    chapters: rows(value.chapters, 120).map((row) => ({ t: row.t, title: row.text })),
    transcript,
    moments: (Array.isArray(value.moments) ? value.moments : []).filter((item) => item && typeof item.id === "string" && Number.isFinite(Number(item.t)) && Number(item.t) >= 0)
      .map((item) => ({ id: item.id.slice(0, 80), t: Math.round(Number(item.t) * 100) / 100, note: creatorText(item.note, 500) })).sort((a, b) => a.t - b.t),
    clips: (Array.isArray(value.clips) ? value.clips : []).map(creatorNormalizeClip).filter(Boolean).sort((a, b) => a.start - b.start),
    videoId: typeof value.videoId === "string" ? value.videoId.slice(0, 80) : "",
    createdAt: creatorDateTime(value.createdAt), updatedAt: creatorDateTime(value.updatedAt)
  };
}

function creatorNormalizeEvent(value) {
  if (!value || typeof value.id !== "string" || !value.id) return null;
  const title = creatorText(value.title, creatorLimits.title);
  const date = creatorDate(value.date);
  if (!title || !date) return null;
  return {
    id: value.id.slice(0, 80), title, date, time: creatorTime(value.time), type: creatorPick(value.type, creatorPlatforms, "youtube"),
    status: creatorPick(value.status, creatorScheduleStatuses, "draft"), notes: creatorText(value.notes, creatorLimits.text),
    videoId: typeof value.videoId === "string" ? value.videoId.slice(0, 80) : "", ideaId: typeof value.ideaId === "string" ? value.ideaId.slice(0, 80) : "",
    createdAt: creatorDateTime(value.createdAt), updatedAt: creatorDateTime(value.updatedAt)
  };
}

function creatorNormalizeIdea(value) {
  if (!value || typeof value.id !== "string" || !value.id) return null;
  const title = creatorText(value.title, creatorLimits.title);
  if (!title) return null;
  const release = value.release && typeof value.release === "object" ? { label: creatorText(value.release.label, 200), href: typeof value.release.href === "string" && /^#[\w/%.-]*$/.test(value.release.href) ? value.release.href : creatorUrl(value.release.href || ""), source: creatorText(value.release.source, 40) } : null;
  return {
    id: value.id.slice(0, 80), title, category: creatorText(value.category, 60), description: creatorText(value.description, creatorLimits.text),
    priority: creatorPick(value.priority, creatorPriorities, "medium"), platform: creatorPick(value.platform, creatorPlatforms, "youtube"),
    status: creatorPick(value.status, creatorStatuses, "Idea"), notes: creatorText(value.notes, creatorLimits.note),
    release: release?.label ? release : null, plannedDate: creatorDate(value.plannedDate),
    createdAt: creatorDateTime(value.createdAt), updatedAt: creatorDateTime(value.updatedAt)
  };
}

function creatorNormalizeChannel(value) {
  if (!value || typeof value.id !== "string" || !/^UC[\w-]{22}$/.test(value.id)) return null;
  return {
    id: value.id, title: creatorText(value.title, 150), handle: creatorText(value.handle, 40), thumbnail: creatorUrl(value.thumbnail || ""),
    uploads: typeof value.uploads === "string" && /^UU[\w-]{22}$/.test(value.uploads) ? value.uploads : "",
    subscribers: creatorNumber(value.subscribers), hiddenSubscribers: value.hiddenSubscribers === true, views: creatorNumber(value.views), videos: creatorNumber(value.videos),
    fetchedAt: creatorDateTime(value.fetchedAt), updatedAt: creatorDateTime(value.updatedAt)
  };
}

const creatorCollections = { videos: creatorNormalizeVideo, projects: creatorNormalizeProject, schedule: creatorNormalizeEvent, ideas: creatorNormalizeIdea };

function creatorNormalizeState(value) {
  const source = value && typeof value === "object" ? value : {};
  const deleted = {};
  for (const name of Object.keys(creatorCollections)) {
    deleted[name] = [...new Set((Array.isArray(source.deleted?.[name]) ? source.deleted[name] : []).filter((id) => typeof id === "string" && id))].sort();
  }
  const state = { channel: creatorNormalizeChannel(source.channel), snapshots: creatorNormalizeHistory(source.snapshots), deleted };
  for (const [name, normalize] of Object.entries(creatorCollections)) {
    const gone = new Set(deleted[name]);
    const map = new Map();
    for (const record of (Array.isArray(source[name]) ? source[name] : []).map(normalize)) {
      if (record && !gone.has(record.id) && !map.has(record.id)) map.set(record.id, record);
    }
    state[name] = [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  return state;
}

function creatorValidState(value) {
  return Boolean(value && typeof value === "object" && Array.isArray(value.videos) && Array.isArray(value.ideas));
}

function creatorNewer(a, b) {
  const left = Date.parse(a?.updatedAt || "") || 0;
  const right = Date.parse(b?.updatedAt || "") || 0;
  return left !== right ? left > right : JSON.stringify(a) > JSON.stringify(b);
}

// Per-record merge across devices: newest edit wins, deletions stick, daily stat snapshots are combined.
function creatorMergeState(local, remote) {
  const a = creatorNormalizeState(local);
  const b = creatorNormalizeState(remote);
  const merged = { channel: !a.channel ? b.channel : !b.channel ? a.channel : creatorNewer(a.channel, b.channel) ? a.channel : b.channel, deleted: {} };
  const snapshots = new Map([...b.snapshots, ...a.snapshots].map((item) => [item.date, item]));
  merged.snapshots = [...snapshots.values()];
  for (const name of Object.keys(creatorCollections)) {
    merged.deleted[name] = [...a.deleted[name], ...b.deleted[name]];
    const map = new Map();
    for (const record of [...b[name], ...a[name]]) {
      const previous = map.get(record.id);
      if (!previous || creatorNewer(record, previous)) map.set(record.id, record);
    }
    merged[name] = [...map.values()];
  }
  return creatorNormalizeState(merged);
}

function creatorGetState() {
  if (!creatorState) {
    try {
      const saved = localStorage.getItem(creatorStorageKey);
      creatorState = creatorNormalizeState(saved ? JSON.parse(saved) : {});
    } catch (error) {
      console.error("Could not load Creator Studio data.", error);
      if (typeof showNotice === "function") showNotice("Saved Creator Studio data couldn’t be read. New changes can still be saved.");
      creatorState = creatorNormalizeState({});
    }
  }
  return creatorState;
}

function creatorPersist() {
  try {
    localStorage.setItem(creatorStorageKey, JSON.stringify(creatorState));
    return true;
  } catch (error) {
    console.error("Could not save Creator Studio data.", error);
    if (typeof showNotice === "function") showNotice("Your browser couldn’t save this Creator Studio change. Check storage settings; transcripts can be large.");
    return false;
  }
}

function creatorReplaceState(value) {
  creatorState = creatorNormalizeState(value);
  creatorPersist();
}

function creatorCommit(mutate) {
  const next = structuredClone(creatorGetState());
  mutate(next, new Date().toISOString());
  creatorState = creatorNormalizeState(next);
  const saved = creatorPersist();
  creatorOnChange?.();
  return saved;
}

function creatorUpsert(collection, record) {
  return creatorCommit((next, now) => {
    const index = next[collection].findIndex((item) => item.id === record.id);
    const updated = { ...(index >= 0 ? next[collection][index] : { createdAt: now }), ...record, updatedAt: now };
    if (index >= 0) next[collection][index] = updated;
    else next[collection].push(updated);
  });
}

function creatorRemove(collection, id) {
  return creatorCommit((next) => {
    next[collection] = next[collection].filter((item) => item.id !== id);
    next.deleted[collection] = [...new Set([...next.deleted[collection], id])];
    if (collection === "videos") {
      for (const video of next.videos) if (video.parentId === id) video.parentId = "";
    }
  });
}

// For other channels (Music Lab, K-Pop, Live Events): add a content idea without opening Creator Studio.
function creatorStudioAddIdea({ title, category = "", description = "", platform = "youtube", release = null, plannedDate = "" }) {
  const id = creatorId("idea");
  creatorUpsert("ideas", { id, title, category, description, platform, priority: "medium", status: "Idea", notes: "", release, plannedDate });
  return creatorGetState().ideas.find((idea) => idea.id === id) || null;
}

// ---------- YouTube Data API (public data) ----------

function creatorApiKey() {
  try {
    return localStorage.getItem(creatorYoutubeKeyStorage)?.trim() || "";
  } catch {
    return "";
  }
}

async function creatorYoutube(path, params) {
  const key = creatorApiKey();
  if (!key) throw new Error("Add a YouTube Data API key in the YouTube settings at the top of the page first.");
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key })}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data?.error?.errors?.[0]?.reason || "";
    if (reason === "quotaExceeded") throw new Error("The YouTube API daily quota for this key is used up. Try again tomorrow.");
    if (response.status === 400 || response.status === 403) throw new Error(`YouTube rejected the request (${data?.error?.message || response.status}). Check that the key allows the YouTube Data API v3 and this site.`);
    throw new Error(`YouTube request failed (${response.status}).`);
  }
  return data;
}

async function creatorLookupChannel(input) {
  const query = creatorChannelQuery(input);
  if (!query) throw new Error("Enter your channel’s @handle, its URL, or a channel ID starting with UC.");
  const data = await creatorYoutube("channels", { part: "snippet,statistics,contentDetails", ...(query.id ? { id: query.id } : { forHandle: query.handle }) });
  const item = data.items?.[0];
  if (!item) throw new Error("YouTube didn’t find that channel. Check the handle or ID.");
  return creatorChannelFromApi(item);
}

function creatorChannelFromApi(item) {
  const stats = item.statistics || {};
  return {
    id: item.id, title: item.snippet?.title || "", handle: item.snippet?.customUrl || "",
    thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || "",
    uploads: item.contentDetails?.relatedPlaylists?.uploads || "",
    subscribers: stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount ?? NaN),
    hiddenSubscribers: Boolean(stats.hiddenSubscriberCount), views: Number(stats.viewCount ?? NaN), videos: Number(stats.videoCount ?? NaN),
    fetchedAt: new Date().toISOString()
  };
}

async function creatorFetchVideos(ids) {
  const videos = [];
  for (let index = 0; index < ids.length; index += 50) {
    const data = await creatorYoutube("videos", { part: "snippet,statistics,contentDetails", id: ids.slice(index, index + 50).join(","), maxResults: "50" });
    for (const item of data.items || []) {
      videos.push({
        youtubeId: item.id, title: item.snippet?.title || "", description: item.snippet?.description || "",
        channel: item.snippet?.channelTitle || "", publishedAt: item.snippet?.publishedAt || "",
        thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || "",
        duration: creatorIsoDuration(item.contentDetails?.duration),
        views: item.statistics?.viewCount !== undefined ? Number(item.statistics.viewCount) : null,
        likes: item.statistics?.likeCount !== undefined ? Number(item.statistics.likeCount) : null,
        comments: item.statistics?.commentCount !== undefined ? Number(item.statistics.commentCount) : null
      });
    }
  }
  return videos;
}

// Refreshes the connected channel: its stats (recorded as today's snapshot) and its latest uploads,
// which are added to the library or update existing entries' public stats. Your own fields are kept.
async function creatorRefreshChannel(limit = 50) {
  const state = creatorGetState();
  if (!state.channel) throw new Error("Connect your channel first.");
  const fresh = await creatorLookupChannel(state.channel.id);
  const listing = fresh.uploads ? await creatorYoutube("playlistItems", { part: "contentDetails", playlistId: fresh.uploads, maxResults: String(Math.min(limit, 50)) }) : { items: [] };
  const ids = (listing.items || []).map((item) => item.contentDetails?.videoId).filter(Boolean);
  const uploads = ids.length ? await creatorFetchVideos(ids) : [];
  const today = creatorToday();
  let added = 0;
  creatorCommit((next, now) => {
    next.channel = { ...fresh, updatedAt: now };
    next.snapshots = [...next.snapshots.filter((item) => item.date !== today),
      { date: today, subscribers: fresh.subscribers, views: fresh.views, videos: fresh.videos }];
    for (const upload of uploads) {
      const existing = next.videos.find((video) => video.youtubeId === upload.youtubeId);
      const stats = { date: today, views: upload.views, likes: upload.likes, comments: upload.comments };
      if (existing) {
        Object.assign(existing, { title: existing.title || upload.title, thumbnail: upload.thumbnail || existing.thumbnail, publishedAt: upload.publishedAt,
          duration: upload.duration, views: upload.views, likes: upload.likes, comments: upload.comments, statsAt: now,
          format: existing.format || (upload.duration !== null && upload.duration <= creatorShortSeconds ? "short" : "long"),
          status: "Published", history: [...(existing.history || []).filter((item) => item.date !== today), stats], updatedAt: now });
      } else {
        added += 1;
        next.videos.push({ id: creatorId("video"), youtubeId: upload.youtubeId, title: upload.title, thumbnail: upload.thumbnail, publishedAt: upload.publishedAt,
          duration: upload.duration, views: upload.views, likes: upload.likes, comments: upload.comments, statsAt: now, history: [stats],
          format: upload.duration !== null && upload.duration <= creatorShortSeconds ? "short" : "long", status: "Published", category: "", notes: "",
          createdAt: now, updatedAt: now });
      }
    }
  });
  return { added, updated: uploads.length - added, channel: creatorGetState().channel };
}

// ---------- Derived numbers ----------

function creatorEngagement(video) {
  if (!video?.views || video.likes === null || video.comments === null) return null;
  return (video.likes + video.comments) / video.views;
}

function creatorFormatCount(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, { notation: value >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function creatorGuideCells() {
  const state = creatorGetState();
  const today = creatorToday();
  const next = state.schedule.filter((item) => item.date >= today && item.status !== "published").sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  const inProduction = state.videos.filter((video) => ["Recorded", "Editing", "Ready"].includes(video.status));
  const backlog = state.ideas.filter((idea) => idea.status === "Idea");
  return [
    next ? { title: next.title, note: `${Object.fromEntries(creatorPlatforms)[next.type]} · ${new Date(`${next.date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` } : { title: "", note: "" },
    inProduction.length ? { title: `${inProduction.length} in production`, note: inProduction.slice(0, 2).map((video) => video.title).join(", ") } : { title: "", note: "" },
    backlog.length ? { title: `${backlog.length} idea${backlog.length === 1 ? "" : "s"}`, note: backlog.filter((idea) => idea.priority === "high").length ? `${backlog.filter((idea) => idea.priority === "high").length} high priority` : "" } : { title: "", note: "" }
  ];
}
