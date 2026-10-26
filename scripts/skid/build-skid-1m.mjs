#!/usr/bin/env node
/**
 * build-skid-1m.mjs — per-meter (1 m) skid-resistance data for the APMS "Skid Resistance" tab.
 *
 * Reads the Moventor Skiddometer BV-11 CSV runs (8 lanes x 2 runways, June 2026), places every
 * 1 m reading on the runway with the SAME station rule that produced
 * public/data/skid-<runway>-2026.json, recomputes every per-unit number (n, mu_10m, mu_152m)
 * from the raw rows and compares them with that file. Output files are written only when
 * every check passes, so the per-meter and per-unit views can never disagree.
 *
 * Usage (from the repo root, Node >= 18, no dependencies):
 *   node scripts/skid/build-skid-1m.mjs --csv data-raw/skid-2026
 *
 * Options:
 *   --csv <dir|file>    CSV folder or file; repeatable; folders are scanned recursively (required)
 *   --data <dir>        folder holding skid-06-24-2026.json and skid-07L-25R-2026.json (default: public/data)
 *   --stations <file>   unit station table (default: skid-unit-stations-2026.json next to this script)
 *   --out <dir>         output folder (default: same as --data)
 *   --runway <id>       only one runway: 06-24 or 07L-25R (default: both)
 *   --check             verify only, write nothing
 *   --json-report <f>   also write the full report as JSON
 *
 * Exit code: 0 = all checks passed (files written unless --check)
 *            1 = a check failed (nothing written)
 *            2 = usage or input error
 *
 * Rules (identical to the per-unit file; see skid-unit-stations-2026.json):
 *   station_m = s0_m - DISTANCE          (s0_m from lanes[].s0_m; stations are measured from threshold 24 / 25R and the
 *                                         test runs toward it, from unit 1 at 06 / 07L to unit N)
 *   unit k    = starts_m[k-1] <= station < starts_m[k-2]   (unit 1: station < last_end_m; starts_m falls with the unit
 *               number since the 21 Oct 2026 renumbering), using the full-precision starts in the station table
 *   mu_152m   = mean of the lane's readings with window_mid_m[k-1] - 76.2 <= station < window_mid_m[k-1] + 76.2
 *   NAN readings are kept as null: they count in n but not in the means.
 * Stations are compared as integers of 0.1 mm, so a reading that falls exactly on a window edge is
 * handled the same way on every machine. If the per-unit file treated such an edge reading the other
 * way (floating-point rounding when it was made), the check accepts that and lists it as an edge case.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNWAYS = ['06-24', '07L-25R'];
const LANE_ORDER = ['L6.0', 'L4.5', 'L3.0', 'L1.5', 'R1.5', 'R3.0', 'R4.5', 'R6.0'];
const SCALE = 10000; // 1 station unit = 0.1 mm
const HALF_WINDOW = 762000; // 76.2 m: half of the 500 ft (152.4 m) FAA segment
const TOL_4DP = 0.00005 + 1e-9; // the per-unit file stores 4 decimals
const TOL_2DP = 0.005 + 1e-9;
const SPEED_TARGET_KMH = 65;
const SPEED_TOL_KMH = 5; // FAA AC 150/5320-12C Appendix 3 par. 1.a(7): +/-3 mph (+/-5 km/h)
const R_EARTH = 6371008.8;

// ---------------------------------------------------------------- CSV parsing

function splitCsvLine(line, delim) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function toNumber(s, decimalComma = false) {
  if (s === undefined || s === null) return null;
  let t = String(s).trim();
  if (t === '' || /^(nan|n\/a|na|null|-)$/i.test(t)) return null;
  if (decimalComma) t = t.replace(',', '.');
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** Parses one Moventor CSV export. Throws with a clear message when the layout is not recognised. */
export function parseMoventorCsv(text, name = 'csv') {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let h = -1;
  let delim = ',';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const d = l.includes(',') ? ',' : l.includes(';') ? ';' : ',';
    const c = splitCsvLine(l, d);
    if (/^DISTANCE\b/i.test(c[0] ?? '') && c.some((x) => /^FRICTION\b/i.test(x))) { h = i; delim = d; break; }
  }
  if (h < 0) throw new Error(`${name}: header row "DISTANCE,FRICTION,..." not found`);
  const decimalComma = delim === ';';

  // Metadata above the header: a row with a single cell starts a section, other rows are key,value.
  const meta = [];
  let section = '';
  for (const l of lines.slice(0, h)) {
    if (l.trim() === '') continue;
    const c = splitCsvLine(l, delim);
    if (c.length === 1 && c[0] !== '') { section = c[0]; continue; }
    if (c.length >= 2 && c[0] !== '') meta.push({ section, key: c[0], value: c[1] });
  }

  const head = splitCsvLine(lines[h], delim).map((x) => x.toUpperCase());
  const col = (re) => head.findIndex((x) => re.test(x));
  const iD = col(/^DISTANCE/), iF = col(/^FRICTION/), iS = col(/^SPEED/), iT = col(/^TIME/);
  const iP = col(/^POSITION/), iM = col(/^MARKER/), iLat = col(/^LAT/), iLon = col(/^LON/);
  if (iS < 0) throw new Error(`${name}: SPEED column not found in header`);

  const rows = [];
  let endOfData = false;
  for (let i = h + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/END OF DATA/i.test(l)) { endOfData = true; break; }
    if (l.trim() === '') continue;
    const c = splitCsvLine(l, delim);
    if ((c[iD] ?? '') === '') continue;
    const d = toNumber(c[iD], decimalComma);
    if (d === null) throw new Error(`${name}: line ${i + 1}: DISTANCE "${c[iD]}" is not a number`);
    let lat = null, lon = null;
    if (iP >= 0) {
      const p = (c[iP] ?? '').split(decimalComma ? /[;\s]+/ : /[,;\s]+/).filter(Boolean);
      if (p.length >= 2) { lat = toNumber(p[0], decimalComma); lon = toNumber(p[1], decimalComma); }
    } else if (iLat >= 0 && iLon >= 0) {
      lat = toNumber(c[iLat], decimalComma); lon = toNumber(c[iLon], decimalComma);
    }
    if (lat === null || lon === null || (Math.abs(lat) < 1e-9 && Math.abs(lon) < 1e-9)) { lat = null; lon = null; }
    rows.push({
      d,
      mu: toNumber(c[iF], decimalComma),
      speed: toNumber(c[iS], decimalComma),
      time: iT >= 0 ? (c[iT] ?? '') : '',
      lat, lon,
      marker: iM >= 0 ? (c[iM] ?? '') : '',
    });
  }
  return { meta, header: head, rows, endOfData };
}

