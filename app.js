'use strict';
// ============================================================
//  Raid Roster – din egen raid-planlægger
//
//  Opbygning af filen:
//   1. Spildata (klasser, specs, roller, farver)
//   2. Standard-indstillinger
//   3. Hjælpefunktioner (datoer, gem/hent)
//   4. Raid-Helper import
//   5. Roster-logik (auto-fyld, buffs, fremmøde)
//   6. Visninger (Uge, Spillere, Fremmøde, Log, Indstillinger)
//   7. Klik- og ændrings-handlinger
//
//  Alle data gemmes i browserens localStorage under nøglen STORE_KEY.
//  Tag jævnligt backup under Indstillinger → "Download backup".
// ============================================================


// ---------- 1. Spildata ----------
// Klasse → { spec: rolle }. Tilføj/ret specs her hvis jeres server har andre.
const CLASSES = {
  Warrior: { Arms: 'Melee', Fury: 'Melee', Protection: 'Tank' },
  Paladin: { Holy: 'Healer', Protection: 'Tank', Retribution: 'Melee' },
  Druid:   { Balance: 'Ranged', Feral: 'Melee', Guardian: 'Tank', Restoration: 'Healer', Dreamstate: 'Healer' },
  Rogue:   { Assassination: 'Melee', Combat: 'Melee', Subtlety: 'Melee' },
  Hunter:  { Beastmastery: 'Ranged', Marksmanship: 'Ranged', Survival: 'Ranged' },
  Priest:  { Discipline: 'Healer', Holy: 'Healer', Shadow: 'Ranged', Smite: 'Ranged' },
  Mage:    { Arcane: 'Ranged', Fire: 'Ranged', Frost: 'Ranged' },
  Warlock: { Affliction: 'Ranged', Demonology: 'Ranged', Destruction: 'Ranged' },
  Shaman:  { Elemental: 'Ranged', Enhancement: 'Melee', Restoration: 'Healer' },
};
// Klassefarver (som i spillet)
const CLASS_COLOR = {
  Warrior: '#C69B6D', Paladin: '#F48CBA', Druid: '#FF7C0A', Rogue: '#FFF468', Hunter: '#AAD372',
  Priest: '#D9D9D9', Mage: '#3FC7EB', Warlock: '#8788EE', Shaman: '#0070DD',
};
const ROLES = ['Tank', 'Healer', 'Melee', 'Ranged'];
const ROLE_DA = { Tank: 'Tanks', Healer: 'Healers', Melee: 'Melee', Ranged: 'Ranged' };
const SPEC_SHORT = {
  Protection: 'Prot', Retribution: 'Ret', Restoration: 'Resto', Enhancement: 'Enh', Elemental: 'Ele',
  Beastmastery: 'BM', Marksmanship: 'MM', Survival: 'Surv', Affliction: 'Affli', Demonology: 'Demo',
  Destruction: 'Destro', Assassination: 'Assa', Subtlety: 'Sub', Discipline: 'Disc', Balance: 'Boomkin',
  Guardian: 'Bear', Dreamstate: 'Dream',
};
// Raid-Helper skriver nogle gange "Tank" som klasse, så spec'en må afgøre klassen.
// Specs som to klasser deler har et "1" på den anden (Holy1 = Paladin).
const SPEC_CLASS = { Protection: 'Warrior', Protection1: 'Paladin', Holy: 'Priest', Holy1: 'Paladin', Restoration: 'Druid', Restoration1: 'Shaman' };
for (const [c, specs] of Object.entries(CLASSES)) for (const s of Object.keys(specs)) if (!(s in SPEC_CLASS)) SPEC_CLASS[s] = c;

// Tilmeldings-status fra Raid-Helper. "score" bruges af auto-fyld.
const STATUS = {
  yes:       { label: 'Tilmeldt',    score: 100 },
  late:      { label: 'Kommer sent', score: 60 },
  tentative: { label: 'Måske',       score: 40 },
  bench:     { label: 'Vil gerne på bænk', score: 10 },
  absence:   { label: 'Afbud',       score: -1 },
};
const STATUS_ORDER = ['yes', 'late', 'tentative', 'bench', 'absence'];
const DAYS = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];


// ---------- 2. Standard-indstillinger ----------
const DEFAULT_SETTINGS = {
  teamName: 'Min guild',
  resetDay: 3, // 3 = onsdag (EU reset). Raid-ugen løber fra reset-dag til dagen før næste reset.
  // Raid-skabeloner. "lockout": raids med samme lockout kan en spiller kun være i én af pr. uge.
  raids: [
    { id: 't20',  name: '20-man',   size: 20, tanks: 2, healers: 4, day: 3, lockout: '20' },
    { id: 't10a', name: '10-man A', size: 10, tanks: 2, healers: 2, day: 0, lockout: '10' },
    { id: 't10b', name: '10-man B', size: 10, tanks: 2, healers: 2, day: 0, lockout: '10' },
  ],
  // Buffs der tjekkes på hvert roster. specs: tom = alle specs tæller.
  buffs: [
    { label: 'Kings / Salvation',      cls: 'Paladin', specs: [], min: 1 },
    { label: '2. Paladin',             cls: 'Paladin', specs: [], min: 2 },
    { label: 'Windfury Totem',         cls: 'Shaman',  specs: [], min: 1 },
    { label: 'Fortitude',              cls: 'Priest',  specs: [], min: 1 },
    { label: 'Arcane Intellect',       cls: 'Mage',    specs: [], min: 1 },
    { label: 'Curse of the Elements',  cls: 'Warlock', specs: [], min: 1 },
    { label: 'Battle Shout',           cls: 'Warrior', specs: [], min: 1 },
    { label: 'Moonkin / LotP',         cls: 'Druid',   specs: ['Balance', 'Feral', 'Guardian'], min: 1 },
  ],
  benchBonus: 30,   // auto-fyld: ekstra point pr. gang spilleren har siddet på bænk de sidste 4 uger
  prioBonus: 50,    // auto-fyld: ekstra point til spillere markeret "Prio"
};


// ---------- 3. Hjælpefunktioner ----------
const STORE_KEY = 'raidroster.v1';
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);

// Datoer gemmes som tekst "ÅÅÅÅ-MM-DD"
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (s, n) => { const d = parseIso(s); d.setDate(d.getDate() + n); return isoDate(d); };
const today = () => isoDate(new Date());
const fmtDay = s => parseIso(s).toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtShort = s => parseIso(s).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });
// Ugens id = datoen for reset-dagen der starter raid-ugen
function resetOf(s) {
  const d = parseIso(s);
  d.setDate(d.getDate() - ((d.getDay() - S.settings.resetDay + 7) % 7));
  return isoDate(d);
}
function isoWeek(s) {
  const d = parseIso(s);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(d.getFullYear(), 0, 4, 12);
  return 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}
const weekLabel = wid => `Uge ${isoWeek(wid)}`;
const weekSpan = wid => `${fmtShort(wid)} – ${fmtShort(addDays(wid, 6))}`;

