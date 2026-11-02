#!/usr/bin/env node
/**
 * balik-muatan-pci.mjs — memindahkan muatan survei PCI (pci_score, pci_rating, distresses) ke unit seberang:
 *
 *   muatan unit k  <-  muatan unit N + 1 - k        N = 300 (06/24), 360 (07L/25R)
 *
 * Geometri, `id`, `square_id`, dan `sampleUnit` tiap fitur TIDAK berubah: nomor unit tetap menunjuk lokasi
 * yang sama (unit 1 di ujung 06 / 07L, docs/penomoran-unit.md). Yang pindah hanya nilai survei.
 *
 * Alasannya (docs/penomoran-unit.md, bagian "Arah muatan PCI"): tekstur makro LCMS Juni 2026, yang
 * berasal dari survei LCMS yang sama dengan PCI 2026 dan berposisi GPS, hanya sejalan dengan raveling
 * kalau muatan berkas-berkas di bawah dibalik.
 *
 * Berkas yang dibalik (TARGET di bawah):
 *   RWY 06/24   : 2026                          (2025 sudah searah GPS; 2023-2024 nyaris tanpa kerusakan)
 *   RWY 07L/25R : 2020, 2021, 2022, 2023, 2024, 2025, 2026   (satu blok yang saling searah)
 *
 * Pemakaian:
 *   node scripts/balik-muatan-pci.mjs                    cek (bawaan): cetak rencana dan uji, tidak menulis
 *   node scripts/balik-muatan-pci.mjs --write            tulis
 *   node scripts/balik-muatan-pci.mjs --undo             cek pengembalian
 *   node scripts/balik-muatan-pci.mjs --undo --write     kembalikan ke keadaan sebelum dibalik
 *   --tekstur-06-24 <csv>  --tekstur-07L-25R <csv>       (opsional) uji jangkar GPS dengan CSV
 *                                                        "LCMS Texture Processed"; --write ditolak kalau
 *                                                        uji itu tidak mendukung pembalikan
 *   --root <dir>                                         akar repo lain (bawaan: repo ini)
 *
 * Berkas yang sudah dibalik membawa penanda "muatan_pci_dibalik" di tingkat atas, jadi menjalankan
 * --write dua kali tidak membalik ulang, dan --undo hanya menyentuh berkas yang bertanda.
 * Berkas disunting sebagai TEKS (seperti renumber-units.mjs), jadi spasi dan ejaan angka tetap persis.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const RUNWAYS = { '06-24': { n: 300 }, '07L-25R': { n: 360 } };
const TARGET = { '06-24': [2026], '07L-25R': [2020, 2021, 2022, 2023, 2024, 2025, 2026] };
const ALL_YEARS = { '06-24': [2023, 2024, 2025, 2026], '07L-25R': [2020, 2021, 2022, 2023, 2024, 2025, 2026] };
const ANCHOR_YEAR = 2026; // tahun survei LCMS yang sama dengan CSV tekstur
const MARKER_KEY = 'muatan_pci_dibalik';
const MARKER = {
  rumus: 'muatan unit k diambil dari unit N + 1 - k; geometri dan nomor unit tetap',
  alasan: 'tekstur makro LCMS Juni 2026 (posisi GPS) hanya sejalan dengan raveling bila muatan dibalik',
  tanggal: '2026-11-02',
  dokumen: 'docs/penomoran-unit.md',
};
const ID_KEYS = ['square_id', 'sampleUnit'];

// ---------------------------------------------------------------- penyuntingan teks JSON (sama dengan renumber-units.mjs)

const ws = (t, i) => { while (' \t\r\n'.includes(t[i]) && i < t.length) i++; return i; };

function endOfValue(t, i) {
  const c = t[i];
  if (c === '"') { for (i++; t[i] !== '"'; i += t[i] === '\\' ? 2 : 1); return i + 1; }
  if (c === '{' || c === '[') {
    const close = c === '{' ? '}' : ']';
    i = ws(t, i + 1);
    while (t[i] !== close) {
      if (c === '{') i = ws(t, ws(t, endOfValue(t, i)) + 1);
      i = ws(t, endOfValue(t, i));
      if (t[i] === ',') i = ws(t, i + 1);
    }
    return i + 1;
  }
  const m = /-?\d[\d.eE+-]*|true|false|null/y;
  m.lastIndex = i;
  if (!m.exec(t)) throw new Error(`JSON tidak terbaca di indeks ${i}`);
  return m.lastIndex;
}

function children(t, i) {
  const isObj = t[i] === '{', close = isObj ? '}' : ']', out = [];
  i = ws(t, i + 1);
  while (t[i] !== close) {
    let key = null;
    const ks = i;
    if (isObj) { const ke = endOfValue(t, i); key = JSON.parse(t.slice(i, ke)); i = ws(t, ws(t, ke) + 1); }
    const e = endOfValue(t, i);
    out.push({ key, ks, s: i, e });
    i = ws(t, e);
    if (t[i] === ',') i = ws(t, i + 1);
  }
  return out;
}

function at(t, ...path) {
  let node = { s: ws(t, 0), e: t.length };
  for (const p of path) {
    const kids = children(t, node.s);
    node = typeof p === 'number' ? kids[p] : kids.find((k) => k.key === p);
    if (!node) return undefined;
  }
  return node;
}

const applyEdits = (t, edits) => [...edits].sort((a, b) => b.s - a.s).reduce((x, d) => x.slice(0, d.s) + d.text + x.slice(d.e), t);

/** Ganti nilai nomor di `path` dengan `unit`, dengan tipe dan lebar yang sama (300 -> 1, '001' -> '300'). */
function setId(t, unit, ...path) {
  const c = at(t, ...path);
  if (!c) return t;
  const v = JSON.parse(t.slice(c.s, c.e));
  let text;
  if (typeof v === 'number' && Number.isInteger(v)) text = String(unit);
  else if (typeof v === 'string' && /^\d+$/.test(v)) text = JSON.stringify(String(unit).padStart(v.length, '0'));
  else throw new Error(`nomor ${t.slice(c.s, c.e)} bukan bilangan bulat`);
  return applyEdits(t, [{ ...c, text }]);
}