function metaValue(meta, key, preferSection) {
  const k = key.toUpperCase();
  const hits = meta.filter((m) => m.key.toUpperCase() === k);
  if (hits.length === 0) return null;
  const pref = preferSection ? hits.find((m) => m.section.toUpperCase() === preferSection.toUpperCase()) : null;
  return (pref ?? hits[hits.length - 1]).value;
}

const decimalsOf = (s) => { const m = String(s).trim().match(/\.(\d+)$/); return m ? m[1].length : 0; };

// ---------------------------------------------------------------- file discovery

function listCsv(paths) {
  const out = [];
  const walk = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      if (basename(p) === '__MACOSX') return; // macOS zip metadata
      for (const e of readdirSync(p).sort()) walk(join(p, e));
    } else if (/\.csv$/i.test(p) && !basename(p).startsWith('._')) out.push(resolve(p));
  };
  for (const p of paths) {
    if (!existsSync(p)) throw new Error(`--csv ${p}: not found`);
    walk(p);
  }
  return [...new Set(out)];
}

const normName = (s) => s.normalize('NFC').toLowerCase().replace(/\.csv$/i, '').replace(/[\s_]+/g, ' ').trim();

export function laneFromName(name) {
  const n = name.replace(/_/g, ' ');
  const m = n.match(/(\d+(?:[.,]\d+)?)\s*m\s*(left|right|kiri|kanan)\b/i);
  if (!m) return null;
  const off = Number(m[1].replace(',', '.'));
  return `${/^(left|kiri)$/i.test(m[2]) ? 'L' : 'R'}${off.toFixed(1)}`;
}

