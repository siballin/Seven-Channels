// Unit tests for betting-stats.js. Run: node tests/betting-stats.test.js
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'betting-stats.js'), 'utf8') + ';this.B={bettingStats,bettingSportOf,bettingDateOf,bettingProfit};', ctx);
const B = ctx.B; const eq = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
const bet = (id, extra) => ({ id, channel: 'betting', title: 'x', odds: -110, stake: 1.1, status: 'won', betType: 'straight', ...extra });
const entries = [
  bet('1', { title: 'Lakers ML', placedOn: '2026-01-01', odds: 150, stake: 1 }),           // NBA by words, +1.50
  bet('2', { title: 'Chiefs -3', placedOn: '2026-01-02', status: 'lost' }),               // NFL, -1.10
  bet('3', { title: 'Yankees over', placedOn: '2026-01-03', sport: 'Golf', status: 'push' }), // chosen sport wins, 0
  bet('4', { title: 'Parlay', placedOn: '2026-01-04', betType: 'parlay', odds: 300, stake: 1, status: 'lost' }), // -1
  bet('5', { title: 'Mystery', game: { id: '9', date: '2026-01-05' } }),                  // NBA by game link, +1.00
  bet('6', { title: 'Open bet', status: 'open' }),                                          // not settled
  { id: '7', channel: 'movies', title: 'Not a bet', status: 'done' },
];
eq(B.bettingSportOf(entries[0]), 'NBA');
eq(B.bettingSportOf(entries[1]), 'NFL');
eq(B.bettingSportOf(entries[2]), 'Golf');
eq(B.bettingSportOf({ title: 'Something else' }), 'Other');
eq(B.bettingDateOf(entries[4]), '2026-01-05');
const all = B.bettingStats(entries, { startingBankroll: 100, unitSize: 10 });
eq([all.bets, all.wins, all.losses, all.pushes], [5, 2, 2, 1]);
eq(Math.round(all.net * 100) / 100, 0.4);                    // 1.5 - 1.1 + 0 - 1 + 1
eq(Math.round(all.bankroll * 100) / 100, 104);              // 100 + 0.4 units * $10
eq(all.timeline.map((p) => Math.round(p.units * 100) / 100), [1.5, 0.4, 0.4, -0.6, 0.4]);
eq([all.longestWin, all.longestLoss, all.streak.kind, all.streak.length], [1, 2, 'won', 1]); // push doesn't break the L-L run
eq(all.bySport.map((g) => g.name), ['NBA', 'NFL', 'Golf', 'Other']);
eq(all.byType.map((g) => [g.name, g.bets]), [['straight', 4], ['parlay', 1]]);
eq(Math.round(all.roi * 10) / 10, Math.round(0.4 / (1 + 1.1 + 1 + 1.1) * 1000) / 10); // pushes excluded from stake
const nba = B.bettingStats(entries, { sport: 'NBA' });
eq([nba.bets, nba.wins], [2, 2]);
eq(B.bettingStats(entries, { type: 'parlay' }).bets, 1);
console.log('betting stats ok');
