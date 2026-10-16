// Browser-side export helpers for the friction profile: SVG from the recharts
// <svg> elements, and a generic file download. The charts take literal colours
// as props (not CSS classes), so a serialised clone looks the same as on screen.

export interface SvgPart {
  svg: SVGSVGElement;
  /** Horizontal offset in the export (room for a label column). */
  x?: number;
  /** Text lines drawn in the offset area, vertically centred on the part. */
  label?: string[];
}

export interface LegendItem {
  label: string;
  color: string;
  dash?: string;
}

const NS = "http://www.w3.org/2000/svg";
const PAD = 12;
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** One SVG document: title lines, the legend, then the chart svgs stacked top to bottom on a light background. */
export function profileSvg(parts: SvgPart[], titleLines: string[], legend: LegendItem[]): string {
  const width = Math.max(640, ...parts.map((p) => (p.x ?? 0) + Number(p.svg.getAttribute("width")))) + PAD * 2;

  // No explicit xmlns attribute: XMLSerializer adds it for namespaced elements, and a second one makes the file invalid XML.
  const root = el("svg", { width, height: 0, "font-family": FONT });
  root.appendChild(el("title", {}, titleLines[0] ?? "Skid resistance profile"));
  const background = el("rect", { width, height: 0, fill: "#FBFAF7" });
  root.appendChild(background);

  let y = PAD + 12;
  titleLines.forEach((line, i) => {
    root.appendChild(el("text", { x: PAD, y, "font-size": 13, "font-weight": i === 0 ? 600 : 400, fill: i === 0 ? "#1F1F1F" : "#555555" }, line));
    y += 17;
  });

  // Legend: swatch + label, wrapped to the available width (labels are measured by length, close enough for a legend).
  y += 4;
  let lx = PAD;
  for (const item of legend) {
    const w = 34 + item.label.length * 6;
    if (lx + w > width - PAD) {
      lx = PAD;
      y += 16;
    }
    root.appendChild(el("line", { x1: lx, y1: y - 4, x2: lx + 22, y2: y - 4, stroke: item.color, "stroke-width": 2.5, ...(item.dash ? { "stroke-dasharray": item.dash } : {}) }));
    root.appendChild(el("text", { x: lx + 28, y, "font-size": 11, fill: "#333333" }, item.label));
    lx += w;
  }
  y += 14;

  for (const part of parts) {
    const h = Number(part.svg.getAttribute("height"));
    const clone = part.svg.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll(".recharts-tooltip-cursor").forEach((n) => n.remove());
    clone.removeAttribute("style");
    clone.setAttribute("x", String(PAD + (part.x ?? 0)));
    clone.setAttribute("y", String(y));
    root.appendChild(clone);
    (part.label ?? []).forEach((line, i) => {
      root.appendChild(el("text", { x: PAD, y: y + h / 2 - 4 + i * 13, "font-size": 11, fill: "#333333", "font-weight": i === 0 ? 600 : 400 }, line));
    });
    y += h;
  }

  background.setAttribute("height", String(y + PAD));
  root.setAttribute("height", String(y + PAD));
  root.setAttribute("viewBox", `0 0 ${width} ${y + PAD}`);
  return new XMLSerializer().serializeToString(root);
}

/** Saves text as a file through a temporary link. */
export function downloadText(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