export function runwayFromName(name) {
  const n = name.replace(/_/g, ' ').toUpperCase();
  if (/0?7\s*L\s*-\s*25\s*R/.test(n)) return '07L-25R';
  if (/(^|[^0-9])0?6\s*-\s*24([^0-9]|$)/.test(n)) return '06-24';
  return null;
}

// ---------------------------------------------------------------- helpers

const median = (a) => {
  if (a.length === 0) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x, n) => (x === null ? null : Math.round(x * 10 ** n) / 10 ** n);
const mod = (a, m) => ((a % m) + m) % m;

/** Index of the last element <= x in an ascending array, or -1. */
function lastLE(arr, x) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Local runway frame from the unit centroids of the per-unit file (for the GPS information checks).
 *  `units` must be in station order: units[0] is the unit at station 0 (threshold 24 / 25R). */
function makeAxis(units) {
  const c1 = units[0].centroid_lonlat;
  const cN = units[units.length - 1].centroid_lonlat;
  const cosLat = Math.cos((c1[1] * Math.PI) / 180);
  const xy = (lon, lat) => [((lon - c1[0]) * Math.PI / 180) * R_EARTH * cosLat, ((lat - c1[1]) * Math.PI / 180) * R_EARTH];
  const pN = xy(cN[0], cN[1]);
  const len = Math.hypot(pN[0], pN[1]);
  const t = [-pN[0] / len, -pN[1] / len]; // direction of travel (toward the station-0 end, threshold 24 / 25R)
  const left = [-t[1], t[0]];
  const mid1 = units[0].station_mid_m;
  return (lon, lat) => {
    const p = xy(lon, lat);
    return { station: mid1 - (p[0] * t[0] + p[1] * t[1]), offset: -(p[0] * left[0] + p[1] * left[1]) };
  };
}

// ---------------------------------------------------------------- one runway

