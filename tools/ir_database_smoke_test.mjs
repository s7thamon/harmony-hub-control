#!/usr/bin/env node

import fs from 'node:fs';
import pathModule from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = pathModule.dirname(fileURLToPath(import.meta.url));

const IRDB_BASE = 'https://cdn.jsdelivr.net/gh/probonopd/irdb@master/codes/';
const FLIPPER_BASE = 'https://cdn.jsdelivr.net/gh/Lucaslhm/Flipper-IRDB@main/';
const FLIPPER_INDEX = 'https://api.github.com/repos/Lucaslhm/Flipper-IRDB/git/trees/main?recursive=1';
const LIRC_BASE = 'https://raw.githubusercontent.com/probonopd/lirc-remotes/master/';
const LIRC_INDEX = 'https://api.github.com/repos/probonopd/lirc-remotes/git/trees/master?recursive=1';
const LIRC_JSDELIVR_INDEX = 'https://data.jsdelivr.com/v1/package/gh/probonopd/lirc-remotes@master/flat';
const SMARTIR_BASE = 'https://raw.githubusercontent.com/smartHomeHub/SmartIR/master/';
const SMARTIR_INDEX = 'https://api.github.com/repos/smartHomeHub/SmartIR/git/trees/master?recursive=1';
const SMARTIR_JSDELIVR_INDEX = 'https://data.jsdelivr.com/v1/package/gh/smartHomeHub/SmartIR@master/flat';

function arg(name, fallback = '') {
  const eq = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] || fallback) : fallback;
}

function has(name) {
  return process.argv.includes(`--${name}`);
}

const sampleCount = Math.max(1, Math.min(500, Number(arg('sample', '10')) || 10));
const perDevice = Math.max(1, Math.min(80, Number(arg('per-device', '12')) || 12));
const hub = arg('hub', '').replace(/\/$/, '');
const seedText = arg('seed', String(Date.now()));
const sourceArg = arg('source', 'all').toLowerCase();
const doConfigure = has('configure') && !!hub;
const doDryRun = has('dry-run') || !doConfigure;
const showUnsupported = has('show-unsupported');
const pathFilters = process.argv
  .filter((x) => x.startsWith('--path='))
  .map((x) => x.slice('--path='.length).toLowerCase())
  .filter(Boolean);
let webuiParseIrText = null;

let randState = 0;
for (const ch of seedText) randState = (randState * 31 + ch.charCodeAt(0)) >>> 0;
if (!randState) randState = 0x12345678;

function random() {
  randState = (randState * 1664525 + 1013904223) >>> 0;
  return randState / 0x100000000;
}

function pickMany(items, count) {
  const copy = items.slice();
  const out = [];
  while (copy.length && out.length < count) {
    out.push(copy.splice(Math.floor(random() * copy.length), 1)[0]);
  }
  return out;
}

