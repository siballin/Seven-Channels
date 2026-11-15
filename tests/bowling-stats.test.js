// Unit tests for bowling-stats.js. Run: node tests/bowling-stats.test.js
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert');
const store = {};
const ctx = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => delete store[k] }, crypto: require('crypto'), structuredClone, console, Intl, Date };
vm.createContext(ctx);
const load = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
vm.runInContext([load('bowling.js'), load('bowling-scorer.js'), load('bowling-stats.js')].join('\n;\n') + ';this.B={bowlingStatsData,bowlingStatsSessions,bowlingNormalizeSession,bowlingPinBit,bowlingStatsBalls,bowlingNormalizeThrowMeta,bowlingBallSwitches,bowlingNormalizeState};', ctx);
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
// ---- By ball ----
const state = B.bowlingNormalizeState({ sessions: [], deletedSessionIds: [], balls: [{ id: 'phaze', name: 'Phaze II' }, { id: 'spare', name: 'Spare Ball' }] });
// Game C: strike ball on first balls, spare ball on second shots; pocket marked on some first balls.
const gameC = [X, [bit(10), 0], [bit(10), bit(10)], X, [bit(7), 0], X, X, [bit(4, 7, 10), bit(4)], X, [0, 0, 0]];
const ballsC = gameC.map((frame) => frame.map((_, slot) => slot === 0 ? 'phaze' : 'spare'));
ballsC[9] = ['phaze', 'phaze', 'phaze'];
const pocketC = gameC.map((frame, i) => frame.map((_, slot) => slot === 0 && i < 4 ? 1 : null));
pocketC[2][0] = 0; // missed the pocket in frame 3
const s4 = session('s4', '2026-02-10', [{ frames: gameC, balls: ballsC, pocket: pocketC, ballNames: { phaze: 'Phaze II', spare: 'Spare Ball' } }, { score: 170 }],
  { startBall: { id: 'old', name: 'Old Ball' } });
eq(s4.games[0].balls[1], ['phaze', 'spare']);
eq(s4.games[0].pocket[2], [0, null]);
// Meta lines up with frames and drops extras / bad values
eq(B.bowlingNormalizeThrowMeta([[0], [512, 0]], [['a', 'extra'], ['b', 5]], [[1], ['x', 0]]), { balls: [['a'], ['b', '']], pocket: [[1], [null, 0]] });
eq(B.bowlingNormalizeThrowMeta([[0]], [['']], [[null]]), null);
const rows = B.bowlingStatsBalls([s4], state);
const phaze = rows.find((r) => r.id === 'phaze'); const spare = rows.find((r) => r.id === 'spare'); const old = rows.find((r) => r.id === 'old');
eq([phaze.games, phaze.total, phaze.firstBalls, phaze.strikes], [1, s4.games[0].score, 12, 8]);
eq([phaze.pocketKnown, phaze.pocketHits, phaze.pocketStrikes], [4, 3, 2]); // frames 1,2,4 pocket (1 and 4 struck), frame 3 missed
eq([spare.chances, spare.spares, spare.tens, spare.tensMade, spare.sevens, spare.sevensMade], [4, 2, 2, 1, 1, 1]);
eq([old.games, old.total], [1, 170]); // untracked game counts toward the starting ball
eq(phaze.topLeaves.map((l) => l.times), [2, 1, 1]);
eq(phaze.name, 'Phaze II');
// Only strike-ball changes are marked, not spare-ball shots
eq([...B.bowlingBallSwitches(gameC, ballsC).keys()], []);
const switched = ballsC.map((row) => row.slice()); switched[5][0] = 'spare'; switched[6][0] = 'phaze';
eq([...B.bowlingBallSwitches(gameC, switched).keys()], [5, 6]);
console.log('bowling stats ok');