function buildRunway(rw, perUnit, stationTable, csvPaths, used) {
  const errors = [], warnings = [], info = [];
  const U = perUnit.units;
  const ST = stationTable.runways?.[rw];
  const L = Math.round(perUnit.survey.measured_length_m);

  if (perUnit.runway !== rw) errors.push(`per-unit file says runway "${perUnit.runway}", expected "${rw}"`);
  if (!ST) { errors.push(`station table has no entry for ${rw}`); return { errors, warnings, info }; }
  if (ST.starts_m.length !== U.length || ST.window_mid_m.length !== U.length) {
    errors.push(`station table has ${ST.starts_m.length} units, per-unit file has ${U.length}`);
    return { errors, warnings, info };
  }
  // station_start_m / station_mid_m in the per-unit file were rounded from the 3-decimal starts
  let badStart = 0, badMid = 0;
  U.forEach((u, k) => {
    if (u.unit !== k + 1) errors.push(`per-unit file: units[${k}].unit = ${u.unit}, expected ${k + 1}`);
    if (Math.abs(round(ST.starts_m[k], 3) - u.station_start_m) > TOL_2DP) badStart++;
    if (Math.abs(ST.window_mid_m[k] - u.station_mid_m) > TOL_2DP) badMid++;
  });
  if (badStart || badMid) errors.push(`station table does not match the per-unit file (starts: ${badStart}, mids: ${badMid} units differ)`);
  const codes = perUnit.lanes.map((l) => l.code);
  if (codes.join() !== LANE_ORDER.join()) errors.push(`per-unit lanes are ${codes.join(', ')}; expected ${LANE_ORDER.join(', ')}`);
  if (errors.length) return { errors, warnings, info };

  // ---- match CSV files to lanes
  const byName = new Map();
  for (const p of csvPaths) {
    const k = normName(basename(p));
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  const files = {};
  for (const lane of perUnit.lanes) {
    const same = byName.get(normName(lane.file)) ?? [];
    if (same.length > 1) {
      errors.push(`${lane.code}: "${lane.file}" exists ${same.length} times (${same.join(' | ')}); keep one copy`);
      continue;
    }
    let p = same[0];
    if (!p) {
      const cand = csvPaths.filter((q) => runwayFromName(basename(q)) === rw && laneFromName(basename(q)) === lane.code);
      if (cand.length === 1) {
        p = cand[0];
        warnings.push(`${lane.code}: matched "${basename(p)}" by runway/lane in the name (expected file name "${lane.file}")`);
      } else if (cand.length > 1) {
        errors.push(`${lane.code}: ${cand.length} candidate files, cannot choose: ${cand.map((q) => basename(q)).join(' | ')}`);
        continue;
      } else {
        errors.push(`${lane.code}: CSV not found (expected "${lane.file}")`);
        continue;
      }
    }
    if (used.has(p)) { errors.push(`${lane.code}: "${basename(p)}" is already used by another lane`); continue; }
    used.add(p);
    files[lane.code] = p;
  }
  if (errors.length) return { errors, warnings, info };

  // The files list units by number (unit 1 = threshold 06 / 07L = the largest station). The binary search below
  // needs ascending starts, so everything from here on works on station-ordered copies; the files keep their order.
  const Us = [...U].reverse();
  const startsI = [...ST.starts_m].reverse().map((x) => x * SCALE);
  const lastEndI = ST.last_end_m * SCALE;
  const wmI = [...ST.window_mid_m].reverse().map((x) => Math.round(x * SCALE));
  const axis = makeAxis(Us);

  const lanesOut = [];
  const pairs = { checked: 0, n_ok: 0, mu10_ok: 0, mu152_ok: 0, edge_cases: [], max_diff_10m: 0, max_diff_152m: 0 };
  const gpsTable = [];
  const covered = new Set();

  perUnit.lanes.forEach((lane, li) => {
    const path = files[lane.code];
    const errorsBefore = errors.length;
    let parsed;
    try { parsed = parseMoventorCsv(readFileSync(path, 'utf8'), basename(path)); } catch (e) { errors.push(`${lane.code}: ${e.message}`); return; }
    const R = parsed.rows;
    const tag = `${lane.code} (${basename(path)})`;

    // ---- DISTANCE must be 1, 2, ..., L (the per-unit counts were made from exactly these rows)
    if (!parsed.endOfData) warnings.push(`${tag}: no "END OF DATA" line; read to end of file`);
    if (R.length !== L) errors.push(`${tag}: ${R.length} rows, expected ${L} (survey.measured_length_m)`);
    let badD = -1;
    R.forEach((r, i) => { if (badD < 0 && Math.abs(r.d - (i + 1)) > 1e-9) badD = i; });
    if (badD >= 0) errors.push(`${tag}: DISTANCE is not 1, 2, 3, ... (row ${badD + 1} has ${R[badD].d})`);
    const metaLen = toNumber(metaValue(parsed.meta, 'LENGTH'));
    if (metaLen !== null && Math.round(metaLen) !== R.length) warnings.push(`${tag}: header LENGTH ${metaLen} but ${R.length} rows`);
    if (errors.length > errorsBefore) return;

    const mu = R.map((r) => r.mu);
    const speed = R.map((r) => r.speed);
    const s0I = Math.round(lane.s0_m * SCALE);

    // ---- prefix sums over non-null friction (index i <-> DISTANCE i+1)
    const ps = new Float64Array(L + 1), pc = new Int32Array(L + 1);
    for (let i = 0; i < L; i++) {
      ps[i + 1] = ps[i] + (mu[i] ?? 0);
      pc[i + 1] = pc[i] + (mu[i] === null ? 0 : 1);
    }
    const meanD = (dFrom, dTo) => { // DISTANCE dFrom..dTo inclusive
      const a = Math.max(1, dFrom), b = Math.min(L, dTo);
      if (b < a) return { mean: null, cnt: 0, sum: 0 };
      const cnt = pc[b] - pc[a - 1], sum = ps[b] - ps[a - 1];
      return { mean: cnt ? sum / cnt : null, cnt, sum };
    };

    // ---- per-unit n and mu_10m
    const nRows = new Int32Array(U.length), sum = new Float64Array(U.length), cnt = new Int32Array(U.length);
    for (let i = 0; i < L; i++) {
      const sI = s0I - (i + 1) * SCALE;
      if (sI < startsI[0] || sI >= lastEndI) continue;
      const k = lastLE(startsI, sI);
      nRows[k]++;
      if (mu[i] !== null) { sum[k] += mu[i]; cnt[k]++; }
    }

    Us.forEach((u, k) => {
      const J = u.lanes[li];
      if (J.lane !== lane.code) { errors.push(`unit ${u.unit}: lanes[${li}] is ${J.lane}, expected ${lane.code}`); return; }
      pairs.checked++;
      if (nRows[k] > 0) covered.add(u.unit);
      if (J.n === nRows[k]) pairs.n_ok++;
      else errors.push(`unit ${u.unit} ${lane.code}: n ${nRows[k]} from CSV, ${J.n} in per-unit file`);

      const mu10 = cnt[k] ? sum[k] / cnt[k] : null;
      if (mu10 === null || J.mu_10m === null) {
        if ((mu10 === null) === (J.mu_10m === null)) pairs.mu10_ok++;
        else errors.push(`unit ${u.unit} ${lane.code}: mu_10m ${round(mu10, 5)} from CSV, ${J.mu_10m} in per-unit file`);
      } else {
        const diff = Math.abs(mu10 - J.mu_10m);
        pairs.max_diff_10m = Math.max(pairs.max_diff_10m, diff);
        if (diff <= TOL_4DP) pairs.mu10_ok++;
        else errors.push(`unit ${u.unit} ${lane.code}: mu_10m ${round(mu10, 5)} from CSV, ${J.mu_10m} in per-unit file`);
      }

      // mu_152m is defined where mu_10m is (per-unit file rule)
      if (J.mu_10m === null) {
        if (J.mu_152m === null) pairs.mu152_ok++;
        else errors.push(`unit ${u.unit} ${lane.code}: mu_152m is set although mu_10m is null`);
        return;
      }
      const lo = wmI[k] - HALF_WINDOW, hi = wmI[k] + HALF_WINDOW;
      const dMax = Math.floor((s0I - lo) / SCALE); // station >= lo
      const dMin = Math.floor((s0I - hi) / SCALE) + 1; // station < hi
      const w = meanD(dMin, dMax);
      const check = (m) => m !== null && J.mu_152m !== null && Math.abs(m - J.mu_152m) <= TOL_4DP;
      if (check(w.mean)) {
        pairs.mu152_ok++;
        pairs.max_diff_152m = Math.max(pairs.max_diff_152m, Math.abs(w.mean - J.mu_152m));
        return;
      }
      // A reading exactly on a window edge may have been counted the other way when the per-unit file was made.
      const loEdge = mod(s0I - lo, SCALE) === 0 ? (s0I - lo) / SCALE : null; // included above
      const hiEdge = mod(s0I - hi, SCALE) === 0 ? (s0I - hi) / SCALE : null; // excluded above
      const variants = [];
      const inRun = (d) => d !== null && d >= 1 && d <= L;
      if (inRun(loEdge) && mu[loEdge - 1] !== null) variants.push({ drop: [loEdge], add: [], note: `reading at DISTANCE ${loEdge} on the lower window edge counted as outside` });
      if (inRun(hiEdge) && mu[hiEdge - 1] !== null) variants.push({ drop: [], add: [hiEdge], note: `reading at DISTANCE ${hiEdge} on the upper window edge counted as inside` });
      if (variants.length === 2) variants.push({ drop: variants[0].drop, add: variants[1].add, note: `${variants[0].note}; ${variants[1].note}` });
      for (const v of variants) {
        let s = w.sum, c = w.cnt;
        for (const d of v.drop) { s -= mu[d - 1]; c--; }
        for (const d of v.add) { s += mu[d - 1]; c++; }
        const m = c ? s / c : null;
        if (check(m)) {
          pairs.mu152_ok++;
          pairs.edge_cases.push(`unit ${u.unit} ${lane.code}: ${v.note}`);
          return;
        }
      }
      errors.push(`unit ${u.unit} ${lane.code}: mu_152m ${round(w.mean, 5)} from CSV, ${J.mu_152m} in per-unit file`);
    });

    // ---- run statistics (information for the UI and the report)
    const muVals = mu.filter((x) => x !== null), spVals = speed.filter((x) => x !== null);
    let held = 0;
    for (let i = 1; i < L; i++) {
      if (mu[i] !== null && mu[i] === mu[i - 1] && speed[i] !== null && speed[i] === speed[i - 1]) held++;
    }
    const outside = spVals.filter((v) => Math.abs(v - SPEED_TARGET_KMH) > SPEED_TOL_KMH).length;
    const meanMu = muVals.length ? muVals.reduce((a, b) => a + b, 0) / muVals.length : null;
    const meanSp = spVals.length ? spVals.reduce((a, b) => a + b, 0) / spVals.length : null;
    const gpsRows = R.filter((r) => r.lat !== null);

    if (meanMu !== null && lane.mean_mu_run != null && Math.abs(meanMu - lane.mean_mu_run) > TOL_4DP)
      warnings.push(`${tag}: run mean mu ${round(meanMu, 5)} differs from lanes[].mean_mu_run ${lane.mean_mu_run}`);
    if (meanSp !== null && lane.mean_speed_kmh != null && Math.abs(meanSp - lane.mean_speed_kmh) > TOL_2DP)
      warnings.push(`${tag}: run mean speed ${round(meanSp, 3)} differs from lanes[].mean_speed_kmh ${lane.mean_speed_kmh}`);
    const statF = metaValue(parsed.meta, 'FRICTION', 'STATISTICS');
    if (statF !== null && toNumber(statF) !== null && meanMu !== null) {
      const tol = 0.5 * 10 ** -decimalsOf(statF) + 1e-9;
      if (Math.abs(toNumber(statF) - meanMu) > tol) warnings.push(`${tag}: header FRICTION ${statF} differs from the mean of the rows ${round(meanMu, 5)}`);
    }
    if (lane.gps === true && gpsRows.length === 0) warnings.push(`${tag}: per-unit file says gps=true but POSITION is empty in every row`);
    if (lane.gps === false && gpsRows.length > 0) warnings.push(`${tag}: per-unit file says gps=false but ${gpsRows.length} rows have POSITION`);

    let gps = null;
    if (gpsRows.length >= 10) {
      const proj = gpsRows.map((r) => ({ ...axis(r.lon, r.lat), d: r.d }));
      gps = {
        rows: gpsRows.length,
        s0_from_gps_m: round(median(proj.map((p) => p.station + p.d)), 2),
        lateral_from_gps_m: round(median(proj.map((p) => p.offset)), 2),
      };
      if (Math.abs(gps.s0_from_gps_m - lane.s0_m) > 2) warnings.push(`${tag}: s0 from GPS ${gps.s0_from_gps_m} m vs s0_m ${lane.s0_m} m (more than 2 m apart)`);
    }
    gpsTable.push({ lane: lane.code, nominal: lane.offset_m, gps });

    const markers = [];
    R.forEach((r) => { if (r.marker && r.marker.trim() !== '') markers.push({ d: r.d, text: r.marker.trim() }); });

    lanesOut.push({
      lane: lane.code,
      offset_m: lane.offset_m,
      file: basename(path),
      s0_m: lane.s0_m,
      gps: lane.gps,
      record_start_utc: lane.record_start_utc,
      d_first: 1,
      length_m: L,
      time_first: R[0].time || null,
      time_last: R[L - 1].time || null,
      mu,
      speed_kmh: speed,
      markers,
      stats: {
        rows: L,
        mu_null: L - muVals.length,
        speed_null: L - spVals.length,
        held_rows: held,
        gps_rows: gpsRows.length,
        mean_mu: round(meanMu, 4),
        mean_speed_kmh: round(meanSp, 2),
        min_speed_kmh: spVals.length ? Math.min(...spVals) : null,
        max_speed_kmh: spVals.length ? Math.max(...spVals) : null,
        rows_outside_speed_tol: outside,
      },
      header: {
        length: metaValue(parsed.meta, 'LENGTH'),
        runway_direction: metaValue(parsed.meta, 'RUNWAY DIRECTION'),
        wetting: metaValue(parsed.meta, 'WETTING'),
        friction: statF,
        speed_kmh: metaValue(parsed.meta, 'SPEED (km/h)', 'STATISTICS'),
      },
    });
  });
  if (errors.length) return { errors, warnings, info, pairs };

  // coverage must agree with the per-unit file
  const cov = [...covered].sort((a, b) => a - b);
  const c = perUnit.coverage;
  if (cov.length !== c.n_units || cov[0] !== c.first_unit || cov[cov.length - 1] !== c.last_unit)
    errors.push(`coverage from CSV ${cov[0]}-${cov[cov.length - 1]} (${cov.length} units) vs per-unit file ${c.first_unit}-${c.last_unit} (${c.n_units})`);

  // GPS lateral check (information only: the GPS antenna is not on the measuring wheel)
  const withGps = gpsTable.filter((g) => g.gps);
  if (withGps.length >= 2) {
    const shift = median(withGps.map((g) => g.gps.lateral_from_gps_m - g.nominal));
    for (const g of withGps) {
      g.gps.common_shift_m = round(shift, 2);
      g.gps.residual_m = round(g.gps.lateral_from_gps_m - g.nominal - shift, 2);
      if (Math.abs(g.gps.residual_m) > 1.5) warnings.push(`${g.lane}: GPS lateral position is ${g.gps.residual_m} m away from the other lanes' pattern; check the lane label`);
    }
  }

  const output = {
    schema_version: 1,
    kind: 'skid-1m',
    runway: rw,
    generated_by: 'scripts/skid/build-skid-1m.mjs',
    generated_at: new Date().toISOString(),
    source_units_file: `skid-${rw}-2026.json`,
    survey: perUnit.survey,
    station_rule: 'station_m = s0_m - DISTANCE; DISTANCE = d_first + index',
    x_rule: 'x_m (distance from the first runway end in the test direction) = unit_bounds.last_end_m - station_m',
    unit_bounds: { starts_m: ST.starts_m, last_end_m: ST.last_end_m, window_mid_m: ST.window_mid_m },
    speed_tolerance_kmh: { target: SPEED_TARGET_KMH, tol: SPEED_TOL_KMH, ref: 'FAA AC 150/5320-12C App. 3 par. 1.a(7)' },
    reconciliation: {
      unit_lane_pairs: pairs.checked,
      n_ok: pairs.n_ok,
      mu_10m_ok: pairs.mu10_ok,
      mu_152m_ok: pairs.mu152_ok,
      max_abs_diff_10m: round(pairs.max_diff_10m, 6),
      max_abs_diff_152m: round(pairs.max_diff_152m, 6),
      edge_cases: pairs.edge_cases,
    },
    lanes: lanesOut,
  };
  return { errors, warnings, info, pairs, gpsTable, output };
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const a = { csv: [], data: 'public/data', stations: join(HERE, '../../src/config/skid-unit-stations-2026.json'), out: null, runway: null, check: false, jsonReport: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => { if (i + 1 >= argv.length) throw new Error(`${k} needs a value`); return argv[++i]; };
    if (k === '--csv') a.csv.push(v());
    else if (k === '--data') a.data = v();
    else if (k === '--stations') a.stations = v();
    else if (k === '--out') a.out = v();
    else if (k === '--runway') a.runway = v();
    else if (k === '--check') a.check = true;
    else if (k === '--json-report') a.jsonReport = v();
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`unknown option ${k}`);
  }
  if (!a.out) a.out = a.data;
  return a;
}

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`error: ${e.message}`); return 2; }
  if (args.help || args.csv.length === 0) {
    console.error('usage: node scripts/skid/build-skid-1m.mjs --csv <folder> [--csv <folder>] [--data public/data] [--out public/data] [--runway 06-24|07L-25R] [--check]');
    return args.help ? 0 : 2;
  }
  const runways = args.runway ? [args.runway] : RUNWAYS;
  if (runways.some((r) => !RUNWAYS.includes(r))) { console.error(`error: --runway must be one of ${RUNWAYS.join(', ')}`); return 2; }

  let csvPaths, stationTable;
  try {
    csvPaths = listCsv(args.csv);
    stationTable = JSON.parse(readFileSync(args.stations, 'utf8'));
  } catch (e) { console.error(`error: ${e.message}`); return 2; }
  console.log(`CSV files found: ${csvPaths.length}`);

  const used = new Set();
  const results = {};
  let failed = false;
  for (const rw of runways) {
    const perUnitPath = join(args.data, `skid-${rw}-2026.json`);
    let perUnit;
    try { perUnit = JSON.parse(readFileSync(perUnitPath, 'utf8')); } catch (e) { console.error(`error: ${perUnitPath}: ${e.message}`); return 2; }
    const r = buildRunway(rw, perUnit, stationTable, csvPaths, used);
    results[rw] = r;
    console.log(`\n== RWY ${rw}`);
    if (r.pairs) {
      const p = r.pairs;
      console.log(`unit-lane pairs checked: ${p.checked}  n OK: ${p.n_ok}  mu_10m OK: ${p.mu10_ok}  mu_152m OK: ${p.mu152_ok}`);
      console.log(`largest difference vs per-unit file: mu_10m ${p.max_diff_10m.toFixed(6)}, mu_152m ${p.max_diff_152m.toFixed(6)}`);
      for (const e of p.edge_cases) console.log(`edge case (accepted): ${e}`);
    }
    if (r.output) {
      console.log('lane   rows  mean_mu  mean_kmh  outside_65+/-5  held_rows  gps_rows  s0_gps    lateral_gps (nominal)');
      for (const l of r.output.lanes) {
        const g = r.gpsTable.find((x) => x.lane === l.lane)?.gps;
        console.log(
          `${l.lane.padEnd(5)} ${String(l.stats.rows).padStart(5)}  ${String(l.stats.mean_mu).padEnd(7)}  ${String(l.stats.mean_speed_kmh).padEnd(8)}  ${String(l.stats.rows_outside_speed_tol).padStart(14)}  ${String(l.stats.held_rows).padStart(9)}  ${String(l.stats.gps_rows).padStart(8)}  ${g ? String(g.s0_from_gps_m).padEnd(8) : '-'.padEnd(8)}  ${g ? `${g.lateral_from_gps_m} (${l.offset_m})` : '-'}`,
        );
      }
    }
    for (const w of r.warnings) console.log(`warning: ${w}`);
    for (const e of r.errors.slice(0, 40)) console.log(`ERROR: ${e}`);
    if (r.errors.length > 40) console.log(`ERROR: ... and ${r.errors.length - 40} more`);
    if (r.errors.length) failed = true;
  }
  // files that clearly belong to a runway that was not processed (--runway) are not reported
  const unused = csvPaths.filter((p) => !used.has(p) && (runways.includes(runwayFromName(basename(p))) || runwayFromName(basename(p)) === null));
  if (unused.length) {
    console.log(`\nwarning: ${unused.length} CSV file(s) not used by any lane (check that no measurement is missing):`);
    for (const p of unused) console.log(`  ${basename(p)}`);
  }
  if (args.jsonReport) {
    const rep = {};
    for (const [rw, r] of Object.entries(results)) rep[rw] = { errors: r.errors, warnings: r.warnings, reconciliation: r.output?.reconciliation ?? null, gps: r.gpsTable ?? null };
    rep.unused_csv = unused.map((p) => basename(p));
    writeFileSync(args.jsonReport, JSON.stringify(rep, null, 2));
  }
  if (failed) {
    console.log('\nRESULT: FAILED - nothing was written. Do not change the rules to make this pass; report the errors.');
    return 1;
  }
  if (args.check) { console.log('\nRESULT: OK (check only, nothing written)'); return 0; }
  mkdirSync(args.out, { recursive: true });
  for (const rw of runways) {
    const file = join(args.out, `skid-${rw}-2026-1m.json`);
    const text = JSON.stringify(results[rw].output);
    writeFileSync(file, text + '\n');
    console.log(`wrote ${file} (${Math.round(text.length / 1024)} KB)`);
  }
  console.log('\nRESULT: OK');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();

export { buildRunway, splitCsvLine, toNumber };
