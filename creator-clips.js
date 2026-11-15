// Creator Studio reaction clip workspace (#creator/clips, #creator/clips/<project id>).
// The embedded player is YouTube's official IFrame Player API; it stays mounted while the panels around it redraw.
// Nothing here analyzes video or audio: moments, transcripts and clips are what you mark, paste or type.

const clipsUi = {
  projectId: "",
  selected: "",
  player: null,
  playerReady: false,
  playerError: "",
  manualTime: 0,
  stopAt: null,
  window: null, // { from, to } when zoomed
  fps: 30,
  scope: "all",
  transcriptQuery: "",
  status: "",
  workspace: null, // { root, panels, timeline, project }
  timer: 0
};
const clipLabelColors = { funny: "var(--cs-c1)", analysis: "var(--cs-c2)", opinion: "var(--cs-c3)", surprise: "var(--cs-c4)", verdict: "var(--cs-c5)" };
const clipLabelNames = Object.fromEntries(creatorClipLabels);
let creatorYoutubeApiPromise = null;

function creatorLoadYoutubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!creatorYoutubeApiPromise) {
    creatorYoutubeApiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve(window.YT);
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => reject(new Error("YouTube’s player couldn’t load."));
      document.head.append(script);
      setTimeout(() => reject(new Error("YouTube’s player took too long to load.")), 15000);
    }).catch((error) => {
      creatorYoutubeApiPromise = null;
      throw error;
    });
  }
  return creatorYoutubeApiPromise;
}

function clipsProject() {
  return creatorGetState().projects.find((project) => project.id === clipsUi.projectId) || null;
}

function clipsSave(project, { redraw = true } = {}) {
  creatorUpsert("projects", project);
  if (redraw) clipsRedraw();
}

function clipsCurrentTime() {
  if (clipsUi.playerReady && clipsUi.player?.getCurrentTime) {
    const time = clipsUi.player.getCurrentTime();
    if (Number.isFinite(time)) return time;
  }
  return clipsUi.manualTime;
}

function clipsDuration(project) {
  const fromPlayer = clipsUi.playerReady && clipsUi.player?.getDuration ? clipsUi.player.getDuration() : 0;
  if (fromPlayer > 0) return fromPlayer;
  if (project.source.duration) return project.source.duration;
  const ends = [...project.clips.map((clip) => clip.end), ...project.moments.map((moment) => moment.t), ...project.chapters.map((chapter) => chapter.t), ...project.transcript.map((row) => row.t)];
  return Math.max(60, ...ends.map((value) => value + 30));
}

function clipsSeek(seconds, { play = true } = {}) {
  const time = Math.max(0, seconds);
  clipsUi.manualTime = time;
  if (clipsUi.playerReady && clipsUi.player?.seekTo) {
    clipsUi.player.seekTo(time, true);
    if (play) clipsUi.player.playVideo?.();
  }
  clipsTick();
}

function clipsSourceUrl(project, time = 0) {
  if (project.source.youtubeId) return `https://www.youtube.com/watch?v=${project.source.youtubeId}${time ? `&t=${Math.floor(time)}s` : ""}`;
  return project.source.url || "";
}

// ---------- Project list ----------

async function clipsImport(input, manual = {}) {
  const youtubeId = creatorYoutubeId(input);
  const id = creatorId("clips");
  const source = { youtubeId, url: youtubeId ? "" : creatorUrl(manual.url || input || ""), title: manual.title || "", duration: manual.duration ?? null, channel: "" };
  let chapters = [];
  let note = "";
  if (youtubeId && creatorApiKey()) {
    try {
      const [video] = await creatorFetchVideos([youtubeId]);
      if (video) {
        Object.assign(source, { title: source.title || video.title, duration: video.duration, channel: video.channel });
        chapters = creatorChaptersFromDescription(video.description);
        note = chapters.length ? ` ${chapters.length} chapters found in the description.` : " No chapters in the description.";
      }
    } catch (error) {
      note = ` Video details couldn’t load (${error.message}), so add the title and length yourself.`;
    }
  } else if (youtubeId) {
    note = " Add a YouTube API key to fill in the title, length and chapters automatically.";
  }
  if (!source.title) source.title = youtubeId ? `YouTube video ${youtubeId}` : "Untitled source";
  creatorUpsert("projects", { id, source, chapters, transcript: [], moments: [], clips: [], videoId: manual.videoId || "" });
  clipsUi.status = `Created a clip project for “${source.title}”.${note}`;
  return id;
}

