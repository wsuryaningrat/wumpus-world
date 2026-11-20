/**
 * Wumpus World Tel-U — backend Google Apps Script + Google Sheet (v2: sesi berbasis waktu)
 * Developed by WHS (SoC – Telkom University)
 *
 * Alur: dosen membuka lobby → mahasiswa bergabung → dosen menekan Mulai → selama waktu sesi
 * mahasiswa boleh main berapa kali pun; papan skor memakai total skor semua game tiap mahasiswa.
 * Pasang: tempel file ini, jalankan setup() sekali, Deploy sebagai Web app (Execute as: Me, Anyone).
 */
var SH_GAMES = 'Games', SH_REKAP = 'Rekap';
var HEAD = ['Mulai', 'ID game', 'Kunci pemain', 'Nama', 'NIM', 'Guest', 'Mode', 'Ukuran', 'Status', 'Skor', 'Aksi', 'Selesai', 'Sesi'];
var GRACE = 180000;      // game yang sedang berjalan boleh selesai sampai 3 menit setelah waktu habis
var COST = 5;            // biaya setiap aksi
var KILL = 3000;         // bonus setiap Wumpus yang terbunuh
var RESULTS = { win: 1, climb: 1, pit: 1, wumpus: 1, quit: 1 };
var DEFAULTS = { n: 5, pits: 2, wumpus: 1, dur: 5, map: null };

/* ===================== setup (jalankan sekali / setelah update) ===================== */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var g = ss.getSheetByName(SH_GAMES) || ss.insertSheet(SH_GAMES);
  if (g.getLastRow() === 0) g.appendRow(HEAD); else g.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
  g.setFrozenRows(1);
  g.getRange('E:E').setNumberFormat('@');
  var r = ss.getSheetByName(SH_REKAP) || ss.insertSheet(SH_REKAP);
  r.clear();
  r.getRange('A1').setFormula(
    '=QUERY(Games!A:M,"select M, D, E, count(B), max(J), sum(J) where I <> \'playing\' and I <> \'late\' and B is not null ' +
    'group by M, D, E order by M desc, sum(J) desc label M \'Sesi\', D \'Nama\', E \'NIM\', count(B) \'Jumlah game\', max(J) \'Skor terbaik\', sum(J) \'Total skor\'",1)');
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('ADMIN_KEY')) p.setProperty('ADMIN_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 10));
  Logger.log('ADMIN_KEY = ' + p.getProperty('ADMIN_KEY'));
}

