/**
 * Wumpus World Tel-U — backend Google Apps Script + Google Sheet
 * Developed by WHS (SoC – Telkom University)
 *
 * Cara pasang (ringkas, detail di README):
 * 1. Buat Google Sheet baru → Extensions → Apps Script → tempel file ini.
 * 2. Jalankan fungsi setup() sekali (izinkan akses). Lihat ADMIN_KEY di Execution log.
 * 3. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * 4. Salin URL Web App ke konstanta API_URL di index.html.
 */
var MAXG = 5;
var SH_GAMES = 'Games', SH_CONFIG = 'Config', SH_REKAP = 'Rekap';
var HEAD = ['Mulai', 'ID game', 'Kunci pemain', 'Nama', 'NIM', 'Guest', 'Mode', 'Ukuran', 'Status', 'Skor', 'Aksi', 'Selesai'];

/* ===================== setup (jalankan sekali) ===================== */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var g = ss.getSheetByName(SH_GAMES) || ss.insertSheet(SH_GAMES);
  if (g.getLastRow() === 0) g.appendRow(HEAD);
  g.setFrozenRows(1);
  g.getRange('E:E').setNumberFormat('@'); // NIM sebagai teks
  var c = ss.getSheetByName(SH_CONFIG) || ss.insertSheet(SH_CONFIG);
  if (c.getLastRow() === 0) c.appendRow(['Kunci', 'Nilai']);
  var r = ss.getSheetByName(SH_REKAP) || ss.insertSheet(SH_REKAP);
  r.clear();
  r.getRange('A1').setFormula(
    '=QUERY(Games!A:L,"select D, E, count(B), max(J), sum(J) where I <> \'playing\' and I <> \'reset\' and B is not null ' +
    'group by D, E order by max(J) desc label D \'Nama\', E \'NIM\', count(B) \'Game selesai\', max(J) \'Skor terbaik\', sum(J) \'Total skor\'",1)');
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('ADMIN_KEY')) p.setProperty('ADMIN_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 10));
  Logger.log('ADMIN_KEY = ' + p.getProperty('ADMIN_KEY'));
}

/* ===================== util ===================== */
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function sheet_(n) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n); }
function isAdmin_(k) { var a = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY'); return !!a && String(k || '') === a; }
function clean_(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n || 60); }
function keyOf_(nim, name) { nim = clean_(nim, 20); return nim ? 'nim:' + nim : 'g:' + clean_(name, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
function expected_(r, a) { return -10 * a + (r === 'win' ? 1000 : (r === 'pit' || r === 'wumpus') ? -1000 : 0); }
var RESULTS = { win: 1, climb: 1, pit: 1, wumpus: 1, quit: 1 };

function rows_() {
  var sh = sheet_(SH_GAMES), n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, 12).getValues().map(function (r, i) {
    return { row: i + 2, t: r[0] instanceof Date ? r[0].getTime() : +r[0] || 0, id: String(r[1]), key: String(r[2]), name: String(r[3]),
      nim: String(r[4]), guest: r[5] === true || r[5] === 'TRUE', m: String(r[6]), n: +r[7] || 5, r: String(r[8]),
      s: r[9] === '' ? null : +r[9], a: r[10] === '' ? null : +r[10] };
  });
}
function counted_(list, key) { return list.filter(function (x) { return x.key === key && x.r !== 'reset'; }); }
function official_() {
  var c = sheet_(SH_CONFIG), n = c.getLastRow();
  if (n < 2) return null;
  var v = c.getRange(2, 1, n - 1, 2).getValues();
  for (var i = 0; i < v.length; i++) if (v[i][0] === 'official') { try { return JSON.parse(v[i][1]); } catch (e) { return null; } }
  return null;
}
function summary_(list) {
  var m = {};
  list.forEach(function (x) {
    if (x.r === 'reset') return;
    var p = m[x.key] || (m[x.key] = { key: x.key, name: x.name, nim: x.nim, guest: x.guest, games: [] });
    p.name = x.name;
    p.games.push({ id: x.id, t: x.t, m: x.m, n: x.n, r: x.r, s: x.s, a: x.a });
  });
  return Object.keys(m).map(function (k) {
    var p = m[k], done = p.games.filter(function (g) { return g.r !== 'playing'; });
    p.played = p.games.length;
    p.best = done.length ? Math.max.apply(null, done.map(function (g) { return g.s; })) : null;
    p.last = done.length ? done[done.length - 1].s : null;
    p.total = done.reduce(function (a, g) { return a + g.s; }, 0);
    return p;
  });
}

/* ===================== GET ===================== */
function doGet(e) {
  try {
    var q = e.parameter || {}, a = q.a;
    if (a === 'state') {
      var list = rows_(), key = clean_(q.key, 80), mine = key ? counted_(list, key) : [];
      var board = summary_(list).filter(function (p) { return p.best !== null; })
        .sort(function (x, y) { return y.best - x.best; }).slice(0, 10)
        .map(function (p) { return { name: p.name, best: p.best }; });
      return out_({ ok: true, used: mine.length, max: MAXG, games: mine.map(function (x) { return { id: x.id, t: x.t, m: x.m, n: x.n, r: x.r, s: x.s, a: x.a }; }),
        official: official_(), board: board });
    }
    if (a === 'admin') {
      if (!isAdmin_(q.k)) return out_({ ok: false, err: 'kunci admin salah' });
      var ps = summary_(rows_()), cache = CacheService.getScriptCache();
      var live = cache.getAll(ps.map(function (p) { return 'L:' + p.key; }));
      ps.forEach(function (p) { var v = live['L:' + p.key]; p.live = v ? JSON.parse(v) : null; });
      return out_({ ok: true, players: ps, official: official_(), now: Date.now() });
    }
    return out_({ ok: true, app: 'Wumpus World Tel-U' });
  } catch (err) { return out_({ ok: false, err: String(err) }); }
}

/* ===================== POST ===================== */
function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, err: 'body bukan JSON' }); }
  try {
    switch (b.op) {
      case 'start': return out_(start_(b));
      case 'end': return out_(end_(b));
      case 'live': return out_(live_(b));
      case 'reset': return out_(isAdmin_(b.k) ? reset_(b) : { ok: false, err: 'kunci admin salah' });
      case 'setmap': return out_(isAdmin_(b.k) ? setmap_(b) : { ok: false, err: 'kunci admin salah' });
      default: return out_({ ok: false, err: 'aksi tidak dikenal' });
    }
  } catch (err) { return out_({ ok: false, err: String(err) }); }
}