function createClipsProjectList() {
  const state = creatorGetState();
  const wrap = csEl("div", "cs-stack");
  const importPanel = csPanel("Start a clip project", "cs-clips-new-title");
  const form = csEl("form", "cs-form-row");
  const url = csInput("cs-clip-url", "", { placeholder: "YouTube link, e.g. https://youtu.be/…" });
  const go = csEl("button", "", "Import video");
  go.type = "submit";
  const error = csEl("p", "cs-status-line error");
  error.setAttribute("role", "alert");
  form.append(csField("YouTube video", url), go);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!creatorYoutubeId(url.value)) {
      error.textContent = "Paste a YouTube video link (watch, youtu.be or Shorts) or an 11-character video ID.";
      url.focus();
      return;
    }
    go.disabled = true;
    go.textContent = "Importing…";
    const id = await clipsImport(url.value);
    location.hash = `#creator/clips/${encodeURIComponent(id)}`;
  });
  importPanel.append(form, error);
  const manual = csEl("details", "cs-details");
  manual.append(csEl("summary", "", "Add a video by hand (not on YouTube, or no embed)"));
  const manualForm = csEl("form", "cs-form-row");
  const title = csInput("cs-clip-manual-title", "", { placeholder: "Video title" });
  const link = csInput("cs-clip-manual-url", "", { placeholder: "https://… (optional)" });
  const length = csInput("cs-clip-manual-length", "", { placeholder: "12:34" });
  const add = csEl("button", "", "Create project");
  add.type = "submit";
  manualForm.append(csField("Title", title), csField("Link", link), csField("Length", length), add);
  manualForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!title.value.trim()) {
      error.textContent = "Give the video a title.";
      title.focus();
      return;
    }
    const id = await clipsImport(link.value, { title: title.value.trim(), url: link.value, duration: creatorParseTime(length.value) });
    location.hash = `#creator/clips/${encodeURIComponent(id)}`;
  });
  manual.append(manualForm);
  importPanel.append(manual);
  const linked = state.videos.filter((video) => video.youtubeId && !state.projects.some((project) => project.source.youtubeId === video.youtubeId));
  if (linked.length) {
    const pick = csEl("form", "cs-form-row");
    const select = csSelect("cs-clip-library", linked.map((video) => [video.id, video.title]), linked[0].id);
    const open = csEl("button", "secondary", "Open in workspace");
    open.type = "submit";
    pick.append(csField("From your library", select), open);
    pick.addEventListener("submit", (event) => {
      event.preventDefault();
      const video = linked.find((item) => item.id === select.value);
      if (video) creatorOpenClipProject(video);
    });
    importPanel.append(pick);
  }
  wrap.append(importPanel);

  const list = csPanel("Clip projects", "cs-clips-list-title");
  if (!state.projects.length) {
    list.append(csEmpty("No clip projects yet. Import a reaction video above to start marking moments and cutting clips."));
  } else {
    const rows = csEl("ul", "cs-project-list");
    for (const project of [...state.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      const item = csEl("li", "cs-project");
      item.append(csThumb(project.source.youtubeId ? `https://i.ytimg.com/vi/${project.source.youtubeId}/mqdefault.jpg` : "", project.source.title));
      const copy = csEl("div");
      copy.append(csLink(project.source.title, `#creator/clips/${encodeURIComponent(project.id)}`, "cs-video-title"),
        csEl("p", "cs-meta", `${project.clips.length} clip${project.clips.length === 1 ? "" : "s"} · ${project.moments.length} moment${project.moments.length === 1 ? "" : "s"}${project.transcript.length ? " · transcript" : ""} · updated ${csDate(project.updatedAt, { month: "short", day: "numeric" })}`));
      item.append(copy, csConfirmButton(`project-${project.id}`, "Delete", () => {
        creatorRemove("projects", project.id);
        creatorSetStatus("Clip project deleted.");
        creatorRefresh("cs-status");
      }));
      rows.append(item);
    }
    list.append(rows);
  }
  wrap.append(list);
  return wrap;
}

// ---------- Workspace ----------

function createCreatorClips(id) {
  clearInterval(clipsUi.timer);
  if (!id) {
    clipsUi.workspace = null;
    return createClipsProjectList();
  }
  const project = creatorGetState().projects.find((item) => item.id === id);
  if (!project) {
    clipsUi.workspace = null;
    return csEmpty("This clip project doesn’t exist (it may have been deleted).", csLink("All clip projects", "#creator/clips", "cs-text-link"));
  }
  if (clipsUi.projectId !== id) {
    Object.assign(clipsUi, { projectId: id, selected: project.clips[0]?.id || "", player: null, playerReady: false, playerError: "", manualTime: 0, stopAt: null, window: null, transcriptQuery: "" });
  }
  const root = csEl("div", "cs-workspace");
  const head = csEl("div", "cs-workspace-head");
  const titleInput = csInput("cs-clip-project-title", project.source.title, { maxLength: creatorLimits.title });
  titleInput.setAttribute("aria-label", "Project title");
  titleInput.className = "cs-title-input";
  titleInput.addEventListener("change", () => {
    const current = clipsProject();
    if (current && titleInput.value.trim()) clipsSave({ ...current, source: { ...current.source, title: titleInput.value.trim() } }, { redraw: false });
  });
  const links = csEl("div", "cs-actions");
  links.append(csLink("All projects", "#creator/clips", "cs-text-link"));
  const sourceUrl = clipsSourceUrl(project);
  if (sourceUrl) {
    const open = csLink("Open source ↗", sourceUrl, "cs-text-link");
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    links.append(open);
  }
  head.append(titleInput, links);
  root.append(head);

  const stage = csEl("div", "cs-stage");
  const playerBox = csEl("div", "cs-player");
  const playerSlot = csEl("div", "cs-player-slot");
  playerBox.append(playerSlot);
  if (project.source.youtubeId) {
    const status = csEl("p", "cs-player-status", "Loading YouTube’s player…");
    status.setAttribute("role", "status");
    playerBox.append(status);
    creatorLoadYoutubeApi().then((YT) => {
      if (!playerSlot.isConnected) return;
      const mount = csEl("div");
      playerSlot.append(mount);
      clipsUi.player = new YT.Player(mount, {
        videoId: project.source.youtubeId,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
        events: {
          onReady: () => {
            clipsUi.playerReady = true;
            status.textContent = "";
            const duration = clipsUi.player.getDuration?.();
            const current = clipsProject();
            if (current && duration > 0 && Math.abs((current.source.duration || 0) - duration) > 1) clipsSave({ ...current, source: { ...current.source, duration } });
            else clipsRedraw();
          },
          onError: (event) => {
            clipsUi.playerReady = false;
            clipsUi.playerError = [101, 150].includes(event.data) ? "The video’s owner doesn’t allow it to play embedded. Open it on YouTube and enter times by hand."
              : event.data === 100 ? "This video is private or was removed." : "YouTube couldn’t play this video here.";
            status.textContent = clipsUi.playerError;
            clipsRedraw();
          }
        }
      });
    }).catch((error) => {
      clipsUi.playerError = `${error.message} You can still mark times by hand and open the video on YouTube.`;
      status.textContent = clipsUi.playerError;
      clipsRedraw();
    });
  } else {
    playerBox.append(csEl("p", "cs-player-status", "No embedded player for this source. Play it elsewhere and enter times by hand."));
  }
  const transport = csEl("div", "cs-transport");
  const panels = csEl("div", "cs-panels");
  const timeline = csEl("div", "cs-timeline-wrap");
  stage.append(playerBox, transport, timeline);
  root.append(stage, panels);
  clipsUi.workspace = { root, panels, timeline, transport };
  root.addEventListener("keydown", (event) => {
    if (event.target.closest("input, textarea, select, [contenteditable]") || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "m") { event.preventDefault(); clipsMarkMoment(""); }
    if (key === "i") { event.preventDefault(); clipsSetEdge("start"); }
    if (key === "o") { event.preventDefault(); clipsSetEdge("end"); }
  });
  clipsRedraw();
  clipsUi.timer = setInterval(() => {
    if (!root.isConnected) {
      clearInterval(clipsUi.timer);
      return;
    }
    clipsTick();
  }, 250);
  return root;
}