function loadWebuiParser() {
  if (webuiParseIrText) return webuiParseIrText;
  const sourcePath = pathModule.join(__dirname, '..', 'payload', 'source', 'codex_webui.c');
  const c = fs.readFileSync(sourcePath, 'utf8');
  const script = [...c.matchAll(/^\s*"((?:\\.|[^"\\])*)"\s*$/gm)]
    .map((m) => JSON.parse(`"${m[1]}"`))
    .join('');
  const start = script.indexOf('const IRDB_BASE');
  const end = script.indexOf('async function postJson');
  if (start < 0 || end < 0) throw new Error('could not extract web UI IR parser');
  const context = {
    console,
    fetch,
    atob: (s) => Buffer.from(String(s || '').replace(/\s+/g, ''), 'base64').toString('binary'),
    document: {
      createElement: () => ({
        _v: '',
        set innerHTML(v) {
          this._v = String(v || '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        },
        get value() {
          return this._v;
        },
      }),
    },
    DOMParser: class {
      parseFromString() {
        return { querySelector: () => null, querySelectorAll: () => [] };
      }
    },
    $: () => null,
    history: {},
    location: {},
  };
  vm.createContext(context);
  vm.runInContext(`${script.slice(start, end)};this.__parseIrText=parseIrText;`, context);
  webuiParseIrText = (body, source, path) => context.__parseIrText(body, source, path);
  return webuiParseIrText;
}

function rev8(v) {
  v = ((v & 240) >> 4) | ((v & 15) << 4);
  v = ((v & 204) >> 2) | ((v & 51) << 2);
  v = ((v & 170) >> 1) | ((v & 85) << 1);
  return v & 255;
}

// Mirrors the hub page's keyFromParts: only the NEC family is a KeyCode on
// the Toshiba 32 Bit protocol (NECx, Samsung32 and Pioneer have other timing).
function keyFromParts(proto, d, s, f) {
  if (!/^(NEC|NEC1|NEC1-f16|NEC2|NECext)$/i.test(proto || '')) return '';
  d = Number(d);
  const ss = String(s === undefined ? '' : s).trim();
  s = ss === '' || ss === '-1' ? (d ^ 255) : Number(s);
  f = Number(f);
  if ([d, s, f].some((x) => !Number.isFinite(x) || x < 0 || x > 255)) return '';
  const val = ((rev8(d) << 24) | (rev8(s) << 16) | (rev8(f) << 8) | rev8((~f) & 255)) >>> 0;
  const hex = `0x${val.toString(16).toUpperCase().padStart(8, '0')}`;
  return `G:Toshiba 32 Bit:(${hex})(${/^NEC2$/i.test(proto) ? hex : 'Repeat'})():3`;
}

function csvCells(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        q = !q;
      }
    } else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function safeImportName(s) {
  return String(s || 'Command').replace(/[|"\r\n\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 96) || 'Command';
}

function csvEntries(text) {
  return text.replace(/\r/g, '').split('\n').map((x) => x.trim()).filter(Boolean).map((line) => {
    const p = csvCells(line);
    const name = p[0] || '';
    const proto = p[1] || '';
    const keycode = name === 'functionname' ? '' : keyFromParts(proto, p[2] || '', p[3] || '', p[4] || '');
    const raw = name === 'functionname' ? '' : csvProtocolRaw(proto, p[2] || '', p[3] || '', p[4] || '', name);
    return { name, meta: `${proto} ${p[2] || ''},${p[3] || ''},${p[4] || ''}`, protocol: proto, keycode, raw };
  }).filter((r) => r.name && r.name !== 'functionname');
}

function hexBytes(v) {
  return String(v || '').trim().split(/\s+/).filter(Boolean).map((x) => parseInt(x, 16) || 0);
}

function hexValue(v) {
  return hexBytes(v).slice(0, 4).reduce((a, b, i) => a | ((b & 255) << (8 * i)), 0) >>> 0;
}

function harmonyRawFromTimings(freq, vals) {
  freq = Math.max(10000, Math.min(60000, Math.round(Number(freq) || 38000)));
  vals = (vals || []).map((v) => Math.max(1, Math.min(0xfffff, Math.round(Math.abs(Number(v) || 0))))).filter(Boolean);
  if (vals.length < 4) return '';
  let raw = `F${freq.toString(16).toUpperCase()}`;
  vals.forEach((v, i) => { raw += `${i % 2 ? 'S' : 'P'}${v.toString(16).toUpperCase()}`; });
  return raw.length <= 4096 ? raw : '';
}

function pulse(seq, level, dur) {
  dur = Math.round(dur);
  if (dur <= 0) return;
  const last = seq[seq.length - 1];
  if (last && last.level === level) last.dur += dur;
  else seq.push({ level, dur });
}

function seqRaw(freq, seq) {
  if (!seq.length) return '';
  if (seq[0].level === 0) seq.unshift({ level: 1, dur: 1 });
  return harmonyRawFromTimings(freq, seq.map((x) => x.dur));
}

function manchester(seq, bits, half, doubleIndex) {
  bits.forEach((bit, i) => {
    const h = i === doubleIndex ? half * 2 : half;
    if (bit) {
      pulse(seq, 1, h);
      pulse(seq, 0, h);
    } else {
      pulse(seq, 0, h);
      pulse(seq, 1, h);
    }
  });
}

function msbBits(v, n) {
  const a = [];
  for (let i = n - 1; i >= 0; i--) a.push((v >> i) & 1);
  return a;
}

function lsbBits(v, n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push((v >> i) & 1);
  return a;
}

function rc5Raw(cur) {
  const addr = hexValue(cur.address) & 31;
  const cmd = hexValue(cur.command) & 127;
  const tog = hexValue(cur.toggle) & 1;
  const seq = [];
  const bits = [1, cmd < 64 ? 1 : 0, tog].concat(msbBits(addr, 5), msbBits(cmd & 63, 6));
  manchester(seq, bits, 889, -1);
  return seqRaw(36000, seq);
}

function rc6Raw(cur) {
  const addr = hexValue(cur.address) & 255;
  const cmd = hexValue(cur.command) & 255;
  const tog = hexValue(cur.toggle) & 1;
  const seq = [];
  pulse(seq, 1, 2666);
  pulse(seq, 0, 889);
  const bits = [1, 0, 0, 0, tog].concat(msbBits(addr, 8), msbBits(cmd, 8));
  manchester(seq, bits, 444, 4);
  return seqRaw(36000, seq);
}

function mceRaw(d, s, f) {
  d = Number(d);
  const ss = String(s === undefined ? '' : s).trim();
  s = ss === '' || ss === '-1' ? 15 : Number(s);
  f = Number(f);
  if (!Number.isFinite(d) || !Number.isFinite(s) || !Number.isFinite(f)) return '';
  if (d < 0 || d > 127 || s < 0 || s > 255 || f < 0 || f > 255) return '';
  const seq = [];
  pulse(seq, 1, 2664);
  pulse(seq, 0, 888);
  const bits = [1, 1, 1, 0, 0].concat(msbBits(128, 8), msbBits(s, 8), [0], msbBits(d, 7), msbBits(f, 8));
  manchester(seq, bits, 444, 4);
  pulse(seq, 0, 100000);
  return seqRaw(36000, seq);
}

function recs80Raw(d, s, f, name = '') {
  d = Number(d);
  f = Number(f);
  const t = /\bT1\b/i.test(String(name || '')) ? 1 : 0;
  if (!Number.isFinite(d) || !Number.isFinite(f) || d < 0 || d > 7 || f < 0 || f > 63) return '';
  const seq = [];
  pulse(seq, 1, 158);
  pulse(seq, 0, 7432);
  [t].concat(msbBits(d, 3), msbBits(f, 6)).forEach((b) => {
    pulse(seq, 1, 158);
    pulse(seq, 0, b ? 7432 : 4902);
  });
  pulse(seq, 1, 158);
  pulse(seq, 0, 45000);
  return seqRaw(38000, seq);
}

function sircRaw(cur, proto) {
  const cmd = hexValue(cur.command) & 127;
  const addr = hexValue(cur.address);
  const bits = /20/.test(proto) ? 20 : (/15/.test(proto) ? 15 : 12);
  const addrBits = bits - 7;
  const seq = [];
  pulse(seq, 1, 2400);
  pulse(seq, 0, 600);
  lsbBits(cmd, 7).concat(lsbBits(addr, addrBits)).forEach((b) => {
    pulse(seq, 1, b ? 1200 : 600);
    pulse(seq, 0, 600);
  });
  return seqRaw(40000, seq);
}

function jvcRaw(d, f) {
  d = Number(d);
  f = Number(f);
  if (![d, f].every((x) => Number.isFinite(x) && x >= 0 && x <= 255)) return '';
  const seq = [];
  pulse(seq, 1, 8400);
  pulse(seq, 0, 4200);
  lsbBits(d, 8).concat(lsbBits(f, 8)).forEach((b) => {
    pulse(seq, 1, 525);
    pulse(seq, 0, b ? 1575 : 525);
  });
  pulse(seq, 1, 525);
  pulse(seq, 0, 23625);
  return seqRaw(38000, seq);
}

function rcaRaw(proto, d, f) {
  if (/old/i.test(proto || '')) return '';
  d = Number(d);
  f = Number(f);
  if (!Number.isFinite(d) || !Number.isFinite(f) || d < 0 || d > 15 || f < 0 || f > 255) return '';
  const freq = /38/.test(proto || '') ? 38000 : 58000;
  const seq = [];
  pulse(seq, 1, 3680);
  pulse(seq, 0, 3680);
  msbBits(d, 4).concat(msbBits(f, 8), msbBits((~d) & 15, 4), msbBits((~f) & 255, 8)).forEach((b) => {
    pulse(seq, 1, 460);
    pulse(seq, 0, b ? 1840 : 920);
  });
  pulse(seq, 1, 460);
  pulse(seq, 0, 7360);
  return seqRaw(freq, seq);
}

function panasonicRaw(d, s, f) {
  d = Number(d);
  const ss = String(s === undefined ? '' : s).trim();
  s = ss === '' || ss === '-1' ? 0 : Number(s);
  f = Number(f);
  if (![d, s, f].every((x) => Number.isFinite(x) && x >= 0 && x <= 255)) return '';
  const seq = [];
  const bytes = [0x02, 0x20, d & 255, s & 255, f & 255, (d ^ s ^ f) & 255];
  pulse(seq, 1, 3456);
  pulse(seq, 0, 1728);
  bytes.flatMap((b) => lsbBits(b, 8)).forEach((b) => {
    pulse(seq, 1, 432);
    pulse(seq, 0, b ? 1296 : 432);
  });
  pulse(seq, 1, 432);
  pulse(seq, 0, 74400);
  return seqRaw(37000, seq);
}

function aiwaRaw(d, s, f) {
  d = Number(d);
  const ss = String(s === undefined ? '' : s).trim();
  s = ss === '' || ss === '-1' ? 0 : Number(s);
  f = Number(f);
  if (!Number.isFinite(d) || !Number.isFinite(s) || !Number.isFinite(f)) return '';
  if (d < 0 || d > 255 || s < 0 || s > 31 || f < 0 || f > 255) return '';
  const seq = [];
  pulse(seq, 1, 8800);
  pulse(seq, 0, 4400);
  lsbBits(d, 8).concat(lsbBits(s, 5), lsbBits((~d) & 255, 8), lsbBits((~s) & 31, 5), lsbBits(f, 8), lsbBits((~f) & 255, 8)).forEach((b) => {
    pulse(seq, 1, 550);
    pulse(seq, 0, b ? 1650 : 550);
  });
  pulse(seq, 1, 550);
  pulse(seq, 0, 23100);
  pulse(seq, 1, 8800);
  pulse(seq, 0, 4400);
  pulse(seq, 1, 550);
  pulse(seq, 0, 90750);
  return seqRaw(38000, seq);
}

function panasonicOldRaw(d, s, f) {
  d = Number(d);
  f = Number(f);
  if (!Number.isFinite(d) || !Number.isFinite(f) || d < 0 || d > 31 || f < 0 || f > 63) return '';
  const seq = [];
  pulse(seq, 1, 3332);
  pulse(seq, 0, 3332);
  lsbBits(d, 5).concat(lsbBits(f, 6), lsbBits((~d) & 31, 5), lsbBits((~f) & 63, 6)).forEach((b) => {
    pulse(seq, 1, 833);
    pulse(seq, 0, b ? 2499 : 833);
  });
  pulse(seq, 1, 833);
  pulse(seq, 0, 100000);
  return seqRaw(57600, seq);
}

function nec48Raw(d, s, f, e = 0) {
  d = Number(d);
  const ss = String(s === undefined ? '' : s).trim();
  s = ss === '' || ss === '-1' ? (d ^ 255) : Number(s);
  f = Number(f);
  e = Number(e);
  if (![d, s, f, e].every((x) => Number.isFinite(x) && x >= 0 && x <= 255)) return '';
  const seq = [];
  pulse(seq, 1, 9024);
  pulse(seq, 0, 4512);
  lsbBits(d, 8).concat(lsbBits(s, 8), lsbBits(f, 8), lsbBits((~f) & 255, 8), lsbBits(e, 8), lsbBits((~e) & 255, 8)).forEach((b) => {
    pulse(seq, 1, 564);
    pulse(seq, 0, b ? 1692 : 564);
  });
  pulse(seq, 1, 564);
  pulse(seq, 0, 108000);
  pulse(seq, 1, 9024);
  pulse(seq, 0, 2256);
  pulse(seq, 1, 564);
  pulse(seq, 0, 108000);
  return seqRaw(38000, seq);
}

function blaupunktRaw(d, s, f) {
  d = Number(d);
  f = Number(f);
  if (!Number.isFinite(d) || !Number.isFinite(f) || d < 0 || d > 7 || f < 0 || f > 63) return '';
  const seq = [];
  pulse(seq, 1, 528);
  pulse(seq, 0, 2640);
  manchester(seq, Array(10).fill(1), 528, -1);
  pulse(seq, 0, 20592);
  pulse(seq, 1, 528);
  pulse(seq, 0, 2640);
  manchester(seq, [1].concat(lsbBits(f, 6), lsbBits(d, 3)), 528, -1);
  pulse(seq, 0, 121440);
  return seqRaw(30300, seq);
}

function dishRaw(d, s, f) {
  d = Number(d);
  const ss = String(s === undefined ? '' : s).trim();
  s = ss === '' || ss === '-1' ? 0 : Number(s);
  f = Number(f);
  if (!Number.isFinite(d) || !Number.isFinite(s) || !Number.isFinite(f)) return '';
  if (d < 0 || d > 31 || s < 0 || s > 31 || f < 0 || f > 63) return '';
  const bits = msbBits(f, 6).concat(msbBits(s, 5), msbBits(d, 5));
  const seq = [];
  pulse(seq, 1, 400);
  pulse(seq, 0, 6100);
  for (let r = 0; r < 4; r++) {
    bits.forEach((b) => {
      pulse(seq, 1, 400);
      pulse(seq, 0, b ? 1700 : 2800);
    });
    pulse(seq, 1, 400);
    pulse(seq, 0, 6100);
  }
  return seqRaw(57600, seq);
}

function csvProtocolRaw(proto, d, s, f, name = '') {
  proto = String(proto || '');
  const D = Number(d);
  const F = Number(f);
  const S = String(s === undefined ? '' : s).trim();
  if (!Number.isFinite(D) || !Number.isFinite(F) || D < 0 || F < 0) return '';
  if (/^RC5X?/i.test(proto)) {
    return rc5Raw({ address: D.toString(16), command: F.toString(16), toggle: '0' });
  }
  if (/^RC6/i.test(proto)) {
    return rc6Raw({ address: D.toString(16), command: F.toString(16), toggle: '0' });
  }
  if (/^MCE$/i.test(proto)) {
    return mceRaw(D, S, F);
  }
  if (/^RECS80$/i.test(proto)) {
    return recs80Raw(D, S, F, name);
  }
  if (/^JVC$/i.test(proto)) {
    return jvcRaw(D, F);
  }
  if (/^Panasonic$/i.test(proto)) {
    return panasonicRaw(D, S, F);
  }
  if (/^Aiwa$/i.test(proto)) {
    return aiwaRaw(D, S, F);
  }
  if (/^Panasonic_Old$/i.test(proto)) {
    return panasonicOldRaw(D, S, F);
  }
  if (/^Dish_Network$/i.test(proto)) {
    return dishRaw(D, S, F);
  }
  if (/^48-NEC1$/i.test(proto)) {
    return nec48Raw(D, S, F, 0);
  }
  if (/^Blaupunkt$/i.test(proto)) {
    return blaupunktRaw(D, S, F);
  }
  if (/^RCA(?:-38)?$/i.test(proto)) {
    return rcaRaw(proto, D, F);
  }
  if (/^Sony(12|15|20)?/i.test(proto)) {
    const bits = (proto.match(/Sony(\d+)/i) || [])[1] || '12';
    let addr = D;
    if (bits === '20' && S && S !== '-1') {
      const sub = Number(S);
      if (Number.isFinite(sub) && sub >= 0) addr = (D & 31) | ((sub & 255) << 5);
    }
    return sircRaw({ address: addr.toString(16), command: F.toString(16) }, `SIRC${bits}`);
  }
  return '';
}

function flipperEntries(text) {
  const out = [];
  let cur = {};
  function push() {
    if (!cur.name) {
      cur = {};
      return;
    }
    let keycode = '';
    let raw = '';
    let meta = cur.protocol || cur.type || 'raw';
    const protocol = cur.protocol || '';
    if (cur.type === 'parsed') {
      const a = hexBytes(cur.address);
      const c = hexBytes(cur.command);
      if (/^Samsung32/i.test(protocol)) keycode = keyFromParts(protocol, a[0], a[0], c[0]);
      else if (/^NECext/i.test(protocol)) keycode = keyFromParts(protocol, a[0], a[1], c[0]);
      else if (/^NEC/i.test(protocol)) keycode = keyFromParts(protocol, a[0], a[0] ^ 255, c[0]);
      else if (/^Pioneer/i.test(protocol)) keycode = keyFromParts(protocol, a[0], a[0] ^ 255, c[0]);
      else if (/^RC5/i.test(protocol)) {
        raw = rc5Raw(cur);
        meta = raw ? 'RC5 converted timing' : 'RC5 unsupported';
      } else if (/^RC6/i.test(protocol)) {
        raw = rc6Raw(cur);
        meta = raw ? 'RC6 converted timing' : 'RC6 unsupported';
      } else if (/^SIRC/i.test(protocol)) {
        raw = sircRaw(cur, protocol);
        meta = raw ? `${protocol} converted timing` : `${protocol} unsupported`;
      } else if (/^Kaseikyo/i.test(protocol)) {
        raw = kaseikyoRaw(cur);
        meta = raw ? 'Kaseikyo converted timing' : 'Kaseikyo unsupported';
      }
    } else if (cur.type === 'raw') {
      const vals = String(cur.data || '').trim().split(/\s+/).filter(Boolean).map(Number);
      raw = harmonyRawFromTimings(cur.frequency || 38000, vals);
      meta = `raw timings ${cur.frequency || 38000} Hz (${vals.length} durations)`;
    }
    out.push({ name: cur.name, meta, protocol, keycode, raw });
    cur = {};
  }
  text.replace(/\r/g, '').split('\n').forEach((line) => {
    line = line.trim();
    if (!line) return;
    if (line[0] === '#') {
      push();
      return;
    }
    const i = line.indexOf(':');
    if (i < 0) return;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k === 'name' && cur.name) push();
    cur[k] = cur[k] && k === 'data' ? `${cur[k]} ${v}` : v;
  });
  push();
  return out;
}

function kaseikyoRaw(cur) {
  const a = hexBytes(cur.address);
  const c = hexBytes(cur.command);
  if (a.length < 4 || c.length < 1) return '';
  const bytes = [a[1], a[2], a[0], a[3], c[0], (a[0] ^ a[3] ^ c[0]) & 255];
  const seq = [];
  pulse(seq, 1, 3456);
  pulse(seq, 0, 1728);
  bytes.flatMap((b) => lsbBits(b, 8)).forEach((b) => {
    pulse(seq, 1, 432);
    pulse(seq, 0, b ? 1296 : 432);
  });
  pulse(seq, 1, 432);
  pulse(seq, 0, 74736);
  return seqRaw(38000, seq);
}

async function text(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.text();
}

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

async function loadIndex() {
  const sources = [];
  if (sourceArg === 'all' || sourceArg === 'irdb') {
    const idx = await text(`${IRDB_BASE}index`);
    sources.push(...idx.replace(/\r/g, '').split('\n').map((x) => x.trim()).filter((x) => x.endsWith('.csv')).map((path) => ({ source: 'irdb', path })));
  }
  if (sourceArg === 'all' || sourceArg === 'flipper') {
    try {
      const tree = await json(FLIPPER_INDEX);
      sources.push(...(tree.tree || []).map((x) => x.path).filter((x) => x && x.endsWith('.ir')).map((path) => ({ source: 'flipper', path })));
    } catch (e) {
      console.log(`skip flipper index: ${e.message || e}`);
      if (sourceArg === 'flipper') throw e;
    }
  }
  if (sourceArg === 'all' || sourceArg === 'lirc') {
    try {
      let paths;
      const tree = await json(LIRC_INDEX);
      paths = (tree.tree || [])
        .filter((x) => x.type === 'blob')
        .map((x) => (x.path || '').replace(/^\//, ''));
      sources.push(...paths
        .filter((x) => x && x !== 'README.md' && !/\.(png|jpg|jpeg|gif|md|html)$/i.test(x))
        .map((path) => ({ source: 'lirc', path })));
    } catch (e1) {
      try {
        console.log(`fallback lirc index via jsDelivr: ${e1.message || e1}`);
        const tree = await json(LIRC_JSDELIVR_INDEX);
        const paths = (tree.files || []).map((x) => (x.name || '').replace(/^\//, ''));
        sources.push(...paths
          .filter((x) => x && x !== 'README.md' && !/\.(png|jpg|jpeg|gif|md|html)$/i.test(x))
          .map((path) => ({ source: 'lirc', path })));
      } catch (e2) {
        console.log(`skip lirc index: ${e2.message || e2}`);
        if (sourceArg === 'lirc') throw e2;
      }
    }
  }
  if (sourceArg === 'all' || sourceArg === 'smartir') {
    try {
      let paths;
      const tree = await json(SMARTIR_INDEX);
      paths = (tree.tree || [])
        .filter((x) => x.type === 'blob')
        .map((x) => (x.path || '').replace(/^\//, ''));
      sources.push(...paths
        .filter((x) => /^codes\/.+\.json$/i.test(x))
        .map((path) => ({ source: 'smartir', path })));
    } catch (e1) {
      try {
        console.log(`fallback smartir index via jsDelivr: ${e1.message || e1}`);
        const tree = await json(SMARTIR_JSDELIVR_INDEX);
        const paths = (tree.files || []).map((x) => (x.name || '').replace(/^\//, ''));
        sources.push(...paths
          .filter((x) => /^codes\/.+\.json$/i.test(x))
          .map((path) => ({ source: 'smartir', path })));
      } catch (e2) {
        console.log(`skip smartir index: ${e2.message || e2}`);
        if (sourceArg === 'smartir') throw e2;
      }
    }
  }
  if (!sources.length) throw new Error(`no database files loaded for source=${sourceArg}`);
  return sources;
}

async function parseEntry(entry) {
  let url;
  if (entry.source === 'irdb') url = `${IRDB_BASE}${entry.path}`;
  else if (entry.source === 'flipper') url = `${FLIPPER_BASE}${entry.path}`;
  else if (entry.source === 'lirc') url = `${LIRC_BASE}${entry.path}`;
  else if (entry.source === 'smartir') url = `${SMARTIR_BASE}${entry.path}`;
  else throw new Error(`unknown source ${entry.source}`);
  const body = await text(url);
  const rows = loadWebuiParser()(body, entry.source, entry.path);
  return { ...entry, url, rows };
}

function summarize(parsed) {
  const unsupported = new Map();
  let supported = 0;
  let compact = 0;
  let raw = 0;
  for (const row of parsed.rows) {
    if (row.keycode || row.raw) {
      supported++;
      if (row.raw) raw++;
      else compact++;
    } else {
      const key = row.protocol || row.meta || 'unknown';
      unsupported.set(key, (unsupported.get(key) || 0) + 1);
    }
  }
  return { supported, compact, raw, unsupported };
}

function payloadLines(parsed, limit) {
  return parsed.rows.filter((r) => r.keycode || r.raw).slice(0, limit).map((r) => {
    const name = safeImportName(r.name);
    return r.raw ? `${name}|raw|${r.raw}` : `${name}|${r.keycode}`;
  });
}

function pathProfile(path) {
  const bits = path.replace(/\.[^.]+$/, '').split(/[\\/]/).filter(Boolean);
  const model = bits[bits.length - 1] || 'Database Device';
  const manufacturer = bits.length >= 2 ? bits[bits.length - 2] : 'Database';
  return {
    manufacturer: manufacturer.replace(/[_-]+/g, ' ').slice(0, 64) || 'Database',
    model: model.replace(/[_-]+/g, ' ').slice(0, 64) || 'Database Device',
  };
}

async function postForm(path, data) {
  const body = new URLSearchParams(data);
  const r = await fetch(`${hub}${path}`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const bodyText = await r.text();
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}: ${bodyText.slice(0, 180)}`);
  return bodyText;
}

async function postJson(path, data) {
  const body = new URLSearchParams(data);
  const r = await fetch(`${hub}${path}`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const bodyText = await r.text();
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new Error(`${path} returned non-JSON: ${bodyText.slice(0, 180)}`);
  }
  if (!r.ok || parsed.ok === false) throw new Error(parsed.error || parsed.message || `${path} HTTP ${r.status}`);
  return parsed;
}

async function inventory() {
  const r = await fetch(`${hub}/api/inventory`);
  if (!r.ok) throw new Error(`/api/inventory HTTP ${r.status}`);
  return r.json();
}

async function configureParsed(parsed, index) {
  const lines = payloadLines(parsed, perDevice);
  if (!lines.length) return { configured: false, message: 'no supported commands to import' };
  const profile = pathProfile(parsed.path);
  const name = `Smoke ${index + 1} ${profile.manufacturer} ${profile.model}`.replace(/\s+/g, ' ').slice(0, 96);
  await postForm('/ir/new-device', {
    name,
    manufacturer: profile.manufacturer,
    model: profile.model,
    type: 'HomeAppliance',
  });
  const inv = await inventory();
  const device = (inv.devices || []).find((d) => d.name === name);
  if (!device) throw new Error(`created device not found in inventory: ${name}`);
  const result = await postJson('/api/irdb-import', { deviceId: device.id, payload: lines.join('\n') });
  return { configured: true, deviceId: device.id, name, message: result.message || '' };
}

async function main() {
  console.log(`seed=${seedText} source=${sourceArg} sample=${sampleCount} perDevice=${perDevice} configure=${doConfigure} dryRun=${doDryRun}`);
  const index = await loadIndex();
  console.log(`loaded ${index.length} database file entries`);
  let sample = pickMany(index, sampleCount);
  if (pathFilters.length) {
    sample = [];
    for (const filter of pathFilters) {
      const found = index.find((entry) => entry.path.toLowerCase() === filter)
        || index.find((entry) => entry.path.toLowerCase().includes(filter));
      if (!found) throw new Error(`path filter did not match a database file: ${filter}`);
      sample.push(found);
    }
  }
  const report = [];
  const totals = { files: 0, rows: 0, supported: 0, compact: 0, raw: 0, configured: 0 };
  const protocolGaps = new Map();
  for (let i = 0; i < sample.length; i++) {
    const entry = sample[i];
    try {
      const parsed = await parseEntry(entry);
      const sum = summarize(parsed);
      totals.files++;
      totals.rows += parsed.rows.length;
      totals.supported += sum.supported;
      totals.compact += sum.compact;
      totals.raw += sum.raw;
      for (const [k, v] of sum.unsupported.entries()) protocolGaps.set(k, (protocolGaps.get(k) || 0) + v);
      let config = { configured: false, message: doDryRun ? 'dry-run' : '' };
      if (doConfigure) {
        config = await configureParsed(parsed, i);
        if (config.configured) totals.configured++;
      }
      report.push({ entry, sum, config });
      const unsupported = parsed.rows.length - sum.supported;
      console.log(`${i + 1}. ${entry.source} ${entry.path}: rows=${parsed.rows.length} supported=${sum.supported} compact=${sum.compact} raw=${sum.raw} unsupported=${unsupported}${config.configured ? ` -> ${config.name} (${config.deviceId})` : ''}`);
      if (showUnsupported && unsupported) {
        const examples = parsed.rows
          .filter((row) => !(row.raw || row.keycode))
          .slice(0, 8)
          .map((row) => `${row.name || '(unnamed)'} / ${row.protocol || row.meta || 'unknown'}`);
        console.log(`   unsupported examples: ${examples.join(' | ')}`);
      }
    } catch (e) {
      console.log(`${i + 1}. ${entry.source} ${entry.path}: ERROR ${e.message || e}`);
      report.push({ entry, error: String(e.message || e) });
    }
  }
  console.log('\nsummary');
  console.log(JSON.stringify(totals, null, 2));
  const gaps = Array.from(protocolGaps.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (gaps.length) {
    console.log('\nunsupported protocols / parser gaps');
    for (const [name, count] of gaps) console.log(`${String(name).padEnd(24)} ${count}`);
  }
}

main().catch((e) => {
  console.error(e.stack || e.message || e);
  process.exit(1);
});