function start_(b) {
  var name = clean_(b.name, 40), nim = clean_(b.nim, 20), mode = b.mode === 'official' ? 'official' : 'random', n = Math.min(8, Math.max(4, +b.n || 5));
  if (name.length < 2) return { ok: false, err: 'nama kosong' };
  var key = keyOf_(nim, name), gid = clean_(b.gid, 40) || Utilities.getUuid();
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var list = rows_(), mine = counted_(list, key);
    if (list.some(function (x) { return x.id === gid; })) return { ok: true, gid: gid, used: mine.length, key: key };
    if (mine.length >= MAXG) return { ok: false, err: 'quota', used: mine.length, key: key };
    sheet_(SH_GAMES).appendRow([new Date(), gid, key, name, nim ? "'" + nim : '', !!b.guest, mode, n, 'playing', '', '', '']);
    return { ok: true, gid: gid, used: mine.length + 1, key: key };
  } finally { lock.releaseLock(); }
}

function end_(b) {
  var gid = clean_(b.gid, 40), r = String(b.r), a = Math.max(0, Math.floor(+b.ac || 0)), s = Math.round(+b.s);
  if (!RESULTS[r]) return { ok: false, err: 'hasil tidak dikenal' };
  if (s !== expected_(r, a)) return { ok: false, err: 'skor tidak cocok dengan aksi' };
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var sh = sheet_(SH_GAMES), f = sh.getRange('B:B').createTextFinder(gid).matchEntireCell(true).findNext();
    if (!f) return { ok: false, err: 'game tidak ditemukan' };
    var row = f.getRow(), st = sh.getRange(row, 9).getValue();
    if (st !== 'playing') return { ok: true, dup: true };
    sh.getRange(row, 9, 1, 4).setValues([[r, s, a, new Date()]]);
    CacheService.getScriptCache().remove('L:' + sh.getRange(row, 3).getValue());
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function live_(b) {
  var key = keyOf_(b.nim, b.name);
  var v = { s: +b.s || 0, a: +b.ac || 0, x: +b.x || 1, y: +b.y || 1, n: +b.n || 5, g: !!b.g, m: b.m === 'official' ? 'official' : 'random', t: Date.now() };
  CacheService.getScriptCache().put('L:' + key, JSON.stringify(v), 900);
  return { ok: true };
}

function reset_(b) {
  var key = clean_(b.key, 80);
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var sh = sheet_(SH_GAMES), n = 0;
    rows_().forEach(function (x) { if (x.key === key && x.r !== 'reset') { sh.getRange(x.row, 9).setValue('reset'); n++; } });
    CacheService.getScriptCache().remove('L:' + key);
    return { ok: true, reset: n };
  } finally { lock.releaseLock(); }
}

function setmap_(b) {
  var m = b.map, val = '';
  if (m) {
    var n = Math.min(8, Math.max(4, +m.n || 5)), ok = function (c) { return Array.isArray(c) && c.length === 2 && c[0] >= 1 && c[1] >= 1 && c[0] <= n && c[1] <= n; };
    if (!ok(m.W) || !ok(m.G) || !Array.isArray(m.P) || !m.P.every(ok) || (m.A && !ok(m.A))) return { ok: false, err: 'peta tidak valid' };
    val = JSON.stringify({ n: n, W: m.W, G: m.G, P: m.P, A: m.A || null });
  }
  var c = sheet_(SH_CONFIG), last = c.getLastRow(), v = last >= 2 ? c.getRange(2, 1, last - 1, 1).getValues() : [];
  for (var i = 0; i < v.length; i++) if (v[i][0] === 'official') { c.getRange(i + 2, 2).setValue(val); return { ok: true }; }
  c.appendRow(['official', val]);
  return { ok: true };
}