// Redraws transport, timeline and panels from saved state; the player is untouched.
function creatorClipsRefreshPanels() {
  if (!clipsUi.workspace?.root?.isConnected || creatorRoute().id !== clipsUi.projectId) return false;
  clipsRedraw();
  return true;
}

function clipsRedraw() {
  const workspace = clipsUi.workspace;
  const project = clipsProject();
  if (!workspace || !project) return;
  const focusId = document.activeElement?.id;
  if (project.clips.length && !project.clips.some((clip) => clip.id === clipsUi.selected)) clipsUi.selected = project.clips[0].id;
  workspace.transport.replaceChildren(...clipsTransport(project));
  workspace.timeline.replaceChildren(clipsTimeline(project));
  workspace.panels.replaceChildren(clipsClipPanel(project), clipsSidePanels(project));
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  clipsTick();
}

function clipsTransport(project) {
  const time = csEl("output", "cs-time", creatorFormatTime(clipsCurrentTime(), { decimals: 1 }));
  time.id = "cs-current-time";
  time.setAttribute("aria-live", "off");
  const nodes = [];
  const clock = csEl("div", "cs-clock");
  clock.append(csEl("span", "cs-hint", clipsUi.playerReady ? "Player time" : "Current time"), time);
  nodes.push(clock);
  if (!clipsUi.playerReady) {
    const manual = csInput("cs-manual-time", creatorFormatTime(clipsUi.manualTime, { decimals: 1 }), { placeholder: "0:00" });
    manual.setAttribute("aria-label", "Set the current time by hand");
    manual.addEventListener("change", () => {
      const seconds = creatorParseTime(manual.value);
      if (seconds !== null) {
        clipsUi.manualTime = seconds;
        clipsTick();
      }
    });
    nodes.push(manual);
    if (project.source.youtubeId || project.source.url) {
      const open = csLink("Open at this time ↗", clipsSourceUrl(project, clipsUi.manualTime), "cs-text-link");
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.id = "cs-open-at";
      nodes.push(open);
    }
  }
  const actions = csEl("div", "cs-actions");
  actions.append(
    csButton("Mark moment (M)", () => clipsMarkMoment(""), "", "cs-mark"),
    csButton("Set in (I)", () => clipsSetEdge("start"), "secondary", "cs-set-in"),
    csButton("Set out (O)", () => clipsSetEdge("end"), "secondary", "cs-set-out"),
    csButton("New clip here", () => clipsNewClip(clipsCurrentTime()), "secondary", "cs-new-clip")
  );
  nodes.push(actions);
  if (clipsUi.playerError) nodes.push(csEl("p", "cs-player-status", clipsUi.playerError));
  if (clipsUi.status) {
    const status = csEl("p", "cs-status-line", clipsUi.status);
    status.setAttribute("role", "status");
    nodes.push(status);
    clipsUi.status = "";
  }
  return nodes;
}