const roleOf = (c, s) => (CLASSES[c] && CLASSES[c][s]) || 'Ranged';
const shortSpec = s => SPEC_SHORT[s] || s;
const clsColor = c => CLASS_COLOR[c] || 'var(--line)';
const capFirst = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const nameKey = n => String(n || '').trim().toLowerCase().replace(/[\s-]+/g, '-');

// Discord-navne som "Jonas | Karakternavn" → "Karakternavn"
function guessChar(name) {
  const clean = String(name || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = clean.split(/\s+-\s+|\s*[\/\\|]+\s*/).map(x => x.trim()).filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : clean;
  return last.split(' ').filter(Boolean).map(capFirst).join(' ') || clean;
}

// --- Gem og hent ---
function normalize(s) {
  s = s || {};
  return {
    settings: { ...clone(DEFAULT_SETTINGS), ...(s.settings || {}) },
    players: s.players || {},
    weeks: s.weeks || {},
    log: s.log || [],
  };
}
function loadState() {
  try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function saveNow() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { toast('Kunne ikke gemme: ' + e.message); }
}
let saveTimer;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 150); }
window.addEventListener('beforeunload', saveNow);

// Hele appens data
let S = normalize(loadState());
// Midlertidig tilstand for skærmen (gemmes ikke)
const UI = { tab: location.hash.slice(1) || 'week', weekId: resetOf(today()), imp: null, playerFilter: '' };

function log(text) {
  S.log.unshift({ t: Date.now(), text });
  if (S.log.length > 500) S.log.length = 500;
}
// Gem + log + tegn siden igen
function commit(text) { if (text) log(text); save(); render(); }

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}


// ---------- 4. Raid-Helper import ----------
// Læser JSON fra Raid-Helper (https://raid-helper.dev/api/v2/events/<id>)
function parseRaidHelper(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { throw new Error('Det er ikke gyldig JSON. Åbn data-linket, markér alt (Ctrl+A), kopiér og indsæt igen.'); }
  const list = obj.signUps || obj.signups;
  if (!Array.isArray(list)) throw new Error('Fandt ingen tilmeldinger. Sørg for at kopiere data-linket (api/v2/events/…), ikke den almindelige event-side.');

  let date = null;
  const ts = obj.startTime || obj.unixtime;
  if (ts) date = isoDate(new Date(ts * 1000));
  else if (typeof obj.date === 'string' && /^\d{2}-\d{2}-\d{4}$/.test(obj.date)) { const [d, m, y] = obj.date.split('-'); date = `${y}-${m}-${d}`; }

  const people = {};
  for (const x of list) {
    const pid = String(x.userId ?? x.userid ?? '');
    if (!pid) continue;
    let cls = String(x.className ?? x.class ?? '');
    const rawSpec = String(x.specName ?? x.spec ?? '');
    let st = 'yes';
    const lc = cls.toLowerCase();
    if (['late', 'bench', 'tentative', 'absence'].includes(lc)) st = lc;
    if (!CLASSES[cls]) cls = SPEC_CLASS[rawSpec] || '';
    const opts = [];
    if (cls) {
      const s = rawSpec.replace(/1$/, '');
      if (CLASSES[cls][s]) opts.push({ c: cls, s });
    }
    const t = Number(x.entryTime ?? x.signuptime ?? 0) || 0;
    const prev = people[pid];
    if (!prev) { people[pid] = { p: pid, n: String(x.name || ''), st, opts, t }; continue; }
    // Samme person tilmeldt flere gange (fx main + offspec): slå sammen
    for (const o of opts) if (!prev.opts.some(q => q.c === o.c && q.s === o.s)) prev.opts.push(o);
    if (STATUS_ORDER.indexOf(st) < STATUS_ORDER.indexOf(prev.st)) prev.st = st;
    if (t && (!prev.t || t < prev.t)) prev.t = t;
  }
  return {
    id: String(obj.id || obj.raidId || ''),
    title: obj.title || obj.displayTitle || 'Raid-Helper event',
    date: date || today(),
    signups: Object.values(people),
  };
}

