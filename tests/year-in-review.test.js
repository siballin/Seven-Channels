// Run with: node tests/year-in-review.test.js
const fs = require("fs");
const assert = require("assert");
const vm = require("vm");
const context = { console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + "/../betting-stats.js", "utf8") + fs.readFileSync(__dirname + "/../year-in-review.js", "utf8"), context);
const run = (code) => vm.runInContext(code, context);
context.input = {
  entries: [
    { id: "1", channel: "movies", status: "done", title: "Sinners", rating: 9, updatedAt: "2026-04-02T00:00:00Z" },
    { id: "2", channel: "movies", status: "done", title: "Old", rating: 10, updatedAt: "2025-04-02T00:00:00Z" },
    { id: "3", channel: "games", status: "done", title: "Hades II", updatedAt: "2026-09-02T00:00:00Z" },
    { id: "4", channel: "betting", status: "won", title: "Knicks ML", odds: 150, stake: 1, placedOn: "2026-01-10" },
    { id: "5", channel: "betting", status: "lost", title: "Jets +3", odds: -110, stake: 1.1, placedOn: "2026-02-10" },
    { id: "6", channel: "betting", status: "won", title: "2025 bet", odds: 100, stake: 1, placedOn: "2025-12-31" }
  ],
  bowling: { sessions: [
    { date: "2026-02-01", games: [{ score: 180 }, { score: 200 }, { score: 220 }] },
    { date: "2026-08-01", games: [{ score: 210 }, { score: 190 }] },
    { date: "2025-08-01", games: [{ score: 300 }] }
  ] },
  live: { journal: [
    { date: "2026-03-01", artist: { name: "aespa" }, venue: "UBS Arena", city: "Elmont", rating: 9, price: 120, lineup: [] },
    { date: "2026-06-01", artist: { name: "aespa" }, venue: "MSG", city: "New York", rating: 10, price: 0, lineup: ["XG"] }
  ] },
  creator: { schedule: [{ date: "2026-05-05", status: "published", type: "youtube" }, { date: "2026-05-06", status: "draft", type: "youtube" }], ideas: [] },
  musicLab: { items: [{ key: "person:1", title: "Teddy", following: true, discoveredAt: "2026-07-01T00:00:00Z" }, { key: "person:2", title: "Old", following: true, discoveredAt: "2024-07-01T00:00:00Z" }] }
};
const stats = run("wrappedStats(2026, input)");
assert.strictEqual(stats.concerts.count, 2);
assert.strictEqual(stats.concerts.artists, 2);
assert.strictEqual(stats.concerts.best.venue, "MSG");
assert.deepStrictEqual({ ...stats.concerts.mostSeen }, { name: "aespa", times: 2 });
assert.strictEqual(stats.bowling.games, 5);
assert.strictEqual(stats.bowling.average, 200);
assert.strictEqual(stats.bowling.high, 220);
assert.strictEqual(stats.bowling.highSeries, 600);
assert.strictEqual(stats.bowling.twoHundreds, 3);
assert.strictEqual(stats.media.movies.count, 1);
assert.strictEqual(stats.media.games.count, 1);
assert.strictEqual(stats.betting.bets, 2);
assert.strictEqual(stats.betting.wins, 1);
assert.ok(Math.abs(stats.betting.net - 0.4) < 1e-9);
assert.deepStrictEqual([...stats.music.producers], ["Teddy"]);
assert.strictEqual(stats.creator.published, 1);
assert.deepStrictEqual([...run("wrappedYears(input)")].slice(0, 2), [2026, 2025]);
const text = run("wrappedSummaryText(wrappedStats(2026, input))");
assert.ok(text.includes("2 concerts") && text.includes("200.0 average") && text.includes("1-1 betting"), text);
console.log("year-in-review tests passed");