function clipsTick() {
  const workspace = clipsUi.workspace;
  const project = clipsProject();
  if (!workspace || !project) return;
  const now = clipsCurrentTime();
  const time = workspace.transport.querySelector("#cs-current-time");
  if (time) time.textContent = creatorFormatTime(now, { decimals: 1 });
  const open = workspace.transport.querySelector("#cs-open-at");
  if (open) open.href = clipsSourceUrl(project, now);
  const view = clipsView(project);
  const head = workspace.timeline.querySelector(".cs-playhead");
  if (head) {
    const inside = now >= view.from && now <= view.to;
    head.hidden = !inside;
    head.style.left = `${((now - view.from) / (view.to - view.from)) * 100}%`;
  }
  if (clipsUi.stopAt !== null && clipsUi.playerReady && now >= clipsUi.stopAt) {
    clipsUi.player.pauseVideo?.();
    clipsUi.stopAt = null;
  }
  const lines = workspace.panels.querySelectorAll(".cs-line[data-t]");
  let current = null;
  for (const line of lines) {
    if (Number(line.dataset.t) <= now) current = line;
    line.classList.remove("is-current");
  }
  current?.classList.add("is-current");
}

function clipsView(project) {
  const duration = clipsDuration(project);
  if (clipsUi.window && clipsUi.window.to > clipsUi.window.from) return { from: Math.max(0, clipsUi.window.from), to: Math.min(duration, clipsUi.window.to), duration };
  return { from: 0, to: duration, duration };
}

function clipsMarkMoment(note) {
  const project = clipsProject();
  if (!project) return;
  const t = Math.round(clipsCurrentTime() * 100) / 100;
  clipsUi.status = `Marked a moment at ${creatorFormatTime(t, { decimals: 1 })}.`;
  clipsSave({ ...project, moments: [...project.moments, { id: creatorId("moment"), t, note }] });
}

function clipsNewClip(start, end = null, extra = {}) {
  const project = clipsProject();
  if (!project) return;
  const duration = clipsDuration(project);
  const from = Math.max(0, Math.min(start, Math.max(0, duration - 1)));
  const to = Math.min(duration, end ?? from + 30);
  const clip = { id: creatorId("clip"), start: Math.round(from * 10) / 10, end: Math.round(Math.max(to, from + 1) * 10) / 10, label: "funny", rating: null, title: "", hook: "", caption: "", hashtags: "", notes: "", status: "Candidate", platform: "short", ...extra };
  clipsUi.selected = clip.id;
  clipsUi.status = `New clip ${creatorFormatTime(clip.start)}–${creatorFormatTime(clip.end)}. Drag its handles or type exact times.`;
  clipsSave({ ...project, clips: [...project.clips, clip] });
}

function clipsUpdateClip(id, changes, options) {
  const project = clipsProject();
  if (!project) return;
  clipsSave({ ...project, clips: project.clips.map((clip) => (clip.id === id ? { ...clip, ...changes } : clip)) }, options);
}

function clipsSetEdge(edge) {
  const project = clipsProject();
  const clip = project?.clips.find((item) => item.id === clipsUi.selected);
  const now = Math.round(clipsCurrentTime() * 10) / 10;
  if (!clip) {
    if (edge === "start") clipsNewClip(now);
    else {
      clipsUi.status = "Select or create a clip first.";
      clipsRedraw();
    }
    return;
  }
  if (edge === "start" && now >= clip.end) clipsUpdateClip(clip.id, { start: now, end: Math.min(clipsDuration(project), now + (clip.end - clip.start)) });
  else if (edge === "end" && now <= clip.start) { clipsUi.status = "The out point has to come after the in point."; clipsRedraw(); }
  else clipsUpdateClip(clip.id, { [edge]: now });
}

// ---------- Timeline ----------