// Hent event direkte fra Raid-Helper (virker hvis Raid-Helper tillader det fra browseren)
async function fetchEvent(input) {
  const t = input.trim();
  if (t.startsWith('{')) return t;
  const m = t.match(/(\d{15,21})/);
  if (!m) throw new Error('Kunne ikke finde et event-ID. Indsæt event-linket, ID’et eller JSON-data.');
  const url = `https://raid-helper.dev/api/v2/events/${m[1]}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } catch (err) {
    const e = new Error('Kunne ikke hente eventet direkte. Åbn linket herunder, markér alt (Ctrl+A), kopiér og indsæt teksten i feltet.');
    e.url = url;
    throw e;
  }
}

// Opret/opdater spillere ud fra tilmeldingerne
function ensurePlayers(signups) {
  for (const su of signups) {
    if (S.players[su.p]) { S.players[su.p].discord = su.n; continue; }
    const name = guessChar(su.n);
    // Fandtes spilleren allerede som manuelt oprettet med samme navn? Så flyt over på Discord-ID'et.
    const manual = Object.values(S.players).find(p => p.id.startsWith('m_') && nameKey(p.name) === nameKey(name));
    if (manual) { rekeyPlayer(manual.id, su.p); S.players[su.p].discord = su.n; continue; }
    const o = su.opts[0] || {};
    S.players[su.p] = { id: su.p, name, discord: su.n, cls: o.c || '', spec: o.s || '', note: '', prio: false, active: true };
  }
}
function rekeyPlayer(oldId, newId) {
  const p = S.players[oldId];
  delete S.players[oldId];
  S.players[newId] = { ...p, id: newId };
  for (const w of Object.values(S.weeks)) for (const r of w.raids) {
    for (const e of r.roster) if (e.p === oldId) e.p = newId;
    for (const su of r.signups) if (su.p === oldId) su.p = newId;
  }
}


// ---------- 5. Roster-logik ----------
function getWeek(wid, create) {
  if (!S.weeks[wid] && create) S.weeks[wid] = { raids: [] };
  return S.weeks[wid] || null;
}
function findRaid(id) {
  for (const [wid, w] of Object.entries(S.weeks)) {
    const r = w.raids.find(x => x.id === id);
    if (r) return { wid, w, r };
  }
  return null;
}
function newRaid(tpl, date) {
  return {
    id: uid(), tpl: tpl.id, name: tpl.name, size: +tpl.size, tanks: +tpl.tanks, healers: +tpl.healers,
    lockout: tpl.lockout || tpl.id, date, eventId: '', eventTitle: '', signups: [], roster: [], done: false,
  };
}
function tplDate(wid, tpl) { return addDays(wid, (tpl.day - S.settings.resetDay + 7) % 7); }

const pName = pid => (S.players[pid] && S.players[pid].name) || '?';
const signupOf = (r, pid) => r.signups.find(x => x.p === pid);

// Hvilke klasse/spec-muligheder har spilleren i dette raid?
function optsFor(r, pid) {
  const su = signupOf(r, pid);
  if (su && su.opts.length) return su.opts;
  const p = S.players[pid];
  return p && p.cls && p.spec ? [{ c: p.cls, s: p.spec }] : [];
}
// Er spilleren allerede sat i et andet raid med samme lockout denne uge?
function lockedElsewhere(wid, r, pid) {
  const o = S.weeks[wid].raids.find(x => x !== r && x.lockout === r.lockout && x.roster.some(e => e.p === pid));
  return o ? o.name : null;
}
function roleCounts(r) {
  const c = { Tank: 0, Healer: 0, Melee: 0, Ranged: 0 };
  for (const e of r.roster) c[roleOf(e.c, e.s)]++;
  return c;
}
const buffMatch = (b, c, s) => c === b.cls && (!b.specs.length || b.specs.includes(s));
function buffStatus(r) {
  return S.settings.buffs.map(b => {
    const n = r.roster.filter(e => buffMatch(b, e.c, e.s)).length;
    return { ...b, n, ok: n >= b.min };
  });
}

// Fremmøde: hver (uge, lockout) er én "raid-aften". For hver spiller: raid / bænk / afbud.
function computeAttendance() {
  const units = [];
  const now = today();
  for (const wid of Object.keys(S.weeks).sort()) {
    const groups = {};
    for (const r of S.weeks[wid].raids) {
      if (!(r.done || r.date < now)) continue;          // kun raids der er overstået / markeret færdige
      if (!r.signups.length && !r.roster.length) continue;
      (groups[r.lockout] = groups[r.lockout] || []).push(r);
    }
    for (const [lo, rs] of Object.entries(groups)) {
      const out = {};
      for (const r of rs) for (const su of r.signups) {
        const v = su.st === 'absence' ? 'absence' : 'bench';
        if (!out[su.p] || (out[su.p] === 'absence' && v === 'bench')) out[su.p] = v;
      }
      for (const r of rs) for (const e of r.roster) out[e.p] = 'raid';
      units.push({ wid, lockout: lo, name: rs.map(r => r.name).join(' / '), date: rs.map(r => r.date).sort()[0], out });
    }
  }
  units.sort((a, b) => a.date.localeCompare(b.date));
  return units;
}
function playerStats(units) {
  const st = {};
  for (const pid of Object.keys(S.players)) st[pid] = { raid: 0, bench: 0, absence: 0, none: 0, seen: false };
  for (const u of units) for (const pid of Object.keys(st)) {
    const o = u.out[pid];
    if (o) { st[pid].seen = true; st[pid][o]++; }
    else if (st[pid].seen && S.players[pid].active !== false) st[pid].none++; // ikke tilmeldt
  }
  for (const s of Object.values(st)) {
    s.total = s.raid + s.bench + s.absence + s.none;
    // Fremmøde = raidet eller stod klar på bænken
    s.pct = s.total ? Math.round(100 * (s.raid + s.bench) / s.total) : null;
  }
  return st;
}

// Auto-fyld: beholder dem du selv har sat ind, og fylder resten op.
// 1) tanks, 2) healers, 3) DPS – med point for status, prio, bænk-tid, manglende buffs og variation.
function autofill(wid, r) {
  const from = addDays(wid, -28);
  const recent = computeAttendance().filter(u => u.wid < wid && u.wid >= from);
  const benchCount = pid => recent.filter(u => u.out[pid] === 'bench').length;

  const roster = r.roster.slice();
  const taken = new Set(roster.map(e => e.p));
  const cands = r.signups
    .filter(su => su.st !== 'absence' && !taken.has(su.p) && !lockedElsewhere(wid, r, su.p)
      && (!S.players[su.p] || S.players[su.p].active !== false) && optsFor(r, su.p).length)
    .map(su => ({
      su,
      base: STATUS[su.st].score + (S.players[su.p] && S.players[su.p].prio ? S.settings.prioBonus : 0)
        + benchCount(su.p) * S.settings.benchBonus,
    }));
  cands.sort((a, b) => b.base - a.base || (a.su.t || Infinity) - (b.su.t || Infinity)); // tidligst tilmeldt vinder

  const count = role => roster.filter(e => roleOf(e.c, e.s) === role).length;
  const need = { Tank: r.tanks, Healer: r.healers };
  const pick = (c, o) => { roster.push({ p: c.su.p, c: o.c, s: o.s }); cands.splice(cands.indexOf(c), 1); };

  for (const role of ['Tank', 'Healer']) {
    while (count(role) < need[role] && roster.length < r.size) {
      const c = cands.find(c => optsFor(r, c.su.p).some(o => roleOf(o.c, o.s) === role));
      if (!c) break;
      pick(c, optsFor(r, c.su.p).find(o => roleOf(o.c, o.s) === role));
    }
  }
  while (roster.length < r.size && cands.length) {
    let best = null, bestOpt = null, bestScore = -Infinity;
    for (const c of cands) {
      optsFor(r, c.su.p).forEach((o, i) => {
        const role = roleOf(o.c, o.s);
        if (need[role] !== undefined && count(role) >= need[role]) return; // ingen ekstra tanks/healers
        let sc = c.base - i * 20;                                          // main spec foretrækkes
        sc -= roster.filter(e => e.c === o.c && e.s === o.s).length * 15;  // variation
        for (const b of S.settings.buffs) {
          if (buffMatch(b, o.c, o.s) && roster.filter(e => buffMatch(b, e.c, e.s)).length < b.min) sc += 40;
        }
        if (sc > bestScore) { bestScore = sc; best = c; bestOpt = o; }
      });
    }
    if (!best) break;
    pick(best, bestOpt);
  }
  r.roster = roster;
}

// Tekst til Discord
function rosterText(wid, r) {
  const lines = [`**${r.name} – ${fmtDay(r.date)}**`];
  for (const role of ROLES) {
    const list = r.roster.filter(e => roleOf(e.c, e.s) === role).map(e => `${pName(e.p)} (${shortSpec(e.s)})`);
    if (list.length) lines.push(`${ROLE_DA[role]}: ${list.join(', ')}`);
  }
  const bench = benchList(wid, r).map(su => pName(su.p));
  if (bench.length) lines.push(`Bænk: ${bench.join(', ')}`);
  return lines.join('\n');
}
// Tilmeldte der ikke er sat i noget raid med samme lockout
function benchList(wid, r) {
  return r.signups.filter(su => su.st !== 'absence' && !r.roster.some(e => e.p === su.p) && !lockedElsewhere(wid, r, su.p));
}


// ---------- 6. Visninger ----------
function render() {
  $('team-name').textContent = S.settings.teamName || 'Raid Roster';
  document.title = (S.settings.teamName || 'Raid') + ' Roster';
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b.dataset.tab === UI.tab);
  const views = { week: viewWeek, players: viewPlayers, attendance: viewAttendance, log: viewLog, settings: viewSettings };
  $('view').innerHTML = (views[UI.tab] || viewWeek)();
  renderDialog();
}

// ----- Uge -----
function viewWeek() {
  const wid = UI.weekId;
  const w = S.weeks[wid];
  const raids = w ? w.raids.slice().sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)) : [];
  const weeksWithData = Object.keys(S.weeks).filter(k => S.weeks[k].raids.length).sort().reverse();
  return `
  <div class="row week-head">
    <button class="btn" data-act="weekNav" data-d="-7">◀</button>
    <div class="week-title"><h2>${weekLabel(wid)}</h2><span class="span">${weekSpan(wid)}</span></div>
    <button class="btn" data-act="weekNav" data-d="7">▶</button>
    <button class="btn" data-act="weekToday">Denne uge</button>
    ${weeksWithData.length ? `<select data-chg="weekPick"><option value="">Gå til uge…</option>${weeksWithData.map(k => `<option value="${k}">${weekLabel(k)} (${weekSpan(k)})</option>`).join('')}</select>` : ''}
    <span class="spacer"></span>
    <button class="btn primary" data-act="openImport">⇩ Importér fra Raid-Helper</button>
    <select data-chg="addRaid"><option value="">＋ Tilføj raid…</option>${S.settings.raids.map(t => `<option value="${t.id}">${esc(t.name)} (${DAYS[t.day]})</option>`).join('')}</select>
  </div>
  ${raids.length ? raids.map(r => raidCard(wid, r)).join('') : `
    <div class="card empty">
      <p><b>Ingen raids i denne uge endnu.</b></p>
      <p>Klik <b>Importér fra Raid-Helper</b> for at hente tilmeldingerne fra et event,<br>eller <b>Tilføj raid</b> for at lave et tomt raid.</p>
    </div>`}`;
}

function chip(pid, c, s, inner, extraCls = '') {
  return `<div class="chip ${extraCls}" style="--cls:${clsColor(c)}" title="${esc(c ? c + ' – ' + s : '')}">${inner}</div>`;
}

function raidCard(wid, r) {
  const counts = roleCounts(r);
  const full = r.roster.length;
  const sizeCls = full === r.size ? 'ok' : full > r.size ? 'bad' : 'warn';
  const roleBadge = (role, need) => {
    const n = counts[role];
    const cls = need === undefined ? '' : n === need ? 'ok' : n < need ? 'warn' : 'bad';
    return `<span class="badge ${cls}">${ROLE_DA[role]} ${n}${need !== undefined ? '/' + need : ''}</span>`;
  };

  // Roster-kolonnen, delt op efter rolle
  const rosterHtml = ROLES.map(role => {
    const list = r.roster.map((e, i) => ({ ...e, i })).filter(e => roleOf(e.c, e.s) === role)
      .sort((a, b) => a.c.localeCompare(b.c) || pName(a.p).localeCompare(pName(b.p)));
    if (!list.length) return '';
    return `<div class="role-group"><h4>${ROLE_DA[role]} (${list.length})</h4><div class="cols-2">${list.map(e => {
      const su = signupOf(r, e.p);
      const opts = optsFor(r, e.p);
      let flag = '';
      if (r.signups.length && !su) flag = '<span class="tag bad">ikke tilmeldt</span>';
      else if (su && su.st === 'absence') flag = '<span class="tag bad">afbud</span>';
      else if (su && su.st !== 'yes') flag = `<span class="tag">${STATUS[su.st].label.toLowerCase()}</span>`;
      const specSel = opts.length > 1
        ? `<select data-chg="rosterSpec" data-raid="${r.id}" data-i="${e.i}">${opts.map((o, k) => `<option value="${k}" ${o.c === e.c && o.s === e.s ? 'selected' : ''}>${shortSpec(o.s)}</option>`).join('')}</select>`
        : `<span class="spec">${esc(shortSpec(e.s))}</span>`;
      return chip(e.p, e.c, e.s, `<span class="name">${esc(pName(e.p))}</span>${flag}${specSel}<button class="x" data-act="unassign" data-raid="${r.id}" data-i="${e.i}" title="Fjern">✕</button>`, flag.includes('bad') ? 'flag' : '');
    }).join('')}</div></div>`;
  }).join('') || '<p class="muted small">Ingen sat ind endnu. Klik på en spec i listen til højre, eller brug Auto-fyld.</p>';

  // Tilmeldings-kolonnen (dem der ikke er sat ind)
  const inRoster = new Set(r.roster.map(e => e.p));
  const groups = STATUS_ORDER.map(st => {
    const list = r.signups.filter(su => su.st === st && !inRoster.has(su.p))
      .sort((a, b) => (a.t || 0) - (b.t || 0));
    if (!list.length) return '';
    return `<div class="role-group"><h4>${STATUS[st].label} (${list.length})</h4>${list.map(su => {
      const other = lockedElsewhere(wid, r, su.p);
      const p = S.players[su.p];
      const opts = optsFor(r, su.p);
      const o0 = opts[0] || {};
      const btns = opts.map((o, k) => `<button class="opt" data-act="assign" data-raid="${r.id}" data-p="${esc(su.p)}" data-k="${k}" ${other ? 'disabled' : ''} title="Sæt ind som ${esc(o.s)} ${esc(o.c)}">＋ ${esc(shortSpec(o.s))}</button>`).join('');
      const tags = (p && p.prio ? '<span class="tag prio">prio</span>' : '') + (other ? `<span class="tag">i ${esc(other)}</span>` : '');
      return chip(su.p, o0.c, o0.s, `<span class="name">${esc(pName(su.p))}</span>${tags}${btns}`, other ? 'blocked' : '');
    }).join('')}</div>`;
  }).join('');

  const notSigned = Object.values(S.players)
    .filter(p => p.active !== false && !inRoster.has(p.id) && !signupOf(r, p.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const buffs = buffStatus(r).map(b => `<span class="buff ${b.ok ? 'ok' : 'bad'}">${b.ok ? '✓' : '✗'} ${esc(b.label)}</span>`).join('');

  return `
  <section class="card raid ${r.done ? 'done' : ''}">
    <div class="raid-head">
      <input class="raid-name" type="text" value="${esc(r.name)}" data-chg="raidName" data-raid="${r.id}">
      <input type="date" value="${r.date}" data-chg="raidDate" data-raid="${r.id}">
      <span class="badge ${sizeCls}">${full}/${r.size}</span>
      ${roleBadge('Tank', r.tanks)}${roleBadge('Healer', r.healers)}${roleBadge('Melee')}${roleBadge('Ranged')}
      ${r.eventTitle ? `<span class="muted small" title="Raid-Helper event">📋 ${esc(r.eventTitle)}</span>` : ''}
      <span class="spacer"></span>
      <button class="btn small" data-act="autofill" data-raid="${r.id}" title="Fyld op ud fra tilmeldinger">✨ Auto-fyld</button>
      <button class="btn small" data-act="copy" data-raid="${r.id}">Kopiér til Discord</button>
      <button class="btn small" data-act="clear" data-raid="${r.id}">Ryd</button>
      <button class="btn small" data-act="toggleDone" data-raid="${r.id}" title="Færdige raids tæller med i fremmøde">${r.done ? '✓ Færdig' : 'Markér færdig'}</button>
      <button class="btn small danger" data-act="deleteRaid" data-raid="${r.id}">Slet</button>
    </div>
    <div class="raid-body">
      <div class="pane">
        <h4 style="margin-bottom:10px">Roster</h4>
        ${rosterHtml}
        <div class="buffs">${buffs}</div>
      </div>
      <div class="pane">
        <div class="row" style="margin-bottom:10px">
          <h4 style="margin:0">Tilmeldinger</h4><span class="spacer"></span>
          ${notSigned.length ? `<select data-chg="addPlayer" data-raid="${r.id}"><option value="">＋ Tilføj spiller manuelt…</option>${notSigned.map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.spec ? ' – ' + esc(shortSpec(p.spec)) : ''}</option>`).join('')}</select>` : ''}
        </div>
        ${groups || `<p class="muted small">${r.signups.length ? 'Alle tilmeldte er sat ind.' : 'Ingen tilmeldinger importeret. Brug <b>Importér fra Raid-Helper</b>.'}</p>`}
      </div>
    </div>
  </section>`;
}