/** Balik muatan di teks berkas: properti fitur unit k diganti properti fitur unit N+1-k, lalu nomornya dikembalikan ke k. */
function flipText(t, n) {
  const feats = children(t, at(t, 'features').s);
  const texts = feats.map((c) => t.slice(c.s, c.e));
  const unitOf = (ft) => JSON.parse(ft.slice(at(ft, 'properties', 'sampleUnit').s, at(ft, 'properties', 'sampleUnit').e));
  const byUnit = new Map(texts.map((ft) => [unitOf(ft), ft]));
  if (byUnit.size !== n) throw new Error(`${byUnit.size} unit unik, seharusnya ${n}`);
  const edits = feats.map((c, i) => {
    const own = texts[i], k = unitOf(own);
    const partner = byUnit.get(n + 1 - k);
    if (!partner) throw new Error(`unit ${n + 1 - k} tidak ada`);
    const pp = at(partner, 'properties');
    let props = partner.slice(pp.s, pp.e);
    for (const key of ID_KEYS) props = setId(props, k, key);
    const op = at(own, 'properties');
    return { s: c.s, e: c.e, text: applyEdits(own, [{ ...op, text: props }]) };
  });
  return applyEdits(t, edits);
}

/** Tambah penanda sebagai anggota pertama objek akar. */
function addMarker(t) {
  const root = ws(t, 0);
  const first = children(t, root)[0];
  const sep = t.slice(root + 1, first.ks); // pertahankan spasi sesudah '{'
  return t.slice(0, root + 1) + sep + `${JSON.stringify(MARKER_KEY)}: ${JSON.stringify(MARKER)}, ` + t.slice(first.ks);
}