function clipsTimeline(project) {
  const view = clipsView(project);
  const span = view.to - view.from;
  const wrap = csEl("div", "cs-timeline-box");
  const tools = csEl("div", "cs-timeline-tools");
  const selected = project.clips.find((clip) => clip.id === clipsUi.selected);
  tools.append(csEl("span", "cs-hint", clipsUi.window ? `Zoomed: ${creatorFormatTime(view.from)}–${creatorFormatTime(view.to)}` : `Whole video · ${creatorFormatTime(view.duration)}`));
  if (selected) tools.append(csButton("Zoom to clip", () => { clipsUi.window = { from: selected.start - 20, to: selected.end + 20 }; clipsRedraw(); }, "secondary", "cs-zoom-clip"));
  if (clipsUi.window) tools.append(csButton("Show all", () => { clipsUi.window = null; clipsRedraw(); }, "secondary", "cs-zoom-all"));
  const track = csEl("div", "cs-timeline");
  track.setAttribute("role", "group");
  track.setAttribute("aria-label", "Clip timeline. Click to seek; drag a selected clip’s handles to trim it.");
  const pos = (seconds) => `${((seconds - view.from) / span) * 100}%`;
  const visible = (start, end = start) => end >= view.from && start <= view.to;
  const ruler = csEl("div", "cs-ruler");
  const step = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800].find((value) => span / value <= 10) || 3600;
  for (let t = Math.ceil(view.from / step) * step; t <= view.to; t += step) {
    const tick = csEl("span", "cs-tick", creatorFormatTime(t));
    tick.style.left = pos(t);
    ruler.append(tick);
  }
  const chapters = csEl("div", "cs-lane cs-lane-chapters");
  project.chapters.forEach((chapter, index) => {
    const end = project.chapters[index + 1]?.t ?? view.duration;
    if (!visible(chapter.t, end)) return;
    const block = csEl("button", "cs-chapter", chapter.title);
    block.type = "button";
    block.style.left = pos(Math.max(view.from, chapter.t));
    block.style.width = `${((Math.min(view.to, end) - Math.max(view.from, chapter.t)) / span) * 100}%`;
    block.title = `${creatorFormatTime(chapter.t)} ${chapter.title}`;
    block.addEventListener("click", (event) => { event.stopPropagation(); clipsSeek(chapter.t); });
    chapters.append(block);
  });
  const lane = csEl("div", "cs-lane cs-lane-clips");
  for (const clip of project.clips) {
    if (!visible(clip.start, clip.end)) continue;
    const isSelected = clip.id === clipsUi.selected;
    const range = csEl("div", `cs-range${isSelected ? " is-selected" : ""}`);
    range.style.left = pos(Math.max(view.from, clip.start));
    range.style.width = `${((Math.min(view.to, clip.end) - Math.max(view.from, clip.start)) / span) * 100}%`;
    range.style.setProperty("--cs-type", clipLabelColors[clip.label]);
    const body = csEl("button", "cs-range-body", clip.title || clipLabelNames[clip.label]);
    body.type = "button";
    body.title = `${clip.title || clipLabelNames[clip.label]}: ${creatorFormatTime(clip.start, { decimals: 1 })}–${creatorFormatTime(clip.end, { decimals: 1 })}`;
    body.addEventListener("click", (event) => {
      event.stopPropagation();
      clipsUi.selected = clip.id;
      clipsSeek(clip.start, { play: false });
      clipsRedraw();
    });
    range.append(body);
    if (isSelected) {
      range.append(clipsHandle(project, clip, "start", view, track), clipsHandle(project, clip, "end", view, track));
    }
    lane.append(range);
  }
  const moments = csEl("div", "cs-lane cs-lane-moments");
  for (const moment of project.moments) {
    if (!visible(moment.t)) continue;
    const pin = csEl("button", "cs-pin");
    pin.type = "button";
    pin.style.left = pos(moment.t);
    pin.title = `${creatorFormatTime(moment.t, { decimals: 1 })}${moment.note ? ` · ${moment.note}` : ""}`;
    pin.setAttribute("aria-label", `Moment at ${creatorFormatTime(moment.t)}${moment.note ? `: ${moment.note}` : ""}`);
    pin.addEventListener("click", (event) => { event.stopPropagation(); clipsSeek(moment.t); });
    moments.append(pin);
  }
  const playhead = csEl("div", "cs-playhead");
  playhead.setAttribute("aria-hidden", "true");
  track.append(ruler, chapters, lane, moments, playhead);
  track.addEventListener("click", (event) => {
    if (event.target.closest("button, .cs-handle")) return;
    const rect = track.getBoundingClientRect();
    clipsSeek(view.from + ((event.clientX - rect.left) / rect.width) * span, { play: false });
  });
  const legend = csEl("ul", "cs-legend");
  for (const [label, text] of creatorClipLabels) {
    const item = csEl("li", "", text);
    item.style.setProperty("--cs-type", clipLabelColors[label]);
    legend.append(item);
  }
  legend.append(csEl("li", "is-pin", "Moment"));
  wrap.append(tools, track, legend);
  return wrap;
}

function clipsHandle(project, clip, edge, view, track) {
  const handle = csEl("span", `cs-handle cs-handle-${edge}`);
  handle.tabIndex = 0;
  handle.id = `cs-handle-${edge}`;
  handle.setAttribute("role", "slider");
  handle.setAttribute("aria-label", edge === "start" ? "Clip in point" : "Clip out point");
  handle.setAttribute("aria-valuemin", "0");
  handle.setAttribute("aria-valuemax", String(Math.round(view.duration)));
  handle.setAttribute("aria-valuenow", String(clip[edge]));
  handle.setAttribute("aria-valuetext", creatorFormatTime(clip[edge], { decimals: 1 }));
  const limits = (value, current) => {
    const minLength = 0.5;
    return edge === "start" ? Math.min(Math.max(0, value), current.end - minLength) : Math.max(Math.min(view.duration, value), current.start + minLength);
  };
  const preview = (value) => {
    const range = handle.parentElement;
    const span = view.to - view.from;
    const start = edge === "start" ? value : clip.start;
    const end = edge === "end" ? value : clip.end;
    range.style.left = `${((Math.max(view.from, start) - view.from) / span) * 100}%`;
    range.style.width = `${((Math.min(view.to, end) - Math.max(view.from, start)) / span) * 100}%`;
    handle.setAttribute("aria-valuenow", String(value));
    handle.setAttribute("aria-valuetext", creatorFormatTime(value, { decimals: 1 }));
    const field = document.getElementById(`cs-clip-${edge}`);
    if (field) field.value = creatorFormatTime(value, { decimals: 1 });
    const length = document.getElementById("cs-clip-length");
    if (length) length.textContent = `${(end - start).toFixed(1)} s`;
  };
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handle.setPointerCapture(event.pointerId);
    const rect = track.getBoundingClientRect();
    let value = clip[edge];
    const move = (moveEvent) => {
      value = Math.round(limits(view.from + ((moveEvent.clientX - rect.left) / rect.width) * (view.to - view.from), clip) * 10) / 10;
      preview(value);
      if (clipsUi.playerReady) clipsUi.player.seekTo?.(value, true);
      else clipsUi.manualTime = value;
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      if (value !== clip[edge]) clipsUpdateClip(clip.id, { [edge]: value });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
  handle.addEventListener("click", (event) => event.stopPropagation());
  handle.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 5 : event.altKey ? 0.1 : 1;
    const delta = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[event.key];
    if (delta === undefined && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const target = event.key === "Home" ? 0 : event.key === "End" ? view.duration : clip[edge] + delta;
    const value = Math.round(limits(target, clip) * 10) / 10;
    clipsUpdateClip(clip.id, { [edge]: value });
    document.getElementById(`cs-handle-${edge}`)?.focus();
  });
  return handle;
}