/* ===================== util ===================== */
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function sheet_(n) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n); }
function props_() { return PropertiesService.getScriptProperties(); }
function isAdmin_(k) { var a = props_().getProperty('ADMIN_KEY'); return !!a && String(k || '') === a; }
function clean_(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n || 60); }
function keyOf_(nim, name) { nim = clean_(nim, 20); return nim ? 'nim:' + nim : 'g:' + clean_(name, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
function expected_(r, a, k) { return -COST * a + KILL * k + (r === 'win' ? 1000 : (r === 'pit' || r === 'wumpus') ? -1000 : 0); }
function int_(v, lo, hi, d) { v = Math.round(+v); return isNaN(v) ? d : Math.min(hi, Math.max(lo, v)); }

function session_() { try { return JSON.parse(props_().getProperty('SESSION') || 'null'); } catch (e) { return null; } }
function saveSession_(s) { props_().setProperty('SESSION', JSON.stringify(s)); }
function status_(s, now) { if (!s) return 'none'; if (s.status === 'running' && now > s.endsAt + GRACE) return 'ended'; if (s.status === 'running' && now > s.endsAt) return 'grace'; return s.status; }
function pub_(s, now) { if (!s) return null; return { id: s.id, title: s.title, status: status_(s, now), settings: s.settings, startedAt: s.startedAt || null, endsAt: s.endsAt || null }; }
function joined_(sid) { try { return JSON.parse(props_().getProperty('JOIN_' + sid) || '{}'); } catch (e) { return {}; } }

function cleanMap_(m) {
  if (!m) return null;
  var n = int_(m.n, 4, 8, 5), ok = function (c) { return Array.isArray(c) && c.length === 2 && c[0] >= 1 && c[1] >= 1 && c[0] <= n && c[1] <= n && !(c[0] === 1 && c[1] === 1); };
  var W = Array.isArray(m.W) && typeof m.W[0] === 'number' ? [m.W] : m.W;
  if (!Array.isArray(W) || !W.length || W.length > 3 || !W.every(ok) || !ok(m.G) || !Array.isArray(m.P) || !m.P.every(ok) || (m.A && !ok(m.A))) return null;
  return { n: n, W: W, G: m.G, P: m.P, A: m.A || null };
}
function cleanSettings_(st) {
  st = st || {};
  var map = cleanMap_(st.map);
  var n = map ? map.n : int_(st.n, 4, 8, DEFAULTS.n), maxP = Math.floor(n * n * 0.3);
  var pits = map ? map.P.length : int_(st.pits, 0, maxP, DEFAULTS.pits), w = map ? map.W.length : int_(st.wumpus, 1, 3, DEFAULTS.wumpus);
  return { n: n, pits: pits, wumpus: w, dur: int_(st.dur, 1, 120, DEFAULTS.dur), map: map };
}

function rows_() {
  var sh = sheet_(SH_GAMES), n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, 13).getValues().map(function (r, i) {
    return { row: i + 2, t: r[0] instanceof Date ? r[0].getTime() : +r[0] || 0, id: String(r[1]), key: String(r[2]), name: String(r[3]),
      nim: String(r[4]), guest: r[5] === true || r[5] === 'TRUE', n: +r[7] || 5, r: String(r[8]),
      s: r[9] === '' ? null : +r[9], a: r[10] === '' ? null : +r[10], sid: String(r[12] || '') };
  });
}

/** papan skor sesi: total skor semua game per pemain (seri: skor terbaik lebih tinggi, lalu lebih dulu) */
function board_(sid, list) {
  var m = {};
  list.forEach(function (x) {
    if (x.sid !== sid) return;
    var p = m[x.key] || (m[x.key] = { key: x.key, name: x.name, nim: x.nim, guest: x.guest, games: 0, wins: 0, best: null, bestA: null, bestT: null, total: null, last: null, playing: false });
    p.name = x.name;
    if (x.r === 'playing') { p.playing = true; return; }
    if (!RESULTS[x.r]) return;
    p.games++; p.total = (p.total || 0) + x.s; if (x.r === 'win') p.wins++; p.last = { r: x.r, s: x.s, t: x.t };
    if (p.best === null || x.s > p.best || (x.s === p.best && x.a < p.bestA)) { p.best = x.s; p.bestA = x.a; p.bestT = x.t; }
  });
  return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) {
    if (a.total === null && b.total === null) return 0; if (a.total === null) return 1; if (b.total === null) return -1;
    return b.total - a.total || b.best - a.best || a.bestT - b.bestT;
  });
}
function cachedBoard_(sid) {
  var c = CacheService.getScriptCache(), k = 'B:' + sid, v = c.get(k);
  if (v) return JSON.parse(v);
  var b = board_(sid, rows_());
  c.put(k, JSON.stringify(b), 5);
  return b;
}
function bust_(sid) { CacheService.getScriptCache().remove('B:' + sid); }

/* ===================== GET ===================== */
function doGet(e) {
  try {
    var q = e.parameter || {}, a = q.a, now = Date.now(), s = session_();
    if (a === 'session') {
      var j = s ? joined_(s.id) : {};
      return out_({ ok: true, now: now, session: pub_(s, now), joined: Object.keys(j).map(function (k) { return j[k].name; }) });
    }
    if (a === 'board') {
      var sid = clean_(q.ses || q.sid, 40) || (s && s.id);
      if (!sid) return out_({ ok: true, now: now, board: [] });
      var b = cachedBoard_(sid).map(function (p) { return { key: p.key, name: p.name, best: p.best, total: p.total, games: p.games, wins: p.wins }; });
      return out_({ ok: true, now: now, sid: sid, board: b });
    }
    if (a === 'admin') {
      if (!isAdmin_(q.k)) return out_({ ok: false, err: 'kunci admin salah' });
      var players = s ? board_(s.id, rows_()) : [], joined = s ? joined_(s.id) : {};
      Object.keys(joined).forEach(function (k) { if (!players.some(function (p) { return p.key === k; })) players.push({ key: k, name: joined[k].name, nim: joined[k].nim, guest: joined[k].guest, games: 0, wins: 0, best: null, total: null, playing: false, last: null }); });
      if (s) {
        var live = CacheService.getScriptCache().getAll(players.map(function (p) { return 'L:' + s.id + ':' + p.key; }));
        players.forEach(function (p) { var v = live['L:' + s.id + ':' + p.key]; p.live = v ? JSON.parse(v) : null; });
      }
      return out_({ ok: true, now: now, session: pub_(s, now), players: players, joinedCount: Object.keys(joined).length });
    }
    return out_({ ok: true, app: 'Wumpus World Tel-U', now: now });
  } catch (err) { return out_({ ok: false, err: String(err) }); }
}

