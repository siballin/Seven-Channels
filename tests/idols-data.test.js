// Run with: node tests/idols-data.test.js
const fs = require("fs");
const assert = require("assert");
const vm = require("vm");
const store = {};
const context = { console, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + "/../idols-data.js", "utf8"), context);
const run = (code) => JSON.parse(JSON.stringify(vm.runInContext(code, context)));
assert.deepStrictEqual(run('idolNormalizeValue("positions", "Leader,  Main dancer, Leader")'), ["Leader", "Main dancer"]);
assert.strictEqual(run('idolNormalizeValue("mbti", "enfp")'), "ENFP");
assert.strictEqual(vm.runInContext('idolNormalizeValue("mbti", "nope")', context), undefined);
assert.strictEqual(vm.runInContext('idolNormalizeValue("height", "400")', context), undefined);
assert.strictEqual(run('idolNormalizeValue("height", "167.6")'), 168);
assert.strictEqual(vm.runInContext('idolNormalizeEdit({ id: "bad", kind: "person" })', context), null);
// Newest edit wins; an empty edit (cleared) still overrides an older one.
const merged = run(`idolMergeState(
  { edits: [{ id: "Q1", kind: "group", fields: { fandom: "MY" }, updatedAt: "2026-01-01T00:00:00Z" }, { id: "Q2", kind: "person", fields: { mbti: "ENTJ" }, updatedAt: "2026-03-01T00:00:00Z" }] },
  { edits: [{ id: "Q1", kind: "group", fields: { fandom: "MY!" }, updatedAt: "2026-02-01T00:00:00Z" }, { id: "Q2", kind: "person", fields: {}, updatedAt: "2026-04-01T00:00:00Z" }] })`);
assert.strictEqual(merged.edits.find((e) => e.id === "Q1").fields.fandom, "MY!");
assert.deepStrictEqual(merged.edits.find((e) => e.id === "Q2").fields, {});
// Saving and exporting; notes stay private.
assert.ok(vm.runInContext('idolSaveEdit("Q10", "person", "Karina", { positions: "Leader", note: "fave" })', context));
assert.deepStrictEqual(run("idolOverridesExport()"), { groups: {}, people: { Q10: { _name: "Karina", positions: ["Leader"] } } });
assert.ok(JSON.parse(store["seven-channels.idol-edits.v1"]).edits.length === 1);
console.log("idols-data tests passed");