// ----- Spillere -----
function viewPlayers() {
  const stats = playerStats(computeAttendance());
  const f = UI.playerFilter.toLowerCase();
  const list = Object.values(S.players)
    .filter(p => !f || (p.name + ' ' + (p.discord || '') + ' ' + p.cls + ' ' + p.spec).toLowerCase().includes(f))
    .sort((a, b) => (b.active !== false) - (a.active !== false) || ROLES.indexOf(roleOf(a.cls, a.spec)) - ROLES.indexOf(roleOf(b.cls, b.spec)) || a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name));
  const clsOpts = c => `<option value="">–</option>` + Object.keys(CLASSES).map(k => `<option ${k === c ? 'selected' : ''}>${k}</option>`).join('');
  const specOpts = (c, s) => `<option value="">–</option>` + (CLASSES[c] ? Object.keys(CLASSES[c]).map(k => `<option ${k === s ? 'selected' : ''}>${k}</option>`).join('') : '');
  return `
  <div class="row" style="margin-bottom:16px">
    <h2>Spillere</h2><span class="muted">(${Object.keys(S.players).length})</span>
    <span class="spacer"></span>
    <input type="text" placeholder="Søg…" value="${esc(UI.playerFilter)}" data-chg="playerFilter">
    <button class="btn primary" data-act="addPlayer">＋ Ny spiller</button>
  </div>
  <div class="card table-wrap">
  ${list.length ? `<table>
    <thead><tr><th>Karakter</th><th>Discord</th><th>Klasse</th><th>Spec</th><th>Rolle</th><th>Prio</th><th>Aktiv</th><th>Note</th><th>Fremmøde</th><th></th></tr></thead>
    <tbody>${list.map(p => {
      const s = stats[p.id] || {};
      return `<tr style="${p.active === false ? 'opacity:.5' : ''}">
        <td><span class="cls-dot" style="--cls:${clsColor(p.cls)}"></span><input type="text" value="${esc(p.name)}" data-chg="pField" data-p="${esc(p.id)}" data-f="name" style="width:150px"></td>
        <td class="muted small">${esc(p.discord || '–')}</td>
        <td><select data-chg="pField" data-p="${esc(p.id)}" data-f="cls">${clsOpts(p.cls)}</select></td>
        <td><select data-chg="pField" data-p="${esc(p.id)}" data-f="spec">${specOpts(p.cls, p.spec)}</select></td>
        <td class="muted">${p.cls ? roleOf(p.cls, p.spec) : '–'}</td>
        <td><input type="checkbox" ${p.prio ? 'checked' : ''} data-chg="pField" data-p="${esc(p.id)}" data-f="prio"></td>
        <td><input type="checkbox" ${p.active !== false ? 'checked' : ''} data-chg="pField" data-p="${esc(p.id)}" data-f="active"></td>
        <td><input type="text" value="${esc(p.note || '')}" data-chg="pField" data-p="${esc(p.id)}" data-f="note"></td>
        <td class="small">${s.pct == null ? '<span class="muted">–</span>' : `<span class="bar"><span style="width:${s.pct}%"></span></span>${s.pct}%`}</td>
        <td><button class="btn small danger" data-act="deletePlayer" data-p="${esc(p.id)}">Slet</button></td>
      </tr>`;
    }).join('')}</tbody></table>` : `<div class="empty">Ingen spillere endnu. De bliver oprettet automatisk, når du importerer fra Raid-Helper.</div>`}
  </div>`;
}

