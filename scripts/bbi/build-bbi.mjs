#!/usr/bin/env node
/**
 * build-bbi.mjs — empat CSV *_web.csv paket BBI jadi berkas seed tab Roughness (BBI).
 *
 *   node scripts/bbi/build-bbi.mjs --src data-raw/bbi-06-24-2026 --runway 06-24 --survey 2026-06 \
 *        --label "Jun 2026" --date 2026-06-28 --lcms 2062903736            # cek saja, cetak laporan
 *   node scripts/bbi/build-bbi.mjs ... --write                             # tulis berkas
 *
 * Keluaran dengan --write: public/data/bbi-<runway>-<tahun>.json, bbi-<runway>-<tahun>-trace.json, dan
 * scripts/bbi/build-bbi-report-<tanggal>.txt. Ada error -> semuanya dicetak, exit 1, tidak ada yang ditulis.
 * Logikanya di src/lib/bbi-import.ts, modul yang sama dengan panel admin.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BBI_UNIT_COUNT } from "../../src/config/bbi.ts";
import { bbiSurvey, buildBbi } from "../../src/lib/bbi-import.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

const { values: a } = parseArgs({
  options: {
    src: { type: "string" },
    runway: { type: "string" },
    survey: { type: "string" },
    label: { type: "string" },
    date: { type: "string" },
    lcms: { type: "string" },
    write: { type: "boolean", default: false },
  },
});
for (const k of ["src", "runway", "survey", "label", "date"]) {
  if (!a[k]) {
    console.error(`--${k} is required`);
    process.exit(1);
  }
}
if (!BBI_UNIT_COUNT[a.runway]) {
  console.error(`--runway must be one of ${Object.keys(BBI_UNIT_COUNT).join(", ")}`);
  process.exit(1);
}

const sha256 = {};
const files = readdirSync(a.src)
  .filter((n) => n.toLowerCase().endsWith(".csv"))
  .map((name) => {
    const bytes = readFileSync(join(a.src, name));
    sha256[name] = createHash("sha256").update(bytes).digest("hex");
    return { name, text: bytes.toString("utf-8") };
  });

const build = buildBbi(files, {
  runway: a.runway,
  nUnits: BBI_UNIT_COUNT[a.runway],
  survey: bbiSurvey({ id: a.survey, label: a.label, date: a.date, lcms: a.lcms }),
  sourceKind: "seed",
  requireCompleteTrace: true,
  sha256,
});

for (const i of build.issues) console[i.level === "error" ? "error" : "warn"](`${i.level.toUpperCase()} ${i.check ?? ""} ${i.message}`);
const report = build.report.join("\n");
console.log(report);
if (!build.units || !build.trace) {
  console.error("Nothing written: the input has errors.");
  process.exit(1);
}

if (a.write) {
  const year = a.date.slice(0, 4);
  const unitsPath = join(ROOT, "public/data", `bbi-${a.runway}-${year}.json`);
  const tracePath = join(ROOT, "public/data", `bbi-${a.runway}-${year}-trace.json`);
  const reportPath = join(HERE, `build-bbi-report-${new Date().toISOString().slice(0, 10)}.txt`);
  mkdirSync(dirname(unitsPath), { recursive: true });
  writeFileSync(unitsPath, `${JSON.stringify(build.units)}\n`);
  writeFileSync(tracePath, `${JSON.stringify(build.trace)}\n`);
  writeFileSync(reportPath, `${report}\n`);
  console.log(`Wrote ${unitsPath}\nWrote ${tracePath}\nWrote ${reportPath}`);
}