function removeMarker(t) {
  const kids = children(t, ws(t, 0));
  const i = kids.findIndex((k) => k.key === MARKER_KEY);
  if (i < 0) return t;
  const end = i + 1 < kids.length ? kids[i + 1].ks : kids[i].e;
  const start = i + 1 < kids.length ? kids[i].ks : (i > 0 ? kids[i - 1].e : kids[i].ks);
  return t.slice(0, start) + t.slice(end);
}

// ---------------------------------------------------------------- pemeriksaan

const payload = (f) => Object.fromEntries(Object.entries(f.properties).filter(([k]) => !ID_KEYS.includes(k)));
const byUnit = (j) => new Map(j.features.map((f) => [f.properties.sampleUnit, f]));

/** Hasil tulis harus: geometri, id, nomor sama dengan sebelum; muatan unit k = muatan lama unit N+1-k. */
function verifyFlip(before, after, n) {
  const B = byUnit(before), A = byUnit(after);
  if (A.size !== n || B.size !== n) throw new Error('jumlah unit berubah');
  for (let k = 1; k <= n; k++) {
    const a = A.get(k), b = B.get(k), p = B.get(n + 1 - k);
    if (!isDeepStrictEqual(a.geometry, b.geometry)) throw new Error(`geometri unit ${k} berubah`);
    if (a.id !== b.id) throw new Error(`id unit ${k} berubah`);
    for (const key of ID_KEYS) if (a.properties[key] !== b.properties[key]) throw new Error(`${key} unit ${k} berubah`);
    if (!isDeepStrictEqual(payload(a), payload(p))) throw new Error(`muatan unit ${k} bukan muatan lama unit ${n + 1 - k}`);
  }
}

function pearson(x, y) {
  const m = x.length, mx = x.reduce((a, b) => a + b, 0) / m, my = y.reduce((a, b) => a + b, 0) / m;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < m; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}
const ranks = (v) => {
  const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), r = new Array(v.length);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let q = i; q <= j; q++) r[idx[q][1]] = (i + j) / 2; i = j + 1; }
  return r;
};
const spearman = (x, y) => pearson(ranks(x), ranks(y));
const fmt = (v) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : '  -   ');

const pciArray = (j, n) => { const U = byUnit(j); return Array.from({ length: n }, (_, i) => Number(U.get(i + 1).properties.pci_score)); };
const ravelArray = (j, n) => {
  const U = byUnit(j);
  return Array.from({ length: n }, (_, i) => (U.get(i + 1).properties.distresses ?? [])
    .filter((d) => /ravel/i.test(d.type)).reduce((a, d) => a + Number(d.quantity), 0));
};

// ---------------------------------------------------------------- tekstur LCMS (opsional)

function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/** MPD rata-rata per unit (array indeks unit-1), posisi dari poligon AvgGeoJSON tiap segmen 10 m. */
function textureByUnit(csvPath, unitsJson, n) {
  const rows = parseCsv(readFileSync(csvPath, 'utf8').replace(/^﻿/, ''));
  const h = rows[0], iG = h.indexOf('AvgGeoJSON'), iM = h.indexOf('AvgMPD');
  if (iG < 0 || iM < 0) throw new Error(`${csvPath}: kolom AvgGeoJSON / AvgMPD tidak ada`);
  const U = byUnit(unitsJson);
  const cen = (g) => { const r = (g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]).slice(0, -1); return [r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length]; };
  const C = Array.from({ length: n }, (_, i) => cen(U.get(i + 1).geometry));
  const k = (Math.PI / 180) * 6371000, lat0 = C[0][1];
  const xy = (p) => [(p[0] - C[0][0]) * k * Math.cos((lat0 * Math.PI) / 180), (p[1] - C[0][1]) * k];
  const P = C.map(xy), L = Math.hypot(...P[n - 1]), t = [P[n - 1][0] / L, P[n - 1][1] / L], nrm = [-t[1], t[0]];
  const S = P.map((p) => p[0] * t[0] + p[1] * t[1]);
  const offMid = P.map((p) => p[0] * nrm[0] + p[1] * nrm[1]).sort((a, b) => a - b)[n >> 1];
  const sum = new Array(n).fill(0), cnt = new Array(n).fill(0);
  for (const r of rows.slice(1)) {
    if (r.length <= Math.max(iG, iM)) continue;
    const mpd = Number(r[iM]);
    if (!(mpd > 0)) continue;
    let g; try { g = JSON.parse(r[iG]).geometry; } catch { continue; }
    const p = xy(cen(g)), s = p[0] * t[0] + p[1] * t[1], o = p[0] * nrm[0] + p[1] * nrm[1] - offMid;
    if (s < S[0] - 5.5 || s > S[n - 1] + 5.5 || Math.abs(o) > 30) continue;
    let best = 0; for (let i = 1; i < n; i++) if (Math.abs(S[i] - s) < Math.abs(S[best] - s)) best = i;
    sum[best] += mpd; cnt[best]++;
  }
  return sum.map((v, i) => (cnt[i] ? v / cnt[i] : NaN));
}