// ----- Fremmøde -----
function viewAttendance() {
  const units = computeAttendance();
  const stats = playerStats(units);
  const last = units.slice(-10);
  const players = Object.values(S.players).filter(p => stats[p.id] && stats[p.id].total)
    .sort((a, b) => (stats[b.id].pct ?? -1) - (stats[a.id].pct ?? -1) || a.name.localeCompare(b.name));
  const sym = { raid: ['●', 'att-raid', 'Raidet'], bench: ['◐', 'att-bench', 'Bænk'], absence: ['✗', 'att-absence', 'Afbud'] };
  return `
  <div class="row" style="margin-bottom:16px"><h2>Fremmøde</h2>
    <span class="spacer"></span>
    <span class="small muted"><span class="att-raid">●</span> raidet &nbsp; <span class="att-bench">◐</span> bænk &nbsp; <span class="att-absence">✗</span> afbud &nbsp; <span class="att-none">·</span> ikke tilmeldt</span>
  </div>
  <div class="card table-wrap">
  ${players.length ? `<table>
    <thead><tr><th>Spiller</th><th>Fremmøde</th><th>Raids</th><th>Bænk</th><th>Afbud</th><th>Ikke tilm.</th>
      ${last.map(u => `<th class="att-cell" title="${esc(u.name)} – ${fmtDay(u.date)}">${fmtShort(u.date)}<br><span class="muted">${esc(u.lockout)}</span></th>`).join('')}</tr></thead>
    <tbody>${players.map(p => {
      const s = stats[p.id];
      return `<tr><td><span class="cls-dot" style="--cls:${clsColor(p.cls)}"></span>${esc(p.name)}</td>
        <td><span class="bar"><span style="width:${s.pct}%"></span></span>${s.pct}%</td>
        <td>${s.raid}</td><td>${s.bench}</td><td>${s.absence}</td><td>${s.none}</td>
        ${last.map(u => { const o = u.out[p.id]; const x = sym[o]; return x ? `<td class="att-cell ${x[1]}" title="${x[2]}">${x[0]}</td>` : '<td class="att-cell att-none">·</td>'; }).join('')}
      </tr>`;
    }).join('')}</tbody></table>` : `<div class="empty">Ingen fremmøde endnu. Raids tæller med, når datoen er passeret eller du har klikket <b>Markér færdig</b>.</div>`}
  </div>
  <p class="small muted">Fremmøde = (raids + bænk) / alle raid-aftener siden spilleren første gang dukkede op. Raids med samme lockout samme uge (fx 10-man A og B) tæller som én aften.</p>`;
}

