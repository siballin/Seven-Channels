// Unit tests for live-events-data.js. Run: node tests/live-events.test.js
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert');
const store = {};
const ctx = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => delete store[k] }, crypto: require('crypto'), structuredClone, URL, URLSearchParams, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'live-events-data.js'), 'utf8') + ';this.L={liveParseSetlist,liveSetlistText,liveEventFromApi,liveNormalizeState,liveMergeState,liveUpsert,liveRemove,liveGetState,liveSetlistFromSnapshot,liveNormalizeFollow,liveSaveLocal,liveLocal,liveEventsPlannedConcerts};', ctx);
const L = ctx.L; const eq = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
// Setlists
const songs = L.liveParseSetlist('1. Intro\n2) Hit Song\n\nEncore:\n- Finale\n--- encore 2 ---\nBonus');
eq(songs, [{ name: 'Intro', encore: 0 }, { name: 'Hit Song', encore: 0 }, { name: 'Finale', encore: 1 }, { name: 'Bonus', encore: 2 }]);
eq(L.liveSetlistText(songs), 'Intro\nHit Song\nEncore\nFinale\nEncore 2\nBonus');
eq(L.liveSetlistFromSnapshot({ url: 'https://www.setlist.fm/x', tour: 'T', sets: [{ encore: 0, songs: ['A'] }, { encore: 1, songs: ['B'] }] }).songs, [{ name: 'A', encore: 0 }, { name: 'B', encore: 1 }]);
// Ticketmaster event mapping
const event = L.liveEventFromApi({ id: 'G5vYZ9abc', name: 'Band World Tour', url: 'https://www.ticketmaster.com/event/G5vYZ9abc',
  dates: { start: { localDate: '2027-03-01', localTime: '19:30:00', dateTime: '2027-03-02T03:30:00Z' }, status: { code: 'onsale' }, timezone: 'America/Los_Angeles' },
  sales: { public: { startDateTime: '2026-11-10T18:00:00Z' } },
  images: [{ url: 'https://s1.ticketm.net/a_RETINA_PORTRAIT_3_2.jpg', ratio: '3_2', width: 640 }, { url: 'https://s1.ticketm.net/b_16_9.jpg', ratio: '16_9', width: 1024 }],
  classifications: [{ segment: { name: 'Music' }, genre: { name: 'Pop' } }],
  _embedded: { venues: [{ id: 'KovZ', name: 'Kia Forum', city: { name: 'Inglewood' }, state: { stateCode: 'CA' }, country: { name: 'United States Of America', countryCode: 'US' }, location: { latitude: '33.958', longitude: '-118.341' } }],
    attractions: [{ id: 'K8vZ917', name: 'Band', externalLinks: { musicbrainz: [{ id: 'b8a7c51f-362c-4dcb-a259-bc6e0095f0a6' }] }, images: [{ url: 'https://s1.ticketm.net/c.jpg', ratio: '3_2' }] }, { id: 'K8vZ2', name: 'Opener' }] } });
eq([event.date, event.time, event.status, event.image, event.venue.city, event.venue.coords.source, event.attractions.map((a) => a.name), event.attractions[0].mbid, event.genre], ['2027-03-01', '19:30', 'onsale', 'https://s1.ticketm.net/b_16_9.jpg', 'Inglewood', 'ticketmaster', ['Band', 'Opener'], 'b8a7c51f-362c-4dcb-a259-bc6e0095f0a6', 'Pop']);
const noCoords = L.liveEventFromApi({ id: 'X1234', _embedded: { venues: [{ name: 'Somewhere' }] } });
eq(noCoords.venue.coords, null); // no invented coordinates
// Follows need a stable ID
eq(L.liveNormalizeFollow({ name: 'Nobody' }), null);
eq(L.liveNormalizeFollow({ name: 'Band', tmId: 'K8vZ917' }).id, 'tm:K8vZ917');
// Journal + plans CRUD and merge
L.liveUpsert('journal', { id: 'j1', date: '2025-08-23', artist: { name: 'Band' }, venue: 'KSPO Dome', rating: 9, setlist: { songs: songs, source: 'manual' }, coords: { lat: 37.52, lon: 127.12, source: 'openstreetmap' } });
L.liveUpsert('journal', { id: 'j2', date: 'not a date', artist: { name: 'Bad' } });
eq(L.liveGetState().journal.map((e) => [e.id, e.rating, e.setlist.songs.length, e.coords.source]), [['j1', 9, 4, 'openstreetmap']]);
L.liveUpsert('journal', { id: 'j3', date: '2025-01-01', artist: { name: 'X' }, coords: { lat: 1, lon: 2, source: 'guess' } });
eq(L.liveGetState().journal.find((e) => e.id === 'j3').coords, null); // coordinates need a real source
L.liveUpsert('plans', { id: 'p1', event: { ...event, venue: { ...event.venue } }, status: 'Ticket Purchased', price: 120.5, journalId: 'j1' });
L.liveRemove('journal', 'j1');
eq([L.liveGetState().plans[0].journalId, L.liveGetState().deleted.journal], ['', ['j1']]);
const merged = L.liveMergeState({ journal: [{ id: 'k', date: '2024-01-01', artist: { name: 'A' }, notes: 'old', updatedAt: '2026-01-01T00:00:00Z' }] },
  { journal: [{ id: 'k', date: '2024-01-01', artist: { name: 'A' }, notes: 'new', updatedAt: '2026-02-01T00:00:00Z' }], deleted: { plans: ['p1'] }, plans: [] });
eq(merged.journal[0].notes, 'new');
// Local-only settings
L.liveSaveLocal({ ticketmasterKey: 'TMKEY-UNIQUE-123', location: { lat: 34.05, lon: -118.24, label: 'Los Angeles', radius: 25 } });
eq([L.liveLocal().ticketmasterKey, L.liveLocal().location.radius], ['TMKEY-UNIQUE-123', 25]);
assert(!store['seven-channels.live-events.v1'].includes('TMKEY-UNIQUE-123')); // the key never goes into synced data
console.log('live events data ok');
