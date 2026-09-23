/**
 * repair-log.ts
 * -----------------------------------------------------------------------------
 * Parses the airport's maintenance repair log, joins each record to one of the
 * 75 Section codes, and aggregates the distress evidence per branch.
 *
 * This is what takes dominant-distress coverage from 2 of 75 branches to 31.
 * The log is an EVENT RECORD, not a survey: it says what somebody found and
 * fixed, which is why DISTRESS_SOURCE_ORDER ranks it below the PCI sample
 * units and why the coverage panel has to report the gap rather than imply
 * the register is complete.
 *
 * INPUT
 *   RepairLogRecord[], produced from REKAP KERUSAKAN 2025.xlsx by
 *   scripts/convert-repair-log.py. The app never parses xlsx.
 *
 * Pure, no React, no fetch.
 *
 * NOTE ON IMPORT EXTENSIONS
 *   Relative imports use an explicit `.ts` extension so `node --test` can
 *   resolve this module directly. See the note in risk.ts.
 * -----------------------------------------------------------------------------
 */

import {
  FACILITY_GROUPS,
  FACILITY_TO_BRANCH,
  LOCATION_BRANCH_PATTERN,
} from '../config/riskScales.ts';
import { addObservation, type DistressTally } from './dominant-distress.ts';

/* =============================================================================
 * TYPES
 * ========================================================================== */

/** One row of the log. Field names mirror the source columns.
 *
 *  `method` is optional against the original data contract: 3 of the 678
 *  committed records have a blank Metode Perbaikan, and failing the whole
 *  import over a missing repair method would be a validator that rejects the
 *  airport's real data. The fields the join and the scoring actually depend on
 *  - date, facility, location, findingType, areaM2 - stay required. */
export interface RepairLogRecord {
  /** ISO date, from Tanggal. */
  date: string;
  /** Nama Fasilitas, verbatim. */
  facility: string;
  /** Lokasi Perbaikan, verbatim. */
  location: string;
  /** Jenis Perbaikan: TEMUAN INSPEKSI | KOMPLAIN. */
  findingType: string;
  /** Metode Perbaikan. */
  method?: string;
  /** Jenis Kerusakan (Aspal). */
  distressAsphalt?: string;
  /** Jenis Kerusakan (Beton). */
  distressConcrete?: string;
  /** Tingkat Kerusakan: RINGAN | SEDANG | BERAT. */
  severity?: string;
  /** Luas, m². */
  areaM2: number;
  /** Volume, m³. */
  volumeM3?: number;
}

export type RepairLogValidationResult =
  | { ok: true; data: RepairLogRecord[] }
  | { ok: false; error: string };

/** How a record found its branch, or why it did not. */
export type ResolutionRoute = 'facility' | 'location' | 'unresolved_group' | 'unknown_facility';

export type BranchResolution =
  | { ok: true; branch: string; via: 'facility' | 'location' }
  | { ok: false; via: 'unresolved_group' | 'unknown_facility' };

export interface UnresolvedRecord {
  /** Index into the input array, so the admin panel can point at the row. */
  index: number;
  facility: string;
  location: string;
  reason: 'unresolved_group' | 'unknown_facility';
}

export interface RepairLogStats {
  /** Records in the input. */
  total: number;
  /** Matched by FACILITY_TO_BRANCH. */
  byFacility: number;
  /** Matched by location text inside a group label. */
  byLocation: number;
  /** Group label whose location text named no branch in the network. */
  unresolvedGroup: number;
  /** Facility label that is not a Section code and not a group (APRON KARGO). */
  unknownFacility: number;
  /** Skipped: neither an asphalt nor a concrete distress type. Never allowed
   *  to fall through as hazard class 'other' - that would fabricate a class
   *  from a blank cell. */
  skippedNoDistress: number;
  /** Aggregated, but with no Tingkat Kerusakan, so contributing 0 to
   *  severity_area. See the note on SEVERITY_WEIGHT. */
  aggregatedWithoutSeverity: number;
  /** Records that reached a branch tally. */
  aggregated: number;
  /** Branches with at least one distress record. */
  branchesCovered: number;
}

export interface RepairLogAggregate {
  /** Section code -> tallies, ready for rankDistresses. */
  byBranch: Record<string, DistressTally[]>;
  stats: RepairLogStats;
  /** Every record that named no branch, for the admin panel to list. */
  unresolved: UnresolvedRecord[];
}

/* =============================================================================
 * VALIDATION
 *
 * A converted file is a trust boundary. Validate every field rather
 * than assuming the converter's output matches the contract. A malformed row
 * fails the WHOLE import rather than dropping one branch back to a weaker
 * evidence source unnoticed.
 * ========================================================================== */

function optionalString(
  value: unknown,
  index: number,
  field: string,
): { ok: true; value?: string } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== 'string') {
    return { ok: false, error: `Record ${index}: "${field}" must be a string when present.` };
  }
  const trimmed = value.trim();
  return { ok: true, value: trimmed || undefined };
}

