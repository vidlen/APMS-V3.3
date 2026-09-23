/**
 * paver-import.ts
 * -----------------------------------------------------------------------------
 * Turns a PAVER (LCMS-processed) Excel export - the surveyor's "PCI per Sampel
 * Unit" and "Jenis Kerusakan" sheets - into a runway's sample-unit
 * FeatureCollection. Only PCI and distresses come from the file; geometry and
 * every other property stay as they are on the base FeatureCollection, so the
 * map polygons never move. Branch inventory (dimension, PCN, last major
 * construction) is edited in Admin, not imported.
 *
 * Distress rows are placed by COORDINATE, not by their Sample Number column:
 * PAVER stamps each distress with its sample's SYS_UTM_X/Y, identical to that
 * sample's coordinate on the PCI sheet. The RWY 07L/25R 2025 export's distress
 * sheet has Sample Number shifted by one (plus two rows filed under 360 that
 * sit on sample 193); by coordinate, its five distress-free samples match the
 * PCI sheet's NoDistresses flags exactly, by Sample Number they don't. The
 * Sample Number column is only the fallback for a row with no coordinate.
 * -----------------------------------------------------------------------------
 */

import type { GeoJSONFeature, GeoJSONFeatureCollection } from './geojson-types.ts';
import { getPCICategory } from './pci-utils.ts';

export type SheetRows = unknown[][];

export interface PaverImportReport {
  samples: number;
  distresses: number;
  /** Distress rows whose Sample Number column disagreed with their coordinate. */
  movedByCoordinate: number;
  /** Samples whose PAVER coordinate lands nearest the map polygon of the same number. */
  onMatchingPolygon: number;
}

export type PaverImportResult =
  | { ok: true; data: GeoJSONFeatureCollection; report: PaverImportReport }
  | { ok: false; error: string };

const QUANTITY_UNITS = new Set(['SqM', 'M']);
const SEVERITIES = new Set(['Low', 'Medium', 'High']);

const isPciHeader = (h: string) => /^pci\b/i.test(h);
const named = (name: string) => (h: string) => h.toLowerCase() === name.toLowerCase();

function column(header: unknown[], matches: (h: string) => boolean): number {
  return header.findIndex((h) => typeof h === 'string' && matches(h.trim()));
}

/** Picks the PCI and distress sheets by their header rows, not their tab names. */
export function findPaverSheets(sheets: { sheet: string; data: SheetRows }[]) {
  return {
    pci: sheets.find((s) => column(s.data[0] ?? [], isPciHeader) >= 0)?.data,
    distress: sheets.find((s) => column(s.data[0] ?? [], named('Deduct')) >= 0)?.data,
  };
}

function centroid(feature: GeoJSONFeature): [number, number] | null {
  if (feature.geometry?.type !== 'Polygon') return null;
  const ring = (feature.geometry.coordinates as number[][][])[0]?.slice(0, -1) ?? [];
  if (ring.length === 0) return null;
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
}

