import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Download, Upload, RotateCcw, FileSpreadsheet } from "lucide-react";
import readXlsxFile from "read-excel-file/universal";
import { useData, useSectionsWithUnits, useEffectiveYearData } from "@/lib/data-store";
import { findPaverSheets, paverToUnits } from "@/lib/paver-import";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { downloadJson, sectionsFileName, unitsFileName, parseGeoJSONFile } from "@/lib/geojson-io";

interface ImportExportPanelProps {
  year: string;
}

export default function ImportExportPanel({ year }: ImportExportPanelProps) {
  const { importSectionsGeoJSON, importUnitsGeoJSON, resetDrafts } = useData();
  const { sectionsFC, unitsBySection } = useEffectiveYearData(year);
  const sectionsWithUnits = useSectionsWithUnits(year);

  const sectionsFileInput = useRef<HTMLInputElement>(null);
  const excelFileInput = useRef<HTMLInputElement>(null);
  const [pickedSection, setPickedSection] = useState("");
  const excelSection = sectionsWithUnits.includes(pickedSection) ? pickedSection : (sectionsWithUnits[0] ?? "");

  const handleDownloadSections = () => {
    if (!sectionsFC) {
      toast.error("No section data to export for this year yet.");
      return;
    }
    downloadJson(sectionsFileName(year), sectionsFC);
  };

  const handleDownloadUnits = (section: string) => {
    const fc = unitsBySection[section];
    if (!fc) {
      toast.error(`No sample-unit data to export for ${section} yet.`);
      return;
    }
    downloadJson(unitsFileName(year, section), fc);
  };

  const handleImportSectionsFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const result = await parseGeoJSONFile(file);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    importSectionsGeoJSON(year, result.data);
    toast.success(`Imported section geometry for ${year}`);
  };

  // PAVER Excel: PCI + distresses only, onto the runway's existing polygons.
  const handleImportExcelFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const base = unitsBySection[excelSection];
    if (!base) {
      toast.error(`No sample-unit map for ${excelSection || "this runway"} in ${year}.`);
      return;
    }
    let sheets;
    try {
      sheets = await readXlsxFile(file);
    } catch {
      toast.error("Could not read the file as an Excel workbook (.xlsx).");
      return;
    }
    const { pci, distress } = findPaverSheets(sheets);
    if (!pci || !distress) {
      toast.error('Workbook needs a PCI sheet ("Sample Number", "PCI …") and a distress sheet ("Description", "Severity", "Deduct", …).');
      return;
    }
    const result = paverToUnits(base, pci, distress);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    importUnitsGeoJSON(year, excelSection, result.data);
    const { samples, distresses, movedByCoordinate, onMatchingPolygon } = result.report;
    toast.success(`Imported ${samples} sample units and ${distresses} distresses for ${excelSection} (${year})`, {
      description: movedByCoordinate
        ? `${movedByCoordinate} distress rows were placed by their coordinate because their Sample Number column disagreed.`
        : undefined,
    });
    if (onMatchingPolygon < samples) {
      toast.warning(
        `Only ${onMatchingPolygon} of ${samples} sample coordinates fall on the map unit with the same number. Check the sample-unit numbering direction.`,
        { duration: 10000 }
      );
    }
  };

  return (
    <div className="panel-surface rounded-lg p-4 space-y-5">
      <h2 className="text-sm font-bold text-foreground">Import / Export — {year}</h2>

      <div className="space-y-2">
        <p className="panel-label">Export (download the committed JSON files)</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={handleDownloadSections}>
            <Download size={13} />
            {sectionsFileName(year)}
          </Button>
          {sectionsWithUnits.map((section) => (
            <Button
              key={section}
              variant="secondary"
              size="sm"
              onClick={() => handleDownloadUnits(section)}
            >
              <Download size={13} />
              {unitsFileName(year, section)}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="panel-label">Import sample-unit survey (PAVER Excel .xlsx)</p>
        <p className="text-xs text-muted-foreground">
          Takes PCI per sample unit and the distress list. Dimension, PCN and last major construction are
          edited in the section table above.
        </p>
        {sectionsWithUnits.length === 0 ? (
          <p className="text-xs text-muted-foreground">No runway with a sample-unit map in {year}.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={excelSection} onValueChange={setPickedSection}>
              <SelectTrigger className="h-8 w-36 text-xs" aria-label="Runway">
                <SelectValue placeholder="Runway" />
              </SelectTrigger>
              <SelectContent>
                {sectionsWithUnits.map((section) => (
                  <SelectItem key={section} value={section}>
                    RWY {section}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => excelFileInput.current?.click()}>
              <FileSpreadsheet size={13} />
              Upload Excel
            </Button>
            <input
              ref={excelFileInput}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={handleImportExcelFile}
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="panel-label">Import section geometry (GeoJSON, EPSG:4326 / CRS84 only)</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => sectionsFileInput.current?.click()}>
            <Upload size={13} />
            Upload sections
          </Button>
          <input
            ref={sectionsFileInput}
            type="file"
            accept=".json,.geojson,application/json,application/geo+json"
            className="hidden"
            onChange={handleImportSectionsFile}
          />
        </div>
      </div>

      <div className="pt-3 border-t border-border">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <RotateCcw size={13} />
              Reset all drafts
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset all admin drafts?</AlertDialogTitle>
              <AlertDialogDescription>
                This discards every unsaved edit, added year, and import across all survey years in
                this browser, and reverts to the committed data. Export anything you want to keep
                first.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  resetDrafts();
                  toast.success("Drafts reset");
                }}
              >
                Reset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