/* ===================== POST ===================== */
function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, err: 'body bukan JSON' }); }
  try {
    if (/^(open|begin|extend|stop|close|delplayer|delgame|clear)$/.test(b.op) && !isAdmin_(b.k)) return out_({ ok: false, err: 'kunci admin salah' });
    switch (b.op) {
      case 'join': return out_(join_(b));
      case 'start': return out_(start_(b));
      case 'end': return out_(end_(b));
      case 'live': return out_(live_(b));
      case 'open': return out_(open_(b));
      case 'begin': return out_(begin_());
      case 'extend': return out_(extend_(b));
      case 'stop': return out_(stop_());
      case 'close': props_().deleteProperty('SESSION'); return out_({ ok: true });
      case 'delplayer': unjoin_(clean_(b.key, 80)); return out_(delete_(function (x, sid) { return x.sid === sid && x.key === clean_(b.key, 80); }, b.sid));
      case 'delgame': return out_(delete_(function (x) { return x.id === clean_(b.gid, 40); }, b.sid));
      case 'clear': return out_(delete_(function (x, sid) { return x.sid === sid; }, b.sid));
      default: return out_({ ok: false, err: 'aksi tidak dikenal' });
    }
  } catch (err) { return out_({ ok: false, err: String(err) }); }
}

function lock_(fn) { var l = LockService.getScriptLock(); l.waitLock(20000); try { return fn(); } finally { l.releaseLock(); } }

function join_(b) {
  var s = session_(), now = Date.now(), st = status_(s, now);
  if (st !== 'lobby' && st !== 'running') return { ok: false, err: 'sesi belum dibuka' };
  var name = clean_(b.name, 40), nim = clean_(b.nim, 20);
  if (name.length < 2) return { ok: false, err: 'nama kosong' };
  var key = keyOf_(nim, name);
  return lock_(function () {
    var j = joined_(s.id);
    j[key] = { name: name, nim: nim, guest: !!b.guest, t: now };
    props_().setProperty('JOIN_' + s.id, JSON.stringify(j));
    return { ok: true, key: key, sid: s.id };
  });
}

function start_(b) {
  var s = session_(), now = Date.now();
  if (status_(s, now) !== 'running') return { ok: false, err: 'sesi tidak berjalan' };
  var name = clean_(b.name, 40), nim = clean_(b.nim, 20);
  if (name.length < 2) return { ok: false, err: 'nama kosong' };
  var key = keyOf_(nim, name), gid = clean_(b.gid, 40) || Utilities.getUuid();
  return lock_(function () {
    var j = joined_(s.id);
    if (!j[key]) { j[key] = { name: name, nim: nim, guest: !!b.guest, t: now }; props_().setProperty('JOIN_' + s.id, JSON.stringify(j)); }
    var f = sheet_(SH_GAMES).getRange('B:B').createTextFinder(gid).matchEntireCell(true).findNext();
    if (!f) sheet_(SH_GAMES).appendRow([new Date(), gid, key, name, nim ? "'" + nim : '', !!b.guest, 'sesi', int_(b.n, 4, 8, 5), 'playing', '', '', '', s.id]);
    bust_(s.id);
    return { ok: true, gid: gid, key: key, sid: s.id };
  });
}