export function paverToUnits(base: GeoJSONFeatureCollection, pciRows: SheetRows, distressRows: SheetRows): PaverImportResult {
  const fail = (error: string): PaverImportResult => ({ ok: false, error });

  const [pciHead = [], ...pciBody] = pciRows;
  const p = {
    n: column(pciHead, named('Sample Number')),
    pci: column(pciHead, isPciHeader),
    x: column(pciHead, named('SYS_UTM_X')),
    y: column(pciHead, named('SYS_UTM_Y')),
  };
  if (p.n < 0 || p.pci < 0) return fail('PCI sheet needs "Sample Number" and "PCI" columns.');

  const samples = new Map<number, { pci: number; x: unknown; y: unknown }>();
  const sampleAt = new Map<string, number>();
  for (const row of pciBody) {
    const n = row[p.n];
    if (typeof n !== 'number' || !Number.isInteger(n)) continue; // e.g. the "NILAI PCI RUNWAY" total row
    const pci = row[p.pci];
    if (typeof pci !== 'number' || pci < 0 || pci > 100) return fail(`Sample ${n}: PCI must be a number between 0 and 100.`);
    if (samples.has(n)) return fail(`Sample ${n} appears twice on the PCI sheet.`);
    const x = row[p.x], y = row[p.y];
    samples.set(n, { pci, x, y });
    if (typeof x === 'number' && typeof y === 'number') sampleAt.set(`${x},${y}`, n);
  }

  const units = new Map(base.features.map((f) => [f.properties.sampleUnit as number, f]));
  if (samples.size !== units.size || [...samples.keys()].some((n) => !units.has(n))) {
    return fail(`The file has ${samples.size} samples, but this runway has ${units.size} sample units on the map (1-${units.size}).`);
  }

  const [dHead = [], ...dBody] = distressRows;
  const d = {
    n: column(dHead, named('Sample Number')),
    type: column(dHead, named('Description')),
    severity: column(dHead, named('Severity')),
    quantity: column(dHead, named('Quantity')),
    units: column(dHead, named('Quantity Units')),
    deduct: column(dHead, named('Deduct')),
    x: column(dHead, named('SYS_UTM_X')),
    y: column(dHead, named('SYS_UTM_Y')),
  };
  const missing = Object.entries(d).filter(([k, i]) => i < 0 && k !== 'x' && k !== 'y').map(([k]) => k);
  if (missing.length) return fail(`Distress sheet is missing columns: ${missing.join(', ')}.`);

  const distresses = new Map<number, Record<string, unknown>[]>();
  let count = 0;
  let moved = 0;
  for (const [i, row] of dBody.entries()) {
    const listed = row[d.n];
    if (listed === null || listed === undefined) continue; // blank row
    const excelRow = i + 2;
    const fromCoordinate = sampleAt.get(`${row[d.x]},${row[d.y]}`);
    const n = fromCoordinate ?? listed;
    if (typeof n !== 'number' || !samples.has(n)) return fail(`Distress row ${excelRow}: sample ${String(listed)} is not on the PCI sheet.`);
    if (fromCoordinate !== undefined && fromCoordinate !== listed) moved++;

    const [type, severity, quantity, quantityUnits, deduct] = [row[d.type], row[d.severity], row[d.quantity], row[d.units], row[d.deduct]];
    if (typeof type !== 'string' || !type.trim()) return fail(`Distress row ${excelRow}: missing Description.`);
    if (typeof severity !== 'string' || !SEVERITIES.has(severity)) return fail(`Distress row ${excelRow}: Severity must be Low, Medium or High.`);
    if (typeof quantity !== 'number' || quantity < 0) return fail(`Distress row ${excelRow}: Quantity must be a number.`);
    if (typeof quantityUnits !== 'string' || !QUANTITY_UNITS.has(quantityUnits)) return fail(`Distress row ${excelRow}: Quantity Units must be SqM or M.`);
    if (typeof deduct !== 'number') return fail(`Distress row ${excelRow}: Deduct must be a number.`);

    const list = distresses.get(n) ?? [];
    list.push({ type: type.trim(), severity, quantity, quantityUnits, deduct });
    distresses.set(n, list);
    count++;
  }

  // ponytail: O(n^2) nearest-centroid scan, fine for a few hundred units per runway.
  const centroids = [...units].map(([n, f]) => [n, centroid(f)] as const);
  let onMatchingPolygon = 0;
  for (const [n, { x, y }] of samples) {
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    let best = -1;
    let bestDist = Infinity;
    for (const [unit, c] of centroids) {
      if (!c) continue;
      const dist = (c[0] - x) ** 2 + (c[1] - y) ** 2;
      if (dist < bestDist) [best, bestDist] = [unit, dist];
    }
    if (best === n) onMatchingPolygon++;
  }

  const data: GeoJSONFeatureCollection = {
    ...base,
    features: base.features.map((f) => {
      const n = f.properties.sampleUnit as number;
      const { pci } = samples.get(n)!;
      return {
        ...f,
        properties: { ...f.properties, pci_score: pci, pci_rating: getPCICategory(pci).label, distresses: distresses.get(n) ?? [] },
      };
    }),
  };

  return { ok: true, data, report: { samples: samples.size, distresses: count, movedByCoordinate: moved, onMatchingPolygon } };
}