/** Spearman MPD lawan raveling (dan lawan PCI): susunan sekarang vs kalau muatan dibalik. */
function textureTest(mpd, j, n) {
  const ok = mpd.map((v) => Number.isFinite(v));
  const pick = (a) => a.filter((_, i) => ok[i]);
  const rav = ravelArray(j, n), pci = pciArray(j, n), m = pick(mpd);
  return {
    ravNow: spearman(m, pick(rav)), ravFlip: spearman(m, pick([...rav].reverse())),
    pciNow: spearman(m, pick(pci)), pciFlip: spearman(m, pick([...pci].reverse())),
    hasRavel: rav.some((v) => v > 0),
  };
}

// ---------------------------------------------------------------- utama

function args() {
  const a = { write: false, undo: false, root: join(dirname(fileURLToPath(import.meta.url)), '..'), tekstur: {} };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '--write') a.write = true;
    else if (v[i] === '--undo') a.undo = true;
    else if (v[i] === '--check') a.write = false;
    else if (v[i] === '--root') a.root = v[++i];
    else if (v[i] === '--tekstur-06-24') a.tekstur['06-24'] = v[++i];
    else if (v[i] === '--tekstur-07L-25R') a.tekstur['07L-25R'] = v[++i];
    else { console.error(`Argumen tidak dikenal: ${v[i]}`); process.exit(2); }
  }
  return a;
}