function end_(b) {
  var gid = clean_(b.gid, 40), r = String(b.r), a = Math.max(0, Math.floor(+b.ac || 0)), sc = Math.round(+b.s), k = Math.min(3, Math.max(0, Math.floor(+b.kl || 0)));
  if (!RESULTS[r]) return { ok: false, err: 'hasil tidak dikenal' };
  if (sc !== expected_(r, a, k) || k > a) return { ok: false, err: 'skor tidak cocok dengan aksi' };
  var s = session_(), now = Date.now();
  return lock_(function () {
    var sh = sheet_(SH_GAMES), f = sh.getRange('B:B').createTextFinder(gid).matchEntireCell(true).findNext();
    if (!f) return { ok: false, err: 'game tidak ditemukan' };
    var row = f.getRow(), vals = sh.getRange(row, 1, 1, 13).getValues()[0];
    if (vals[8] !== 'playing') return { ok: true, dup: true };
    var late = !s || String(vals[12]) !== s.id || (s.endsAt && now > s.endsAt + GRACE);
    sh.getRange(row, 9, 1, 4).setValues([[late ? 'late' : r, sc, a, new Date()]]);
    CacheService.getScriptCache().remove('L:' + vals[12] + ':' + vals[2]);
    bust_(String(vals[12]));
    return { ok: true, late: late };
  });
}

function live_(b) {
  var s = session_(); if (!s) return { ok: false };
  var key = keyOf_(b.nim, b.name);
  var v = { s: +b.s || 0, a: +b.ac || 0, x: +b.x || 1, y: +b.y || 1, n: +b.n || 5, g: !!b.g, ar: !!b.ar, t: Date.now() };
  CacheService.getScriptCache().put('L:' + s.id + ':' + key, JSON.stringify(v), 600);
  return { ok: true };
}

function open_(b) {
  var s = session_(), now = Date.now(), st = status_(s, now);
  var settings = cleanSettings_(b.settings), title = clean_(b.title, 60) || 'Sesi Wumpus World';
  if (b.map && !settings.map) return { ok: false, err: 'peta tetap tidak valid' };
  if (s && st === 'lobby') { s.settings = settings; s.title = title; saveSession_(s); return { ok: true, session: pub_(s, now) }; }
  if (s && (st === 'running' || st === 'grace')) return { ok: false, err: 'sesi masih berjalan; akhiri dulu' };
  var id = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Jakarta', 'yyyyMMdd-HHmm') + '-' + Utilities.getUuid().slice(0, 4);
  s = { id: id, title: title, status: 'lobby', settings: settings, createdAt: now };
  saveSession_(s);
  return { ok: true, session: pub_(s, now) };
}
function begin_() {
  var s = session_(), now = Date.now();
  if (!s || s.status !== 'lobby') return { ok: false, err: 'buka lobby dulu' };
  s.status = 'running'; s.startedAt = now; s.endsAt = now + s.settings.dur * 60000; saveSession_(s);
  return { ok: true, session: pub_(s, now) };
}
function extend_(b) {
  var s = session_(), now = Date.now(), st = status_(s, now);
  if (st !== 'running' && st !== 'grace') return { ok: false, err: 'sesi tidak berjalan' };
  s.endsAt = Math.max(s.endsAt, now) + int_(b.min, 1, 30, 1) * 60000; saveSession_(s);
  return { ok: true, session: pub_(s, now) };
}
function stop_() {
  var s = session_(), now = Date.now();
  if (!s) return { ok: false, err: 'tidak ada sesi' };
  s.status = 'running'; s.endsAt = Math.min(s.endsAt || now, now) - GRACE - 1; // langsung selesai
  saveSession_(s);
  return { ok: true, session: pub_(s, now) };
}
function unjoin_(key) {
  var s = session_(); if (!s) return;
  lock_(function () { var j = joined_(s.id); delete j[key]; props_().setProperty('JOIN_' + s.id, JSON.stringify(j)); });
}
function delete_(match, sidArg) {
  var s = session_(), sid = clean_(sidArg, 40) || (s && s.id);
  return lock_(function () {
    var sh = sheet_(SH_GAMES), list = rows_().filter(function (x) { return match(x, sid); }).map(function (x) { return x.row; }).sort(function (a, b) { return b - a; });
    list.forEach(function (row) { sh.deleteRow(row); });
    if (sid) bust_(sid);
    return { ok: true, deleted: list.length };
  });
}
