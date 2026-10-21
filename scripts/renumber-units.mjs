#!/usr/bin/env node
/**
 * renumber-units.mjs — unit 1 pindah ke ujung ambang 06 (RWY 06/24) dan 07L (RWY 07L/25R).
 *
 *   id_baru = N + 1 - id_lama      N = 300 (06/24), 360 (07L/25R)
 *
 * Hanya label nomor dan urutan baris/array yang berubah. Poligon, PCI, distress, mu, dan nilai lain
 * tidak disentuh, termasuk stasiun (station_*_m, s0_m, starts_m) yang tetap diukur dari ambang 24 / 25R.
 * Berkas disunting sebagai TEKS (bukan parse lalu tulis ulang), jadi spasi, CRLF, dan ejaan angka
 * ("2400.0", "0.0") tetap persis.
 *
 *   node scripts/renumber-units.mjs            --check (bawaan): tidak menulis apa pun
 *   node scripts/renumber-units.mjs --write    tulis, hanya kalau semua berkas satu runway berarah sama
 *   --root <dir>                               akar repo lain (bawaan: repo ini)
 *
 * Arah tiap berkas ditentukan dari geometri (bujur centroid unit 1 vs unit N; barat = ujung 06 / 07L).
 * Berkas yang sudah barat-dulu dilewati, jadi menjalankan skrip dua kali tidak membalik ulang.
 */
