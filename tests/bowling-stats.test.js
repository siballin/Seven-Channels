// Unit tests for bowling-stats.js. Run: node tests/bowling-stats.test.js
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert');
const store = {};
const ctx = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => delete store[k] }, crypto: require('crypto'), structuredClone, console, Intl, Date };
vm.createContext(ctx);
const load = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
vm.runInContext([load('bowling.js'), load('bowling-scorer.js'), load('bowling-stats.js')].join('\n;\n') + ';this.B={bowlingStatsData,bowlingStatsSessions,bowlingNormalizeSession,bowlingPinBit};', ctx);
const B = ctx.B; const eq = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
const bit = (...pins) => pins.reduce((mask, pin) => mask | B.bowlingPinBit(pin), 0);
const X = [0];
// Game A: 9 strikes then 10th frame: 7-pin leave (9), picked up (spare), then strike. = 9 strikes + spare.
const gameA = [X, X, X, X, X, X, X, X, X, [bit(7), 0, 0]];
// Game B: all frames 9 then miss the 10 pin (open), except frame 1 is a 7-10 split converted? no: left 7-10, picked up 7 only.
const open10 = [bit(10), bit(10)];
const gameB = [[bit(7, 10), bit(10)], ...Array(9).fill(open10)];
const session = (id, date, games, extra = {}) => B.bowlingNormalizeSession({ id, date, type: 'league', games, ...extra });
const s1 = session('s1', '2026-01-05', [{ frames: gameA }, { frames: gameB }, { score: 150 }]);
const s2 = session('s2', '2026-02-05', [{ score: 200 }, { score: 180 }], { type: 'practice' });
const s3 = session('s3', '2025-06-01', [{ score: 120 }]);
assert.strictEqual(s1.games[0].score, 279);
assert.strictEqual(s1.games[1].score, 90);
const data = B.bowlingStatsData(B.bowlingStatsSessions([s1, s2, s3], { range: 'all', league: 'all', type: 'all' }, '2026-03-01'));
eq([data.games, data.high, data.low, data.highSeries, data.over200], [6, 279, 90, 519, 2]);
assert.strictEqual(Math.round(data.average * 10) / 10, Math.round((279 + 90 + 150 + 200 + 180 + 120) / 6 * 10) / 10);
// Oldest first, rolling average includes earlier nights
eq(data.trend.map((t) => t.session.id), ['s3', 's1', 's2']);
assert.strictEqual(data.trend[1].rolling, (120 + 279 + 90 + 150) / 4);
eq(data.byGame.map((g) => [g.game, g.count]), [[1, 3], [2, 2], [3, 1]]);
assert.strictEqual(data.buckets.reduce((sum, b) => sum + b.count, 0), 6);
// Frame-by-frame
const f = data.frames;
assert.strictEqual(f.games, 2);
assert.strictEqual(f.opens, 10); // game A clean, game B every frame open
assert.strictEqual(f.cleanGames, 1);
assert.strictEqual(f.strikes, 10); // 9 + the bonus ball in game A
assert.deepStrictEqual([f.doubles, f.doubleChances], [8, 9]); // frames 2-9 after strikes are doubles; 10th first ball after strike isn't
assert.strictEqual(f.pinLeft[10], 10); // game B every first ball leaves the 10
assert.strictEqual(f.pinLeft[7], 2);
eq([f.pinChances[7], f.pinMade[7]], [2, 2]);
eq([f.pinChances[10], f.pinMade[10]], [10, 0]);
// Filters
const year = B.bowlingStatsSessions([s1, s2, s3], { range: 'year', league: 'all', type: 'all' }, '2026-03-01');
eq(year.map((s) => s.id), ['s1', 's2']);
const practice = B.bowlingStatsSessions([s1, s2, s3], { range: 'all', league: 'all', type: 'practice' }, '2026-03-01');
eq(practice.map((s) => s.id), ['s2']);
const recent = B.bowlingStatsSessions([s1, s2, s3], { range: '90', league: 'all', type: 'all' }, '2026-03-01');
eq(recent.map((s) => s.id), ['s1', 's2']);
console.log('bowling stats ok');