// ---------- Panels ----------

function clipsClipPanel(project) {
  const panel = csPanel("Clips", "cs-clips-title", "cs-clips-panel");
  const add = csButton("New clip at current time", () => clipsNewClip(clipsCurrentTime()), "", "cs-add-clip");
  panel.append(add);
  if (!project.clips.length) {
    panel.append(csEmpty("No clips yet. Play the video, mark moments, then press “Set in” and “Set out”, or start a clip from a moment or transcript line."));
    return panel;
  }
  const list = csEl("ol", "cs-clip-list");
  for (const clip of project.clips) {
    const selected = clip.id === clipsUi.selected;
    const item = csEl("li", `cs-clip${selected ? " is-selected" : ""}`);
    item.style.setProperty("--cs-type", clipLabelColors[clip.label]);
    const summary = csEl("button", "cs-clip-summary");
    summary.type = "button";
    summary.id = `cs-clip-pick-${clip.id}`;
    summary.setAttribute("aria-expanded", String(selected));
    summary.append(csEl("span", "cs-clip-time", `${creatorFormatTime(clip.start, { decimals: 1 })}–${creatorFormatTime(clip.end, { decimals: 1 })}`),
      csEl("strong", "", clip.title || clipLabelNames[clip.label]),
      csEl("span", "cs-hint", `${clipLabelNames[clip.label]}${clip.rating ? ` · ${"★".repeat(clip.rating)}` : ""} · ${clip.status}`));
    summary.addEventListener("click", () => {
      clipsUi.selected = clip.id;
      clipsSeek(clip.start, { play: false });
      clipsRedraw();
    });
    item.append(summary);
    if (selected) item.append(clipsClipEditor(project, clip));
    list.append(item);
  }
  panel.append(list);
  return panel;
}

function clipsClipEditor(project, clip) {
  const box = csEl("div", "cs-clip-editor");
  const times = csEl("div", "cs-form-grid cs-times");
  const start = csInput("cs-clip-start", creatorFormatTime(clip.start, { decimals: 1 }));
  const end = csInput("cs-clip-end", creatorFormatTime(clip.end, { decimals: 1 }));
  const length = csEl("output", "cs-length", `${(clip.end - clip.start).toFixed(1)} s`);
  length.id = "cs-clip-length";
  const error = csEl("p", "cs-status-line error");
  error.setAttribute("role", "alert");
  const commitTimes = () => {
    const from = creatorParseTime(start.value);
    const to = creatorParseTime(end.value);
    if (from === null || to === null) { error.textContent = "Write times like 1:23.5 or 1:02:03."; return; }
    if (to <= from) { error.textContent = "The out point has to come after the in point."; return; }
    error.textContent = "";
    clipsUpdateClip(clip.id, { start: from, end: Math.min(to, clipsDuration(project)) });
  };
  start.addEventListener("change", commitTimes);
  end.addEventListener("change", commitTimes);
  const inField = csField("In", start);
  inField.append(csButton("Use current time", () => clipsSetEdge("start")));
  const outField = csField("Out", end);
  outField.append(csButton("Use current time", () => clipsSetEdge("end")));
  const lengthField = csEl("div", "field");
  lengthField.append(csEl("span", "cs-label", "Length"), length);
  times.append(inField, outField, lengthField);
  box.append(times, error);
  const play = csEl("div", "cs-actions");
  play.append(csButton("▶ Play clip", () => { clipsUi.stopAt = clip.end; clipsSeek(clip.start); }, "", "cs-play-clip"),
    csButton("Duplicate", () => clipsNewClip(clip.start, clip.end, { label: clip.label, title: clip.title ? `${clip.title} (copy)` : "" })),
    csConfirmButton(`clip-${clip.id}`, "Delete clip", () => {
      const current = clipsProject();
      clipsUi.selected = "";
      clipsSave({ ...current, clips: current.clips.filter((item) => item.id !== clip.id) });
    }));
  box.append(play);
  const grid = csEl("div", "cs-form-grid");
  const label = csSelect("cs-clip-label", creatorClipLabels, clip.label);
  label.addEventListener("change", () => clipsUpdateClip(clip.id, { label: label.value }));
  const status = csSelect("cs-clip-status", creatorClipStatuses, clip.status);
  status.addEventListener("change", () => clipsUpdateClip(clip.id, { status: status.value }));
  const platform = csSelect("cs-clip-platform", creatorClipPlatforms, clip.platform);
  platform.addEventListener("change", () => clipsUpdateClip(clip.id, { platform: platform.value }));
  const rating = csEl("div", "cs-rating");
  rating.setAttribute("role", "group");
  rating.setAttribute("aria-label", "Clip potential");
  for (let value = 1; value <= 5; value++) {
    const star = csButton(value <= (clip.rating || 0) ? "★" : "☆", () => clipsUpdateClip(clip.id, { rating: clip.rating === value ? null : value }), "cs-star", `cs-star-${value}`);
    star.setAttribute("aria-pressed", String(clip.rating === value));
    star.setAttribute("aria-label", `${value} out of 5`);
    rating.append(star);
  }
  const ratingField = csEl("div", "field");
  ratingField.append(csEl("span", "cs-label", "Potential"), rating);
  grid.append(csField("Label", label), ratingField, csField("Status", status), csField("Destination", platform));
  const text = (id, labelText, field, multiline = false, placeholder = "") => {
    const input = multiline ? csTextarea(id, clip[field], placeholder, 2) : csInput(id, clip[field], { placeholder });
    input.addEventListener("change", () => clipsUpdateClip(clip.id, { [field]: input.value }, { redraw: false }));
    const wrapper = csField(labelText, input);
    wrapper.classList.add("cs-wide");
    return wrapper;
  };
  grid.append(text("cs-clip-title", "Title", "title", false, "What the clip is called"), text("cs-clip-hook", "Hook", "hook", false, "The first line on screen"),
    text("cs-clip-caption", "Caption", "caption", true), text("cs-clip-hashtags", "Hashtags", "hashtags", false, "#reaction #kpop"), text("cs-clip-notes", "Notes", "notes", true, "Edit notes for Resolve"));
  box.append(grid);
  return box;
}

