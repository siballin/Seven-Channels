// Run with: node tests/search.test.js
const fs = require("fs");
const assert = require("assert");
const vm = require("vm");
const context = { console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + "/../search.js", "utf8"), context);
const rec = (group, title, extra = "") => ({ group, title, href: "#x", text: context.searchFold(`${title} ${extra}`) });
context.records = [rec("Your lists", "Beyoncé live"), rec("Concerts", "aespa", "UBS Arena Elmont"), rec("Music Lab", "aespa Supernova"), rec("Headlines", "Why aespa is touring"),
  ...Array.from({ length: 9 }, (_, i) => rec("Headlines", `Story ${i} aespa`))];
const run = (code) => vm.runInContext(code, context);
let groups = run('searchRank(records, "beyonce")');
assert.strictEqual(groups[0].items[0].title, "Beyoncé live", "accents are folded");
groups = run('searchRank(records, "AESPA")');
assert.strictEqual(groups[0].group, "Concerts", "exact title match ranks first");
const headlines = groups.find((group) => group.group === "Headlines");
assert.strictEqual(headlines.items.length, 6);
assert.strictEqual(headlines.total, 10);
groups = run('searchRank(records, "aespa elmont")');
assert.strictEqual(groups.length, 1, "every word must match");
assert.strictEqual(run('searchRank(records, "   ").length'), 0);
console.log("search tests passed");