export function validateRepairLog(json: unknown): RepairLogValidationResult {
  if (!Array.isArray(json)) {
    return { ok: false, error: 'Expected a JSON array of repair-log records.' };
  }

  const records: RepairLogRecord[] = [];
  for (let i = 0; i < json.length; i++) {
    const row = json[i];
    if (typeof row !== 'object' || row === null) {
      return { ok: false, error: `Record ${i}: not an object.` };
    }
    const r = row as Record<string, unknown>;

    for (const field of ['date', 'facility', 'location', 'findingType'] as const) {
      if (typeof r[field] !== 'string' || !(r[field] as string).trim()) {
        return { ok: false, error: `Record ${i}: "${field}" must be a non-empty string.` };
      }
    }
    if (typeof r.areaM2 !== 'number' || !Number.isFinite(r.areaM2) || r.areaM2 < 0) {
      return { ok: false, error: `Record ${i}: "areaM2" must be a number >= 0.` };
    }
    if (
      r.volumeM3 !== undefined &&
      (typeof r.volumeM3 !== 'number' || !Number.isFinite(r.volumeM3) || r.volumeM3 < 0)
    ) {
      return { ok: false, error: `Record ${i}: "volumeM3" must be a number >= 0 when present.` };
    }

    const optionals: Partial<RepairLogRecord> = {};
    for (const field of ['method', 'distressAsphalt', 'distressConcrete', 'severity'] as const) {
      const parsed = optionalString(r[field], i, field);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      if (parsed.value !== undefined) optionals[field] = parsed.value;
    }

    records.push({
      date: (r.date as string).trim(),
      facility: (r.facility as string).trim(),
      location: (r.location as string).trim(),
      findingType: (r.findingType as string).trim(),
      areaM2: r.areaM2,
      ...(r.volumeM3 !== undefined ? { volumeM3: r.volumeM3 as number } : {}),
      ...optionals,
    });
  }

  return { ok: true, data: records };
}

export async function parseRepairLogFile(file: File): Promise<RepairLogValidationResult> {
  try {
    const text = await file.text();
    return validateRepairLog(JSON.parse(text));
  } catch {
    return { ok: false, error: 'Could not parse file as JSON.' };
  }
}

/* =============================================================================
 * BRANCH RESOLUTION
 * ========================================================================== */

/**
 * Joins one record to a Section code.
 *
 * TWO RULES THAT MATTER.
 *
 * 1. The location text beats the facility label. Three records in the
 *    committed log are filed under a group whose members they do not belong
 *    to - 'Exit M1' and 'Sta 2500 depan n7m' under GATE TAXIWAY N1-N9, and
 *    'EXIT N6' under GATE CROSS TAXIWAY N3M-N8M. The facility column is a
 *    filing convenience; the location text is the better key. Follow the
 *    location and report that you did (`via: 'location'`).
 *
 * 2. Accept a location match only when the extracted code exists in the loaded
 *    network. LOCATION_BRANCH_PATTERN matches shapes the network does not have
 *    (M3-M6 among them), so this guard - not the pattern - is what stops a
 *    phantom branch entering the register.
 *
 * A facility label that is neither a known branch nor a group (APRON KARGO,
 * 2 records) resolves to nothing. Do not guess a branch for it.
 */
export function resolveBranch(
  record: Pick<RepairLogRecord, 'facility' | 'location'>,
  knownBranches: ReadonlySet<string>,
): BranchResolution {
  const facility = record.facility.trim();

  const direct = FACILITY_TO_BRANCH[facility];
  if (direct) return { ok: true, branch: direct, via: 'facility' };

  if (FACILITY_GROUPS.includes(facility)) {
    const match = LOCATION_BRANCH_PATTERN.exec(record.location.toUpperCase());
    if (match && knownBranches.has(match[1])) {
      return { ok: true, branch: match[1], via: 'location' };
    }
    return { ok: false, via: 'unresolved_group' };
  }

  return { ok: false, via: 'unknown_facility' };
}

/* =============================================================================
 * AGGREGATION
 * ========================================================================== */

/** The distress a record reports: asphalt first, then concrete. A record with
 *  neither is skipped and counted - see stats.skippedNoDistress. */
function distressOf(record: RepairLogRecord): string | undefined {
  return record.distressAsphalt?.trim() || record.distressConcrete?.trim() || undefined;
}

/**
 * Aggregates a validated log into per-branch distress tallies plus the counts
 * the coverage panel reports.
 *
 * `knownBranches` is the Section codes actually loaded for the survey year, so
 * a branch that a future dataset drops stops resolving rather than lingering.
 */
export function aggregateRepairLog(
  records: RepairLogRecord[],
  knownBranches: ReadonlySet<string>,
): RepairLogAggregate {
  const tallies = new Map<string, Map<string, DistressTally>>();
  const unresolved: UnresolvedRecord[] = [];
  const stats: RepairLogStats = {
    total: records.length,
    byFacility: 0,
    byLocation: 0,
    unresolvedGroup: 0,
    unknownFacility: 0,
    skippedNoDistress: 0,
    aggregatedWithoutSeverity: 0,
    aggregated: 0,
    branchesCovered: 0,
  };

  records.forEach((record, index) => {
    const resolution = resolveBranch(record, knownBranches);
    if (resolution.ok) {
      if (resolution.via === 'facility') stats.byFacility += 1;
      else stats.byLocation += 1;
    } else {
      if (resolution.via === 'unresolved_group') stats.unresolvedGroup += 1;
      else stats.unknownFacility += 1;
      unresolved.push({
        index,
        facility: record.facility,
        location: record.location,
        reason: resolution.via,
      });
    }

    // Counted independently of resolution: a row with no distress type is a
    // gap in the log itself, whether or not it named a branch.
    const distress = distressOf(record);
    if (!distress) {
      stats.skippedNoDistress += 1;
      return;
    }
    if (!resolution.ok) return;

    if (!record.severity) stats.aggregatedWithoutSeverity += 1;
    stats.aggregated += 1;

    let branch = tallies.get(resolution.branch);
    if (!branch) {
      branch = new Map<string, DistressTally>();
      tallies.set(resolution.branch, branch);
    }
    addObservation(branch, distress, { area: record.areaM2, severity: record.severity });
  });

  const byBranch: Record<string, DistressTally[]> = {};
  for (const [branch, map] of tallies) byBranch[branch] = [...map.values()];
  stats.branchesCovered = tallies.size;

  return { byBranch, stats, unresolved };
}
