#!/usr/bin/env node
/**
 * build-texture.mjs — CSV paket TEKSTUR_2026 (hasil\<runway>\) jadi berkas seed tab Macrotexture.
 *
 *   node scripts/texture/build-texture.mjs --src data-raw/texture-2026/06-24 --runway 06-24 \
 *        --survey 2026-06 --label "Jun 2026" --date 2026-06-28            # cek saja, cetak laporan
 *   node scripts/texture/build-texture.mjs ... --write                    # tulis berkas
 *
 * Keluaran dengan --write: public/data/texture-<runway>-<tahun>.json, dan laporan ditambahkan ke
 * scripts/texture/build-texture-report-<tanggal>.txt. Ada error -> semuanya dicetak, exit 1, tidak ada yang ditulis.
 * Logikanya di src/lib/texture-import.ts, modul yang sama dengan panel admin.
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { TEXTURE_UNIT_COUNT } from "../../src/config/texture.ts";
import { buildTexture, textureSurvey } from "../../src/lib/texture-import.ts";

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
if (!TEXTURE_UNIT_COUNT[a.runway]) {
  console.error(`--runway must be one of ${Object.keys(TEXTURE_UNIT_COUNT).join(", ")}`);
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

const build = buildTexture(files, {
  runway: a.runway,
  nUnits: TEXTURE_UNIT_COUNT[a.runway],
  survey: textureSurvey({ id: a.survey, label: a.label, date: a.date, lcms: a.lcms }),
  sourceKind: "seed",
  requireComplete: true,
  sha256,
});

for (const i of build.issues) console[i.level === "error" ? "error" : "warn"](`${i.level.toUpperCase()} ${i.check ?? ""} ${i.message}`);
const report = build.report.join("\n");
console.log(report);
if (!build.data) {
  console.error("Nothing written: the input has errors.");
  process.exit(1);
}

if (a.write) {
  const dataPath = join(ROOT, "public/data", `texture-${a.runway}-${a.date.slice(0, 4)}.json`);
  const reportPath = join(HERE, `build-texture-report-${new Date().toISOString().slice(0, 10)}.txt`);
  mkdirSync(dirname(dataPath), { recursive: true });
  writeFileSync(dataPath, `${JSON.stringify(build.data)}\n`);
  appendFileSync(reportPath, `==== RWY ${a.runway.replace("-", "/")} ====\n${report}\n\n`);
  console.log(`Wrote ${dataPath}\nAppended to ${reportPath}`);
}
