// Run with: node tests/notifications.test.js
const fs = require("fs");
const assert = require("assert");
const vm = require("vm");
const context = { console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + "/../notifications.js", "utf8"), context);
context.input = {
  plans: [{ status: "Ticket Purchased", event: { id: "e1", date: "2026-11-19", time: "20:00", name: "Tour", attractions: [{ name: "aespa" }], venue: { name: "MSG" } } },
    { status: "Interested", event: { id: "e2", date: "2026-11-19", name: "Other", venue: {} } }],
  leagues: [{ id: "l1", name: "Thursday Trios", night: 4, center: "Bowlero", time: "19:00" }, { id: "l2", name: "Monday", night: 1 },
    { id: "l3", name: "Old", night: 4, seasonEnd: "2026-05-01" }],
  schedule: [{ id: "c1", title: "Vlog", date: "2026-11-19", status: "scheduled" }, { id: "c2", title: "Done", date: "2026-11-19", status: "published" }],
  kpop: [{ title: "aespa – RICH MAN", date: "2026-11-19", href: "https://kpopofficial.com/x" }, { title: "Later", date: "2026-11-20" }],
  games: [{ title: "Big Game", date: "2026-11-19", url: "https://gameinformer.com/x", platforms: ["PC"] }, { title: "Next", date: "2026-12-01", url: "y" }]
};
const alerts = vm.runInContext('notifyTodayAlerts("2026-11-19", input)', context); // Nov 19 2026 is a Thursday
assert.deepStrictEqual([...alerts.today.map((a) => a.title)], ["Tonight: aespa", "League night: Thursday Trios", "Planned upload today: Vlog"]);
assert.deepStrictEqual([...alerts.kpop.map((a) => a.title)], ["Out today: aespa – RICH MAN"]);
assert.deepStrictEqual([...alerts.games.map((a) => a.key)], ["game:https://gameinformer.com/x"]);
console.log("notification tests passed");