import { readFileSync, writeFileSync, readdirSync, chmodSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const RUNWAYS = { '06-24': { n: 300, west: '06', east: '24' }, '07L-25R': { n: 360, west: '07L', east: '25R' } };
const POLY_TOL = 1e-7; // derajat, geometri unit k antar tahun
const CENTROID_TOL_M = 2; // centroid skid vs poligon web

// ---------------------------------------------------------------- penyuntingan teks JSON

const ws = (t, i) => { while (' \t\r\n'.includes(t[i]) && i < t.length) i++; return i; };

/** Indeks tepat setelah nilai JSON yang dimulai di i. */
function endOfValue(t, i) {
  const c = t[i];
  if (c === '"') { for (i++; t[i] !== '"'; i += t[i] === '\\' ? 2 : 1); return i + 1; }
  if (c === '{' || c === '[') {
    const close = c === '{' ? '}' : ']';
    i = ws(t, i + 1);
    while (t[i] !== close) {
      if (c === '{') i = ws(t, ws(t, endOfValue(t, i)) + 1); // kunci lalu ':'
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

/** Anak langsung dari objek/array yang dimulai di i: [{ key, s, e }] (s..e = teks nilai). */
function children(t, i) {
  const isObj = t[i] === '{', close = isObj ? '}' : ']', out = [];
  i = ws(t, i + 1);
  while (t[i] !== close) {
    let key = null;
    if (isObj) { const ke = endOfValue(t, i); key = JSON.parse(t.slice(i, ke)); i = ws(t, ws(t, ke) + 1); }
    const e = endOfValue(t, i);
    out.push({ key, s: i, e });
    i = ws(t, e);
    if (t[i] === ',') i = ws(t, i + 1);
  }
  return out;
}

/** Nilai di jalur (kunci objek atau indeks array), mulai dari teks akar t. */
function at(t, ...path) {
  let node = { s: ws(t, 0), e: t.length };
  for (const p of path) {
    const kids = children(t, node.s);
    node = typeof p === 'number' ? kids[p] : kids.find((k) => k.key === p);
    if (!node) return undefined;
  }
  return node;
}
const val = (t, ...path) => { const c = at(t, ...path); return JSON.parse(t.slice(c.s, c.e)); };

const applyEdits = (t, edits) => [...edits].sort((a, b) => b.s - a.s).reduce((x, d) => x.slice(0, d.s) + d.text + x.slice(d.e), t);

/** Nomor baru dengan tipe dan lebar yang sama: 300 -> 1, '300' -> '1', '001' -> '300'. */
function mapId(valueText, n) {
  const v = JSON.parse(valueText);
  if (typeof v === 'number' && Number.isInteger(v)) return String(n + 1 - v);
  if (typeof v === 'string' && /^\d+$/.test(v)) return JSON.stringify(String(n + 1 - Number(v)).padStart(v.length, '0'));
  throw new Error(`ID ${valueText} bukan bilangan bulat`);
}

/** Ganti nomor di tiap jalur yang ada (jalur yang tidak ada dilewati, misalnya `id` di beberapa berkas 2024/2025). */
const renumberAt = (t, n, ...paths) => applyEdits(t, paths.map((p) => at(t, ...p)).filter(Boolean).map((c) => ({ ...c, text: mapId(t.slice(c.s, c.e), n) })));

/** Susun ulang elemen array di `arrStart`: tiap elemen diubah `fn(teks) -> teks`, lalu diurutkan naik menurut `keyOf`
 *  (atau dibalik bila keyOf null). Pemisah antar elemen tetap di posisinya. Mengembalikan satu edit. */
function rewriteArray(t, arrStart, fn, keyOf) {
  const els = children(t, arrStart);
  const seps = els.slice(1).map((c, i) => t.slice(els[i].e, c.s));
  let pieces = els.map((c) => fn(t.slice(c.s, c.e)));
  pieces = keyOf ? pieces.sort((a, b) => keyOf(a) - keyOf(b)) : pieces.reverse();
  return { s: els[0].s, e: els.at(-1).e, text: pieces.map((p, i) => p + (seps[i] ?? '')).join('') };
}

// ---------------------------------------------------------------- geometri

const ringOf = (g) => (g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]).slice(0, -1);
const centroid = (g) => { const r = ringOf(g); return [r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length]; };
const metres = (a, b) => { const k = (Math.PI / 180) * 6371008.8; return Math.hypot((b[0] - a[0]) * k * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * k); };
const eastFirst = (lon1, lonN) => (lon1 > lonN ? 'timur-dulu' : 'barat-dulu');

// ---------------------------------------------------------------- jenis berkas

const KINDS = {
  /** runway-<rw>-units-<tahun>.json: id (bila ada), properties.square_id, properties.sampleUnit */
  geo: {
    state(j, rw) {
      const n = RUNWAYS[rw].n, F = j.features;
      if (F.length !== n) throw new Error(`${F.length} fitur, seharusnya ${n}`);
      const ids = F.map((f) => f.properties.sampleUnit).sort((a, b) => a - b);
      if (!ids.every((v, i) => v === i + 1)) throw new Error('sampleUnit bukan 1..N');
      for (const f of F) if (f.properties.square_id !== f.properties.sampleUnit || (f.id !== undefined && f.id !== f.properties.sampleUnit)) throw new Error(`id/square_id/sampleUnit berbeda di unit ${f.properties.sampleUnit}`);
      const by = (u) => F.find((f) => f.properties.sampleUnit === u).geometry;
      return eastFirst(centroid(by(1))[0], centroid(by(n))[0]);
    },
    convert(t, rw) {
      const n = RUNWAYS[rw].n;
      const fix = (ft) => renumberAt(ft, n, ['id'], ['properties', 'square_id'], ['properties', 'sampleUnit']);
      return applyEdits(t, [rewriteArray(t, at(t, 'features').s, fix, (ft) => val(ft, 'properties', 'sampleUnit'))]);
    },
    /** rekaman tanpa medan nomor, per nomor unit */
    records(j) {
      return new Map(j.features.map((f) => {
        const { id, ...rest } = f, { square_id, sampleUnit, ...props } = f.properties;
        return [sampleUnit, { ...rest, properties: props }];
      }));
    },
  },

  /** skid-<rw>-2026.json: units[].unit, coverage.first_unit/last_unit, unit_numbering */
  skid: {
    state(j, rw) {
      const n = RUNWAYS[rw].n, U = j.units;
      if (U.length !== n || !U.every((u, i) => u.unit === i + 1)) throw new Error('units bukan 1..N berurutan');
      return eastFirst(U[0].centroid_lonlat[0], U[n - 1].centroid_lonlat[0]);
    },
    convert(t, rw) {
      const n = RUNWAYS[rw].n, { west, east } = RUNWAYS[rw];
      const first = at(t, 'coverage', 'first_unit'), last = at(t, 'coverage', 'last_unit');
      return applyEdits(t, [
        rewriteArray(t, at(t, 'units').s, (u) => renumberAt(u, n, ['unit']), (u) => val(u, 'unit')),
        { ...first, text: mapId(t.slice(last.s, last.e), n) }, // first_unit baru = N+1-last_unit lama
        { ...last, text: mapId(t.slice(first.s, first.e), n) },
        { ...at(t, 'unit_numbering'), text: JSON.stringify(`Mengikuti web APMS: unit 1 di ujung ambang ${west}; station_*_m diukur dari ambang ${east} (bukan dari unit 1)`) },
      ]);
    },
    records: (j) => new Map(j.units.map(({ unit, ...rest }) => [unit, rest])),
  },
};

/** skid-<rw>-2026-1m.json (unit_bounds + reconciliation) dan runways.<rw> di skid-unit-stations-2026.json:
 *  array menurut posisi (indeks = nomor unit - 1), jadi cukup dibalik. */
for (const kind of ['skid1m', 'stations']) {
  KINDS[kind] = {
    root: (j, rw) => (kind === 'skid1m' ? j.unit_bounds : j.runways[rw]),
    state(j, rw, ctx) {
      const b = this.root(j, rw), s = b.starts_m;
      if (s.length !== RUNWAYS[rw].n || b.window_mid_m.length !== s.length) throw new Error('panjang starts_m/window_mid_m salah');
      const unit1AtZero = s[0] < s.at(-1); // unit 1 di ujung stasiun 0?
      const zeroIsEast = ctx.zeroEnd[rw];
      if (zeroIsEast === undefined) return 'tak-tentu';
      return unit1AtZero === zeroIsEast ? 'timur-dulu' : 'barat-dulu';
    },
    convert(t, rw) {
      const base = kind === 'skid1m' ? ['unit_bounds'] : ['runways', rw];
      const edits = ['starts_m', 'window_mid_m'].map((k) => rewriteArray(t, at(t, ...base, k).s, (x) => x, null));
      if (kind === 'skid1m') { // "unit 114 L6.0: ..." di reconciliation.edge_cases
        for (const c of children(t, at(t, 'reconciliation', 'edge_cases').s)) {
          edits.push({ ...c, text: t.slice(c.s, c.e).replace(/\bunit (\d+)\b/g, (_, d) => `unit ${RUNWAYS[rw].n + 1 - Number(d)}`) });
        }
      }
      return applyEdits(t, edits);
    },
    records(j, rw) { const b = this.root(j, rw); return new Map([['starts_m', b.starts_m], ['window_mid_m', b.window_mid_m]]); },
  };
}

// ---------------------------------------------------------------- daftar berkas

function discover(root) {
  const out = [], data = join(root, 'public/data');
  for (const f of readdirSync(data)) {
    let m;
    if ((m = /^runway-(.+)-units-\d{4}\.json$/.exec(f)) && RUNWAYS[m[1]]) out.push({ kind: 'geo', rw: m[1], path: join(data, f) });
    else if ((m = /^skid-(.+)-2026\.json$/.exec(f)) && RUNWAYS[m[1]]) out.push({ kind: 'skid', rw: m[1], path: join(data, f) });
    else if ((m = /^skid-(.+)-2026-1m\.json$/.exec(f)) && RUNWAYS[m[1]]) out.push({ kind: 'skid1m', rw: m[1], path: join(data, f) });
  }
  const st = join(root, 'scripts/skid/skid-unit-stations-2026.json');
  if (existsSync(st)) for (const rw of Object.keys(RUNWAYS)) out.push({ kind: 'stations', rw, path: st });
  return out;
}

// ---------------------------------------------------------------- jalankan

function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const root = argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : join(dirname(fileURLToPath(import.meta.url)), '..');
  const entries = discover(root);
  const rel = (p) => relative(root, p).replaceAll('\\', '/');
  const text = new Map(), problems = [];
  for (const e of entries) if (!text.has(e.path)) text.set(e.path, readFileSync(e.path, 'utf8'));

  // ujung stasiun 0 menurut berkas skid per unit: timur atau barat (dipakai skid1m dan stations)
  const ctx = { zeroEnd: {} };
  for (const e of entries.filter((x) => x.kind === 'skid')) {
    const U = JSON.parse(text.get(e.path)).units, byStation = [...U].sort((a, b) => a.station_start_m - b.station_start_m);
    ctx.zeroEnd[e.rw] = byStation[0].centroid_lonlat[0] > byStation.at(-1).centroid_lonlat[0];
  }

  // 1. arah tiap berkas
  const parsed = new Map();
  for (const e of entries) {
    try {
      if (!parsed.has(e.path)) parsed.set(e.path, JSON.parse(text.get(e.path)));
      e.state = KINDS[e.kind].state(parsed.get(e.path), e.rw, ctx);
    } catch (err) { e.state = 'tak-tentu'; e.error = err.message; }
  }
  console.log('Arah awal tiap berkas (ujung 06 / 07L = barat):');
  for (const e of entries) console.log(`  ${e.rw.padEnd(8)} ${rel(e.path).padEnd(52)} ${e.kind === 'stations' ? '(runways.' + e.rw + ') ' : ''}${e.state}${e.error ? '  <- ' + e.error : ''}`);

  // 2. geometri antar tahun (U2) dan skid vs poligon (U3)
  for (const rw of Object.keys(RUNWAYS)) {
    const geos = entries.filter((e) => e.kind === 'geo' && e.rw === rw && e.state !== 'tak-tentu');
    const base = geos[0] && KINDS.geo.records(parsed.get(geos[0].path));
    for (const e of geos.slice(1)) {
      for (const [u, rec] of KINDS.geo.records(parsed.get(e.path))) {
        const a = rec.geometry.coordinates.flat(3), b = base.get(u).geometry.coordinates.flat(3);
        if (a.length !== b.length || a.some((v, i) => Math.abs(v - b[i]) > POLY_TOL)) problems.push(`${rw}: poligon unit ${u} di ${rel(e.path)} beda dari ${rel(geos[0].path)}`);
      }
    }
    const skid = entries.find((e) => e.kind === 'skid' && e.rw === rw), geo26 = geos.find((e) => /-2026\.json$/.test(e.path));
    if (skid && geo26 && skid.state === geo26.state) {
      const g = KINDS.geo.records(parsed.get(geo26.path));
      for (const u of parsed.get(skid.path).units) if (metres(u.centroid_lonlat, centroid(g.get(u.unit).geometry)) > CENTROID_TOL_M) problems.push(`${rw}: centroid skid unit ${u.unit} meleset dari poligon ${rel(geo26.path)}`);
    } else if (skid && geo26) problems.push(`${rw}: skid (${skid.state}) dan unit 2026 (${geo26.state}) berbeda arah`);
  }

  // 3. kondisi per runway
  const todo = [];
  for (const rw of Object.keys(RUNWAYS)) {
    const states = new Set(entries.filter((e) => e.rw === rw).map((e) => e.state));
    if (states.has('tak-tentu')) problems.push(`${rw}: ada berkas yang arahnya tak bisa ditentukan; tidak diubah otomatis, tanyakan ke user`);
    else if (states.size > 1) problems.push(`${rw}: arah berkas CAMPUR (${[...states].join(', ')}); jangan --write sebelum user mengonfirmasi (kemungkinan bukan basis kode yang di-deploy)`);
    else if (states.has('timur-dulu')) todo.push(rw);
    else console.log(`${rw}: semua berkas sudah barat-dulu, dilewati.`);
  }
  if (problems.length) { console.log('\nMASALAH:'); problems.forEach((p) => console.log('  - ' + p)); }

  // 4. konversi + pemeriksaan I1 (rekaman identik, hanya nomor yang tukar) dan tabel invarian
  const out = new Map(text), blocked = new Set(problems.map((p) => p.split(':')[0]));
  const rows = [];
  for (const rw of todo.filter((r) => !blocked.has(r))) {
    for (const e of entries.filter((x) => x.rw === rw)) {
      const K = KINDS[e.kind], before = JSON.parse(out.get(e.path)), next = K.convert(out.get(e.path), rw);
      const after = JSON.parse(next), a = K.records(before, rw), b = K.records(after, rw), n = RUNWAYS[rw].n;
      let ok = true;
      if (e.kind === 'skid1m' || e.kind === 'stations') {
        for (const [k, v] of a) ok &&= isDeepStrictEqual(b.get(k), [...v].reverse());
      } else {
        for (const [u, rec] of a) ok &&= isDeepStrictEqual(b.get(n + 1 - u), rec);
        ok &&= isDeepStrictEqual([...b.keys()], [...b.keys()].sort((x, y) => x - y));
      }
      const pci = (j) => (e.kind === 'geo' ? j.features.reduce((s, f) => s + f.properties.pci_score, 0) / j.features.length : NaN);
      rows.push({ file: rel(e.path) + (e.kind === 'stations' ? `#${rw}` : ''), rec: a.size, pciBefore: pci(before), pciAfter: pci(after), ok });
      out.set(e.path, next);
    }
  }
  if (rows.length) {
    console.log('\nInvarian sebelum / sesudah (rekaman tanpa nomor identik = I1; rata-rata PCI = I2):');
    for (const r of rows) console.log(`  ${r.file.padEnd(56)} rekaman ${String(r.rec).padStart(3)}  PCI ${Number.isNaN(r.pciBefore) ? '   -   ' : r.pciBefore.toFixed(6)} -> ${Number.isNaN(r.pciAfter) ? '   -   ' : r.pciAfter.toFixed(6)}  ${r.ok ? 'OK' : 'GAGAL'}`);
  }
  const bad = rows.some((r) => !r.ok);
  if (bad) problems.push('pemeriksaan rekaman GAGAL');

  if (!write) { console.log(`\n--check: tidak ada yang ditulis.${todo.length ? ' Jalankan dengan --write untuk menerapkan.' : ''}`); process.exit(problems.length ? 1 : 0); }
  if (problems.length) { console.log('\n--write dibatalkan karena ada masalah di atas.'); process.exit(1); }
  for (const [p, t] of out) if (t !== text.get(p)) {
    if (!(statSync(p).mode & 0o200)) chmodSync(p, 0o644); // beberapa berkas skid bertanda read-only
    writeFileSync(p, t);
    console.log(`  ditulis: ${rel(p)}`);
  }
}

main();