function clipsSidePanels(project) {
  const column = csEl("div", "cs-side");
  // Moments
  const moments = csPanel("Moments", "cs-moments-title");
  const markForm = csEl("form", "cs-form-row");
  const note = csInput("cs-moment-note", "", { placeholder: "What happened (optional)" });
  const mark = csEl("button", "", "Mark at current time");
  mark.type = "submit";
  markForm.append(csField("Note", note), mark);
  markForm.addEventListener("submit", (event) => {
    event.preventDefault();
    clipsMarkMoment(note.value.trim());
  });
  moments.append(markForm);
  if (project.moments.length) {
    const list = csEl("ul", "cs-moment-list");
    for (const moment of project.moments) {
      const item = csEl("li");
      const time = csButton(creatorFormatTime(moment.t, { decimals: 1 }), () => clipsSeek(moment.t), "cs-time-button");
      time.setAttribute("aria-label", `Seek to ${creatorFormatTime(moment.t)}`);
      const text = csInput(`cs-moment-${moment.id}`, moment.note, { placeholder: "Note" });
      text.setAttribute("aria-label", `Note for the moment at ${creatorFormatTime(moment.t)}`);
      text.addEventListener("change", () => {
        const current = clipsProject();
        clipsSave({ ...current, moments: current.moments.map((item2) => (item2.id === moment.id ? { ...item2, note: text.value } : item2)) }, { redraw: false });
      });
      item.append(time, text, csButton("Clip it", () => clipsNewClip(Math.max(0, moment.t - 5), moment.t + 25, { notes: moment.note })),
        csButton("✕", () => {
          const current = clipsProject();
          clipsSave({ ...current, moments: current.moments.filter((item2) => item2.id !== moment.id) });
        }, "secondary cs-icon", ""));
      item.lastChild.setAttribute("aria-label", `Delete the moment at ${creatorFormatTime(moment.t)}`);
      list.append(item);
    }
    moments.append(list);
  } else {
    moments.append(csEl("p", "cs-hint", "Press M (or the button) while watching to drop a marker."));
  }
  column.append(moments);

  // Chapters
  const chapters = csPanel("Chapters", "cs-chapters-title");
  if (project.chapters.length) {
    const list = csEl("ul", "cs-moment-list");
    for (const chapter of project.chapters) {
      const item = csEl("li");
      item.append(csButton(creatorFormatTime(chapter.t), () => clipsSeek(chapter.t), "cs-time-button"), csEl("span", "", chapter.title));
      list.append(item);
    }
    chapters.append(list);
  } else {
    chapters.append(csEl("p", "cs-hint", project.source.youtubeId ? "No chapters found. YouTube chapters come from timestamps in the video’s description; paste them below if you have them." : "Paste chapter timestamps below if you have them."));
  }
  const chapterForm = csEl("details", "cs-details");
  chapterForm.append(csEl("summary", "", project.chapters.length ? "Replace chapters" : "Add chapters"));
  const chapterText = csTextarea("cs-chapter-text", "", "0:00 Intro\n1:15 First listen\n6:40 Verdict", 4);
  const chapterError = csEl("p", "cs-status-line error");
  const saveChapters = csButton("Save chapters", () => {
    const rows = creatorParseTimestampLines(chapterText.value).filter((row) => row.text);
    if (!rows.length) { chapterError.textContent = "Couldn’t find any “time title” lines."; return; }
    clipsUi.status = `Saved ${rows.length} chapters.`;
    clipsSave({ ...clipsProject(), chapters: rows.map((row) => ({ t: row.t, title: row.text })) });
  });
  chapterForm.append(csField("One per line", chapterText), saveChapters, chapterError);
  if (project.source.youtubeId && creatorApiKey()) {
    chapterForm.append(csButton("Load from the YouTube description", async () => {
      try {
        const [video] = await creatorFetchVideos([project.source.youtubeId]);
        const rows = video ? creatorChaptersFromDescription(video.description) : [];
        clipsUi.status = rows.length ? `Loaded ${rows.length} chapters from the description.` : "This video’s description has no chapter timestamps.";
        clipsSave({ ...clipsProject(), chapters: rows.length ? rows : clipsProject().chapters });
      } catch (error) {
        clipsUi.status = error.message;
        clipsRedraw();
      }
    }));
  }
  chapters.append(chapterForm);
  column.append(chapters);

  // Transcript
  const transcript = csPanel("Transcript", "cs-transcript-title");
  transcript.append(csEl("p", "cs-hint", "Paste or open a transcript you already have (SRT, WebVTT, or lines starting with a timestamp). Creator Studio doesn’t transcribe audio."));
  if (project.transcript.length) {
    const search = csInput("cs-transcript-search", clipsUi.transcriptQuery, { type: "search", placeholder: "Search the transcript" });
    const list = csEl("ol", "cs-transcript");
    const render = () => {
      const words = clipsUi.transcriptQuery.toLowerCase().split(/\s+/).filter(Boolean);
      list.replaceChildren();
      for (const row of project.transcript) {
        if (words.length && !words.every((word) => row.text.toLowerCase().includes(word))) continue;
        const item = csEl("li", "cs-line");
        item.dataset.t = String(row.t);
        item.append(csButton(creatorFormatTime(row.t), () => clipsSeek(row.t), "cs-time-button"), csEl("span", "", row.text),
          csButton("Mark", () => {
            const current = clipsProject();
            clipsUi.status = `Marked a moment at ${creatorFormatTime(row.t)}.`;
            clipsSave({ ...current, moments: [...current.moments, { id: creatorId("moment"), t: row.t, note: row.text.slice(0, 200) }] });
          }, "secondary cs-small"));
        list.append(item);
      }
      if (!list.children.length) list.append(csEl("li", "cs-hint", "No lines match."));
    };
    search.addEventListener("input", () => { clipsUi.transcriptQuery = search.value; render(); clipsTick(); });
    render();
    transcript.append(csField(`${project.transcript.length} lines`, search), list);
  }
  const importBox = csEl("details", "cs-details");
  importBox.append(csEl("summary", "", project.transcript.length ? "Replace transcript" : "Import a transcript"));
  const paste = csTextarea("cs-transcript-text", "", "00:00:01,000 --> 00:00:03,000\nFirst line…\n\nor\n0:01 First line", 5);
  const file = document.createElement("input");
  file.type = "file";
  file.id = "cs-transcript-file";
  file.accept = ".srt,.vtt,.txt,text/plain,text/vtt";
  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    if (chosen) paste.value = (await chosen.text()).slice(0, creatorLimits.transcript * 2);
  });
  const transcriptError = csEl("p", "cs-status-line error");
  importBox.append(csField("Paste text", paste), csField("Or open a file", file), csButton("Save transcript", () => {
    const rows = creatorParseTranscript(paste.value);
    if (!rows.length) { transcriptError.textContent = "No timestamped lines found. Use SRT, WebVTT, or lines like “1:23 text”."; return; }
    clipsUi.status = `Imported ${rows.length} transcript lines.`;
    clipsSave({ ...clipsProject(), transcript: rows });
  }), transcriptError);
  if (project.transcript.length) importBox.append(csButton("Clear transcript", () => clipsSave({ ...clipsProject(), transcript: [] }), "secondary cs-danger"));
  transcript.append(importBox);
  column.append(transcript);

  // Export
  const exportPanel = csPanel("Export for DaVinci Resolve", "cs-export-title");
  const fps = csSelect("cs-export-fps", [["24", "24 fps (23.976)"], ["25", "25 fps"], ["30", "30 fps (29.97)"], ["60", "60 fps (59.94)"]], String(clipsUi.fps));
  fps.addEventListener("change", () => { clipsUi.fps = Number(fps.value); });
  const scope = csSelect("cs-export-scope", [["all", "All clips"], ["approved", "Approved and later"], ["rated", "Rated 4★ or higher"]], clipsUi.scope);
  scope.addEventListener("change", () => { clipsUi.scope = scope.value; });
  const exportClips = () => {
    const current = clipsProject();
    const order = creatorClipStatuses;
    return current.clips.filter((clip) => clipsUi.scope === "all" || (clipsUi.scope === "approved" ? order.indexOf(clip.status) >= 1 : (clip.rating || 0) >= 4));
  };
  const download = csButton("Download CSV", () => {
    const rows = exportClips();
    if (!rows.length) { clipsUi.status = "No clips match that export filter."; clipsRedraw(); return; }
    const blob = new Blob([`﻿${creatorClipCsv(clipsProject(), rows, clipsUi.fps)}`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${clipsProject().source.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "clips"} clips.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    clipsUi.status = `Downloaded ${rows.length} clip${rows.length === 1 ? "" : "s"} as CSV.`;
    clipsRedraw();
  }, "", "cs-export-csv");
  const grid = csEl("div", "cs-form-row");
  grid.append(csField("Frame rate", fps), csField("Include", scope), download);
  exportPanel.append(grid, csEl("p", "cs-hint", "The CSV lists each clip’s source link, in and out points (as times, seconds and timecodes), title and notes. Use it as a cut list or to place markers in Resolve; it doesn’t render or download video. Timecodes for 23.976, 29.97 and 59.94 are written at the rounded rate."));
  column.append(exportPanel);
  return column;
}