function main() {
  const a = args();
  const fileOf = (rw, y) => join(a.root, 'public', 'data', `runway-${rw}-units-${y}.json`);
  let problems = 0;
  const pending = [];

  for (const [rw, { n }] of Object.entries(RUNWAYS)) {
    console.log(`\n=== RWY ${rw.replace('-', '/')} (N = ${n}) ===`);
    const now = {}, next = {};
    for (const y of ALL_YEARS[rw]) {
      const f = fileOf(rw, y);
      if (!existsSync(f)) { console.log(`  ${y}: berkas tidak ada, dilewati`); continue; }
      const text = readFileSync(f, 'utf8'), j = JSON.parse(text);
      now[y] = j; next[y] = j;
      const marked = MARKER_KEY in j;
      const target = TARGET[rw].includes(y);
      const sets = new Set(j.features.map((ft) => ft.properties.sampleUnitSet));
      if (sets.size > 1) { console.log(`  ${y}: sampleUnitSet berbeda antar unit, berkas dilewati`); problems++; continue; }

      let action = 'tetap';
      if (!a.undo && target && !marked) action = 'balik';
      if (!a.undo && target && marked) action = 'sudah dibalik, dilewati';
      if (a.undo && marked) action = 'kembalikan';
      if (a.undo && !marked) action = 'tidak bertanda, dilewati';
      if (!target && marked) action = a.undo ? 'kembalikan' : 'bertanda tapi bukan target (periksa)';

      if (action === 'balik' || action === 'kembalikan') {
        let out = flipText(text, n);
        out = action === 'balik' ? addMarker(out) : removeMarker(out);
        const after = JSON.parse(out);
        verifyFlip(j, after, n);
        if (action === 'balik' && !(MARKER_KEY in after)) throw new Error('penanda gagal ditambahkan');
        if (action === 'kembalikan' && MARKER_KEY in after) throw new Error('penanda gagal dihapus');
        next[y] = after;
        pending.push({ rw, y, file: f, out });
      }
      const U = byUnit(j);
      console.log(`  ${y}: ${action.padEnd(24)} unit 1 PCI ${U.get(1).properties.pci_score}, unit ${n} PCI ${U.get(n).properties.pci_score}` +
        (action === 'balik' || action === 'kembalikan' ? `  ->  unit 1 PCI ${byUnit(next[y]).get(1).properties.pci_score}, unit ${n} PCI ${byUnit(next[y]).get(n).properties.pci_score}` : ''));
    }

    // korelasi PCI antar tahun berurutan, sebelum dan sesudah
    const ys = Object.keys(now).map(Number).sort();
    console.log('  Korelasi PCI tahun berurutan (Pearson)   sekarang   sesudah');
    for (let i = 1; i < ys.length; i++) {
      const p0 = pearson(pciArray(now[ys[i - 1]], n), pciArray(now[ys[i]], n));
      const p1 = pearson(pciArray(next[ys[i - 1]], n), pciArray(next[ys[i]], n));
      const flag = p1 < 0 ? '   <- negatif' : '';
      console.log(`    ${ys[i - 1]}-${ys[i]}                               ${fmt(p0)}     ${fmt(p1)}${flag}`);
    }

    // jangkar GPS (opsional)
    const csv = a.tekstur[rw];
    if (csv) {
      if (!existsSync(csv)) { console.log(`  CSV tekstur tidak ditemukan: ${csv}`); problems++; }
      else {
        const mpd = textureByUnit(csv, now[ANCHOR_YEAR], n);
        console.log(`  Uji jangkar GPS (tekstur LCMS, ${mpd.filter(Number.isFinite).length} unit berisi):`);
        console.log('    harapan fisik: MPD ~ raveling POSITIF, MPD ~ PCI NEGATIF');
        let support = 0, against = 0;
        for (const y of ys) {
          const r = textureTest(mpd, next[y], n);
          const line = `    ${y} sesudah: MPD~PCI ${fmt(r.pciNow)}` + (r.hasRavel ? `   MPD~raveling ${fmt(r.ravNow)}` : '   (tanpa raveling)');
          console.log(line);
          if (r.hasRavel) { if (r.ravNow > 0.3) support++; else if (r.ravNow < 0) against++; }
        }
        if (against > 0) {
          console.log('  !! Ada berkas yang sesudah perubahan berkorelasi NEGATIF dengan tekstur. Penulisan untuk runway ini dibatalkan.');
          for (let i = pending.length - 1; i >= 0; i--) if (pending[i].rw === rw) pending.splice(i, 1);
          problems++;
        } else console.log(`  Jangkar GPS mendukung susunan sesudah (${support} berkas ber-raveling berkorelasi positif).`);
      }
    }
  }

  console.log('');
  if (!pending.length) { console.log('Tidak ada berkas yang perlu ditulis.'); process.exit(problems ? 1 : 0); }
  if (!a.write) {
    console.log(`Mode cek: ${pending.length} berkas AKAN ${a.undo ? 'dikembalikan' : 'dibalik'}. Jalankan lagi dengan --write untuk menulis.`);
    process.exit(problems ? 1 : 0);
  }
  for (const p of pending) { writeFileSync(p.file, p.out); console.log(`ditulis: ${relative(a.root, p.file)}`); }
  console.log(`\n${pending.length} berkas ${a.undo ? 'dikembalikan' : 'dibalik'}. Jalankan "npm test" untuk memeriksa.`);
  process.exit(problems ? 1 : 0);
}

main();
