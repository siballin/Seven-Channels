// Your fixes and additions to idol and group profiles (positions, fandom, MBTI, height, notes).
// Saved on this device and synced with your account; idols.js shows them over the published data,
// and "Copy as overrides" turns them into entries for data/idols/overrides.json so they reach everyone.

const idolEditsStorageKey = "seven-channels.idol-edits.v1";
const idolEditFields = {
  positions: { label: "Positions", list: true, max: 80, hint: "Comma-separated, e.g. Leader, Main dancer" },
  fandom: { label: "Fandom name", max: 60 },
  mbti: { label: "MBTI", max: 4, pattern: /^[EI][NS][TF][JP]$/i },
  height: { label: "Height (cm)", number: true, min: 120, max: 220 },
  note: { label: "Your note", max: 600, multiline: true }
};
let idolEditsState = null;
let idolEditsOnChange = null;

function idolNormalizeValue(field, value) {
  const rule = idolEditFields[field];
  if (!rule || value === null || value === undefined || value === "") return undefined;
  if (rule.list) {
    const list = (Array.isArray(value) ? value : String(value).split(","))
      .map((item) => String(item).replace(/\s+/g, " ").trim().slice(0, rule.max)).filter(Boolean);
    return list.length ? [...new Set(list)].slice(0, 8) : undefined;
  }
  if (rule.number) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) && number >= rule.min && number <= rule.max ? number : undefined;
  }
  const text = String(value).replace(rule.multiline ? /[ \t]+/g : /\s+/g, " ").trim().slice(0, rule.max);
  if (!text) return undefined;
  if (rule.pattern && !rule.pattern.test(text)) return undefined;
  return field === "mbti" ? text.toUpperCase() : text;
}

function idolNormalizeEdit(value) {
  if (!value || typeof value !== "object" || !/^Q\d{1,12}$/.test(value.id || "") || !["person", "group"].includes(value.kind)) return null;
  const fields = {};
  for (const field of Object.keys(idolEditFields)) {
    const normalized = idolNormalizeValue(field, value.fields?.[field]);
    if (normalized !== undefined) fields[field] = normalized;
  }
  const updatedAt = typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt)) ? value.updatedAt : new Date(0).toISOString();
  return { id: value.id, kind: value.kind, name: typeof value.name === "string" ? value.name.slice(0, 120) : "", fields, updatedAt };
}

function idolNormalizeState(value) {
  const map = new Map();
  for (const edit of (Array.isArray(value?.edits) ? value.edits : []).map(idolNormalizeEdit)) {
    if (edit && (!map.has(edit.id) || map.get(edit.id).updatedAt < edit.updatedAt)) map.set(edit.id, edit);
  }
  return { edits: [...map.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

function idolValidState(value) {
  return Boolean(value && typeof value === "object" && Array.isArray(value.edits));
}

// Newest edit per profile wins; an edit with no fields left is a deletion and still carries its time.
function idolMergeState(local, remote) {
  return idolNormalizeState({ edits: [...(local?.edits || []), ...(remote?.edits || [])] });
}

function idolEditsGet() {
  if (!idolEditsState) {
    try {
      idolEditsState = idolNormalizeState(JSON.parse(localStorage.getItem(idolEditsStorageKey) || "{}"));
    } catch (error) {
      console.error("Could not read your idol profile edits.", error);
      idolEditsState = idolNormalizeState({});
    }
  }
  return idolEditsState;
}

function idolEditsReplace(value) {
  idolEditsState = idolNormalizeState(value);
  try { localStorage.setItem(idolEditsStorageKey, JSON.stringify(idolEditsState)); } catch (error) { console.error("Could not save idol edits.", error); }
}

function idolEditFor(id) {
  return idolEditsGet().edits.find((edit) => edit.id === id) || null;
}

function idolSaveEdit(id, kind, name, fields) {
  const previous = idolEditFor(id);
  const updatedAt = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
  const edit = idolNormalizeEdit({ id, kind, name, fields, updatedAt });
  const next = { edits: [...idolEditsGet().edits.filter((item) => item.id !== id), edit] };
  try {
    localStorage.setItem(idolEditsStorageKey, JSON.stringify(idolNormalizeState(next)));
  } catch (error) {
    console.error("Could not save idol edits.", error);
    if (typeof showNotice === "function") showNotice("Your profile edit couldn’t be saved in this browser.");
    return false;
  }
  idolEditsState = idolNormalizeState(next);
  if (typeof idolEditsOnChange === "function") idolEditsOnChange();
  return true;
}

// Entries for data/idols/overrides.json, keyed by Wikidata id.
function idolOverridesExport() {
  const out = { groups: {}, people: {} };
  for (const edit of idolEditsGet().edits) {
    const fields = { ...edit.fields };
    delete fields.note; // notes are personal
    if (!Object.keys(fields).length) continue;
    out[edit.kind === "group" ? "groups" : "people"][edit.id] = { _name: edit.name, ...fields };
  }
  return out;
}