// ----- Log -----
function viewLog() {
  return `<div class="row" style="margin-bottom:16px"><h2>Log</h2><span class="spacer"></span>
    ${S.log.length ? '<button class="btn small" data-act="clearLog">Ryd log</button>' : ''}</div>
  <div class="card">${S.log.length ? S.log.map(l => `<div class="log-item"><time>${new Date(l.t).toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time><span>${esc(l.text)}</span></div>`).join('') : '<div class="empty">Ingen ændringer endnu.</div>'}</div>`;
}

// ----- Indstillinger -----
function viewSettings() {
  const st = S.settings;
  const clsSel = (c, i) => `<select data-chg="buffField" data-i="${i}" data-f="cls">${Object.keys(CLASSES).map(k => `<option ${k === c ? 'selected' : ''}>${k}</option>`).join('')}</select>`;
  return `
  <h2 style="margin-bottom:16px">Indstillinger</h2>
  <div class="card">
    <h3 style="margin-bottom:10px">Generelt</h3>
    <div class="kv">
      <label>Holdnavn</label><input type="text" value="${esc(st.teamName)}" data-chg="setting" data-f="teamName">
      <label>Reset-dag</label><select data-chg="setting" data-f="resetDay" data-num="1">${DAYS.map((d, i) => `<option value="${i}" ${i === +st.resetDay ? 'selected' : ''}>${d}</option>`).join('')}</select>
      <label>Bænk-bonus</label><span><input type="number" value="${st.benchBonus}" data-chg="setting" data-f="benchBonus" data-num="1" style="width:80px"> <span class="small muted">point pr. bænk de sidste 4 uger (auto-fyld)</span></span>
      <label>Prio-bonus</label><span><input type="number" value="${st.prioBonus}" data-chg="setting" data-f="prioBonus" data-num="1" style="width:80px"> <span class="small muted">point til spillere markeret prio</span></span>
    </div>
  </div>

  <div class="card table-wrap">
    <div class="row" style="margin-bottom:10px"><h3>Raid-skabeloner</h3><span class="spacer"></span><button class="btn small" data-act="addTpl">＋ Tilføj</button></div>
    <p class="small muted" style="margin-top:0">Bruges når du opretter nye raids. Raids med samme <b>lockout</b> kan en spiller kun være i ét af pr. uge.</p>
    <table><thead><tr><th>Navn</th><th>Størrelse</th><th>Tanks</th><th>Healers</th><th>Dag</th><th>Lockout</th><th></th></tr></thead>
    <tbody>${st.raids.map((t, i) => `<tr>
      <td><input type="text" value="${esc(t.name)}" data-chg="tplField" data-i="${i}" data-f="name"></td>
      <td><input type="number" value="${t.size}" data-chg="tplField" data-i="${i}" data-f="size" data-num="1" style="width:70px"></td>
      <td><input type="number" value="${t.tanks}" data-chg="tplField" data-i="${i}" data-f="tanks" data-num="1" style="width:60px"></td>
      <td><input type="number" value="${t.healers}" data-chg="tplField" data-i="${i}" data-f="healers" data-num="1" style="width:60px"></td>
      <td><select data-chg="tplField" data-i="${i}" data-f="day" data-num="1">${DAYS.map((d, k) => `<option value="${k}" ${k === +t.day ? 'selected' : ''}>${d}</option>`).join('')}</select></td>
      <td><input type="text" value="${esc(t.lockout)}" data-chg="tplField" data-i="${i}" data-f="lockout" style="width:80px"></td>
      <td><button class="btn small danger" data-act="delTpl" data-i="${i}">Slet</button></td></tr>`).join('')}</tbody></table>
  </div>

  <div class="card table-wrap">
    <div class="row" style="margin-bottom:10px"><h3>Buffs der tjekkes</h3><span class="spacer"></span><button class="btn small" data-act="addBuff">＋ Tilføj</button></div>
    <table><thead><tr><th>Navn</th><th>Klasse</th><th>Specs (komma, tom = alle)</th><th>Min. antal</th><th></th></tr></thead>
    <tbody>${st.buffs.map((b, i) => `<tr>
      <td><input type="text" value="${esc(b.label)}" data-chg="buffField" data-i="${i}" data-f="label"></td>
      <td>${clsSel(b.cls, i)}</td>
      <td><input type="text" value="${esc(b.specs.join(', '))}" data-chg="buffField" data-i="${i}" data-f="specs"></td>
      <td><input type="number" value="${b.min}" data-chg="buffField" data-i="${i}" data-f="min" data-num="1" style="width:60px"></td>
      <td><button class="btn small danger" data-act="delBuff" data-i="${i}">Slet</button></td></tr>`).join('')}</tbody></table>
  </div>

  <div class="card">
    <h3 style="margin-bottom:10px">Backup</h3>
    <p class="small muted" style="margin-top:0">Dine data ligger kun i denne browser. Download en backup en gang imellem – og brug den til at flytte data til en anden computer.</p>
    <div class="row">
      <button class="btn primary" data-act="exportData">Download backup</button>
      <button class="btn" data-act="copyData">Vis backup som tekst</button>
      <button class="btn" data-act="pasteData">Indsæt backup-tekst…</button>
      <label class="btn">Indlæs backup… <input type="file" accept=".json,application/json" data-chg="importData" hidden></label>
      <span class="spacer"></span>
      <button class="btn danger" data-act="resetAll">Slet alle data</button>
    </div>
  </div>`;
}

// ----- Små pop-up vinduer (i stedet for browserens confirm/prompt) -----
// Brug:  if (await ask('Er du sikker?')) ...   /   const navn = await askText('Navn:')
function openModal(m) { return new Promise(res => { UI.modal = { ...m, res }; renderDialog(); }); }
const ask = (msg, okLabel = 'Ja', danger = true) => openModal({ kind: 'confirm', msg, okLabel, danger });
const askText = (msg, value = '') => openModal({ kind: 'prompt', msg, value });
const showText = (msg, value) => openModal({ kind: 'text', msg, value });
function closeModal(result) {
  const m = UI.modal;
  UI.modal = null;
  renderDialog();
  if (m) m.res(result);
}
function renderModal(d, m) {
  const field = m.kind === 'prompt' ? `<input type="text" id="modal-input" value="${esc(m.value)}" style="width:100%">`
    : m.kind === 'text' ? `<textarea id="modal-input" readonly>${esc(m.value)}</textarea>` : '';
  const buttons = m.kind === 'text'
    ? `<button class="btn" data-act="modalCancel">Luk</button><button class="btn primary" data-act="modalCopy">Kopiér</button>`
    : `<button class="btn" data-act="modalCancel">Annullér</button><button class="btn ${m.danger ? 'danger' : 'primary'}" data-act="modalOk">${esc(m.okLabel || 'OK')}</button>`;
  d.innerHTML = `<div class="dialog"><p style="margin-top:0">${esc(m.msg)}</p>${field}<div class="actions">${buttons}</div></div>`;
  setTimeout(() => { const i = $('modal-input'); if (i) { i.focus(); i.select(); } }, 0);
}

// ----- Import-dialog -----
function renderDialog() {
  const d = $('dialog');
  if (UI.modal) { d.hidden = false; renderModal(d, UI.modal); return; }
  const imp = UI.imp;
  if (!imp) { d.hidden = true; d.innerHTML = ''; return; }
  d.hidden = false;
  if (!imp.parsed) {
    d.innerHTML = `<div class="dialog">
      <h3>Importér fra Raid-Helper</h3>
      <p class="small muted" style="margin-top:0">Indsæt <b>event-linket</b> eller <b>event-ID'et</b> fra Raid-Helper (fx fra Discord: højreklik på eventet → Kopiér ID).
      Virker det ikke, så åbn <code>https://raid-helper.dev/api/v2/events/&lt;ID&gt;</code>, markér alt (Ctrl+A), kopiér og indsæt teksten her.</p>
      <textarea id="imp-text" placeholder="https://raid-helper.dev/event/1234567890123456789  –  eller JSON">${esc(imp.text || '')}</textarea>
      ${imp.error ? `<div class="error">${esc(imp.error)}${imp.url ? `<br><a href="${esc(imp.url)}" target="_blank" rel="noopener">Åbn data-linket ↗</a>` : ''}</div>` : ''}
      <div class="actions">
        <button class="btn" data-act="closeImport">Annullér</button>
        <button class="btn primary" data-act="readImport" ${imp.loading ? 'disabled' : ''}>${imp.loading ? 'Henter…' : 'Læs event'}</button>
      </div></div>`;
    setTimeout(() => { const t = $('imp-text'); if (t && !imp.text) t.focus(); }, 0);
    return;
  }
  const p = imp.parsed;
  const wid = resetOf(imp.date);
  const w = S.weeks[wid];
  const existing = w ? w.raids : [];
  const counts = STATUS_ORDER.map(st => [st, p.signups.filter(s => s.st === st).length]).filter(x => x[1]);
  d.innerHTML = `<div class="dialog">
    <h3>${esc(p.title)}</h3>
    <div class="kv">
      <label>Dato</label><input type="date" value="${imp.date}" data-chg="impDate">
      <label>Uge</label><span>${weekLabel(wid)} <span class="muted">(${weekSpan(wid)})</span></span>
      <label>Tilmeldinger</label><span>${p.signups.length} — ${counts.map(([st, n]) => `${STATUS[st].label}: ${n}`).join(', ')}</span>
      <label>Importér til</label>
      <select data-chg="impTarget">
        ${existing.map(r => `<option value="raid:${r.id}" ${imp.target === 'raid:' + r.id ? 'selected' : ''}>Opdatér: ${esc(r.name)} (${fmtDay(r.date)})</option>`).join('')}
        ${S.settings.raids.map(t => `<option value="tpl:${t.id}" ${imp.target === 'tpl:' + t.id ? 'selected' : ''}>Nyt raid: ${esc(t.name)}</option>`).join('')}
      </select>
    </div>
    <p class="small muted">Opdaterer du et eksisterende raid, bevares dit roster. Spillere der har meldt fra bliver markeret med rødt.</p>
    <div class="actions">
      <button class="btn" data-act="closeImport">Annullér</button>
      <button class="btn primary" data-act="doImport">Importér</button>
    </div></div>`;
}

function defaultTarget(parsed, date) {
  const w = S.weeks[resetOf(date)];
  if (w) {
    const same = w.raids.find(r => parsed.id && r.eventId === parsed.id);
    if (same) return 'raid:' + same.id;
  }
  const wd = parseIso(date).getDay();
  const tpl = S.settings.raids.find(t => +t.day === wd) || S.settings.raids[0];
  return tpl ? 'tpl:' + tpl.id : '';
}


// ---------- 7. Handlinger ----------
const raidOf = d => findRaid(d.raid);

const ACT = {
  tab(d) { UI.tab = d.tab; history.replaceState(null, '', '#' + d.tab); render(); },
  theme() {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('raidroster.theme', next); } catch (e) { /* ignorer */ }
  },
  weekNav(d) { UI.weekId = addDays(UI.weekId, +d.d); render(); },
  weekToday() { UI.weekId = resetOf(today()); render(); },

  // Import
  openImport() { UI.imp = { text: '' }; renderDialog(); },
  closeImport() { UI.imp = null; renderDialog(); },
  async readImport() {
    const imp = UI.imp;
    imp.text = $('imp-text').value;
    imp.error = ''; imp.url = ''; imp.loading = true; renderDialog();
    try {
      const json = await fetchEvent(imp.text);
      imp.parsed = parseRaidHelper(json);
      imp.date = imp.parsed.date;
      imp.target = defaultTarget(imp.parsed, imp.date);
    } catch (e) { imp.error = e.message; imp.url = e.url || ''; }
    imp.loading = false;
    renderDialog();
  },
  doImport() {
    const { parsed, date, target } = UI.imp;
    const wid = resetOf(date);
    const w = getWeek(wid, true);
    ensurePlayers(parsed.signups);
    let r;
    if (target.startsWith('raid:')) {
      r = w.raids.find(x => x.id === target.slice(5));
    }
    if (!r) {
      const tpl = S.settings.raids.find(t => t.id === target.slice(4)) || S.settings.raids[0];
      r = newRaid(tpl, date);
      w.raids.push(r);
    }
    r.signups = parsed.signups;
    r.eventId = parsed.id;
    r.eventTitle = parsed.title;
    r.date = date;
    UI.imp = null;
    UI.weekId = wid;
    UI.tab = 'week';
    commit(`Importerede ${parsed.signups.length} tilmeldinger til ${r.name} (${fmtDay(date)})`);
    toast(`${parsed.signups.length} tilmeldinger importeret`);
  },

  // Raids
  autofill(d) {
    const { wid, r } = raidOf(d);
    const before = r.roster.length;
    autofill(wid, r);
    commit(`Auto-fyld på ${r.name}: ${r.roster.length - before} spillere tilføjet`);
  },
  assign(d) {
    const { r } = raidOf(d);
    const o = optsFor(r, d.p)[+d.k];
    if (!o || r.roster.some(e => e.p === d.p)) return;
    r.roster.push({ p: d.p, c: o.c, s: o.s });
    commit(`${pName(d.p)} sat ind i ${r.name} som ${o.s}`);
  },
  unassign(d) {
    const { r } = raidOf(d);
    const [e] = r.roster.splice(+d.i, 1);
    commit(`${pName(e.p)} fjernet fra ${r.name}`);
  },
  async clear(d) {
    const { r } = raidOf(d);
    if (!r.roster.length || !await ask(`Ryd hele rosteret for ${r.name}?`)) return;
    r.roster = [];
    commit(`Ryddede rosteret for ${r.name}`);
  },
  toggleDone(d) {
    const { r } = raidOf(d);
    r.done = !r.done;
    commit(`${r.name} markeret ${r.done ? 'færdig' : 'ikke færdig'}`);
  },
  async deleteRaid(d) {
    const { w, r } = raidOf(d);
    if (!await ask(`Slet ${r.name} (${fmtDay(r.date)})? Tilmeldinger og roster forsvinder.`)) return;
    w.raids.splice(w.raids.indexOf(r), 1);
    commit(`Slettede ${r.name} (${fmtDay(r.date)})`);
  },
  async copy(d) {
    const { wid, r } = raidOf(d);
    const text = rosterText(wid, r);
    try { await navigator.clipboard.writeText(text); toast('Kopieret – indsæt i Discord'); }
    catch (e) { showText('Kopiér teksten:', text); }
  },

  // Spillere
  async addPlayer() {
    const name = await askText('Karakternavn på den nye spiller:');
    if (!name) return;
    const id = 'm_' + uid();
    S.players[id] = { id, name: name.trim(), discord: '', cls: '', spec: '', note: '', prio: false, active: true };
    commit(`Oprettede spilleren ${name.trim()}`);
  },
  async deletePlayer(d) {
    const p = S.players[d.p];
    if (!await ask(`Slet ${p.name}? Spilleren fjernes også fra alle rosters.`)) return;
    for (const w of Object.values(S.weeks)) for (const r of w.raids) r.roster = r.roster.filter(e => e.p !== d.p);
    delete S.players[d.p];
    commit(`Slettede spilleren ${p.name}`);
  },

  // Indstillinger
  addTpl() { S.settings.raids.push({ id: 't' + uid(), name: 'Nyt raid', size: 20, tanks: 2, healers: 4, day: 3, lockout: 'nyt' }); commit('Tilføjede raid-skabelon'); },
  delTpl(d) { const [t] = S.settings.raids.splice(+d.i, 1); commit(`Slettede skabelonen ${t.name}`); },
  addBuff() { S.settings.buffs.push({ label: 'Ny buff', cls: 'Warrior', specs: [], min: 1 }); commit('Tilføjede buff'); },
  delBuff(d) { const [b] = S.settings.buffs.splice(+d.i, 1); commit(`Slettede buffen ${b.label}`); },
  exportData() {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `raid-roster-backup-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  // Backup som tekst – virker også hvor downloads er blokeret
  copyData() { showText('Backup – kopiér og gem teksten et sikkert sted (fx i en .json-fil):', JSON.stringify(S)); },
  modalOk() {
    const i = $('modal-input');
    closeModal(UI.modal.kind === 'prompt' ? i.value : true);
  },
  modalCancel() { closeModal(UI.modal && UI.modal.kind === 'prompt' ? null : false); },
  async modalCopy() {
    const v = $('modal-input').value;
    try { await navigator.clipboard.writeText(v); toast('Kopieret'); } catch (e) { $('modal-input').select(); toast('Tryk Ctrl+C for at kopiere'); }
  },
  async resetAll() {
    if (!await ask('Slet ALLE data (spillere, raids, indstillinger)? Det kan ikke fortrydes – tag en backup først.')) return;
    S = normalize(null);
    commit('Alle data slettet');
  },
  async clearLog() { if (await ask('Ryd hele loggen?')) { S.log = []; commit(); } },
  async pasteData() {
    const text = await askText('Indsæt backup-teksten (JSON):');
    if (!text) return;
    try {
      const data = JSON.parse(text);
      if (!data.players || !data.weeks) throw new Error('Teksten ligner ikke en backup herfra');
      if (!await ask('Erstat alle nuværende data med backuppen?', 'Erstat')) return;
      S = normalize(data);
      commit('Backup indlæst');
      toast('Backup indlæst');
    } catch (e) { toast('Kunne ikke læse backup: ' + e.message); }
  },
};

const CHG = {
  weekPick(d, el) { if (el.value) { UI.weekId = el.value; render(); } },
  addRaid(d, el) {
    const tpl = S.settings.raids.find(t => t.id === el.value);
    if (!tpl) return;
    const r = newRaid(tpl, tplDate(UI.weekId, tpl));
    getWeek(UI.weekId, true).raids.push(r);
    commit(`Oprettede ${r.name} (${fmtDay(r.date)})`);
  },
  raidName(d, el) { const { r } = raidOf(d); const old = r.name; r.name = el.value.trim() || old; commit(`Omdøbte ${old} til ${r.name}`); },
  raidDate(d, el) {
    if (!el.value) return;
    const found = raidOf(d);
    const { r } = found;
    r.date = el.value;
    // Flyt raidet hvis datoen nu ligger i en anden uge
    const nw = resetOf(r.date);
    if (nw !== found.wid) {
      found.w.raids.splice(found.w.raids.indexOf(r), 1);
      getWeek(nw, true).raids.push(r);
      UI.weekId = nw;
    }
    commit(`${r.name} flyttet til ${fmtDay(r.date)}`);
  },
  rosterSpec(d, el) {
    const { r } = raidOf(d);
    const e = r.roster[+d.i];
    const o = optsFor(r, e.p)[+el.value];
    e.c = o.c; e.s = o.s;
    commit(`${pName(e.p)} skiftet til ${o.s} i ${r.name}`);
  },
  addPlayer(d, el) {
    const { r } = raidOf(d);
    const p = S.players[el.value];
    if (!p) return;
    if (!p.cls || !p.spec) { toast(`Giv ${p.name} en klasse og spec under Spillere først`); el.value = ''; return; }
    r.roster.push({ p: p.id, c: p.cls, s: p.spec });
    commit(`${p.name} sat ind i ${r.name} (manuelt)`);
  },
  playerFilter(d, el) { UI.playerFilter = el.value; render(); },
  pField(d, el) {
    const p = S.players[d.p];
    const v = el.type === 'checkbox' ? el.checked : el.value;
    p[d.f] = v;
    if (d.f === 'cls') p.spec = CLASSES[v] ? Object.keys(CLASSES[v])[0] : '';
    commit(`${p.name}: ${d.f} ændret`);
  },
  setting(d, el) { S.settings[d.f] = d.num ? +el.value : el.value; commit('Indstilling ændret'); },
  tplField(d, el) { S.settings.raids[+d.i][d.f] = d.num ? +el.value : el.value; commit('Raid-skabelon ændret'); },
  buffField(d, el) {
    const b = S.settings.buffs[+d.i];
    if (d.f === 'specs') b.specs = el.value.split(',').map(s => s.trim()).filter(Boolean);
    else b[d.f] = d.num ? +el.value : el.value;
    commit('Buff ændret');
  },
  importData(d, el) {
    const file = el.files[0];
    if (!file) return;
    el.value = '';
    file.text().then(async text => {
      const data = JSON.parse(text);
      if (!data.players || !data.weeks) throw new Error('Filen ligner ikke en backup herfra');
      if (!await ask('Erstat alle nuværende data med backuppen?', 'Erstat')) return;
      S = normalize(data);
      commit('Backup indlæst');
      toast('Backup indlæst');
    }).catch(e => toast('Kunne ikke læse backup: ' + e.message));
  },
  impDate(d, el) {
    if (!el.value) return;
    UI.imp.date = el.value;
    UI.imp.target = defaultTarget(UI.imp.parsed, el.value);
    renderDialog();
  },
  impTarget(d, el) { UI.imp.target = el.value; },
};

// Ét fælles sted der lytter efter klik og ændringer (data-act / data-chg i HTML'en)
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (fn) fn(el.dataset, el, e);
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-chg]');
  if (!el) return;
  const fn = CHG[el.dataset.chg];
  if (fn) fn(el.dataset, el, e);
});
$('dialog').addEventListener('click', e => { if (e.target.id !== 'dialog') return; if (UI.modal) ACT.modalCancel(); else ACT.closeImport(); });
document.addEventListener('keydown', e => {
  if (UI.modal && e.key === 'Enter' && UI.modal.kind !== 'text') { e.preventDefault(); ACT.modalOk(); return; }
  if (e.key === 'Escape') { if (UI.modal) ACT.modalCancel(); else if (UI.imp) ACT.closeImport(); }
});

// Tema
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem('raidroster.theme'); } catch (e) { /* ignorer */ }
  document.documentElement.dataset.theme = t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
})();

render();
