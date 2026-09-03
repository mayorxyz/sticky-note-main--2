import { getDocument, GlobalWorkerOptions, Util } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Highlight, MarkColor, Note, PageData } from "../data/types";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const PDF_LIMITS = { maxBytes: 20 * 1024 * 1024, maxPages: 300 };

export class PdfNoTextError extends Error {
  constructor() {
    super(
      "This PDF has no extractable text layer — it looks like a scanned document. OCR is out of scope for v1, so please use a text-based PDF."
    );
    this.name = "PdfNoTextError";
  }
}

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  numPages: number;
  destroy: () => Promise<void>;
}

export async function openPdf(file: File): Promise<OpenedPdf> {
  if (file.size > PDF_LIMITS.maxBytes) {
    throw new Error(
      `“${file.name}” is ${(file.size / 1048576).toFixed(1)} MB — the limit is 20 MB per file.`
    );
  }
  const data = await file.arrayBuffer();
  const task = getDocument({ data });
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (e) {
    throw new Error(`Could not read “${file.name}” as a PDF. ${e instanceof Error ? e.message : ""}`);
  }
  if (doc.numPages > PDF_LIMITS.maxPages) {
    const n = doc.numPages;
    await task.destroy();
    throw new Error(`This PDF has ${n} pages — the limit is ${PDF_LIMITS.maxPages}.`);
  }
  try {
    await assertTextLayer(doc);
  } catch (e) {
    await task.destroy();
    throw e;
  }
  return { doc, numPages: doc.numPages, destroy: () => task.destroy() };
}

async function assertTextLayer(doc: PDFDocumentProxy): Promise<void> {
  const probeCount = Math.min(doc.numPages, 5);
  let chars = 0;
  for (let i = 1; i <= probeCount; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    for (const it of tc.items) if ("str" in it) chars += it.str.trim().length;
    page.cleanup();
  }
  if (chars < 40) throw new PdfNoTextError();
}

/* ————— Reflow: text extraction → clean Markdown ————— */

interface Line {
  y: number;
  h: number;
  runs: { text: string; bold: boolean; italic: boolean; x: number }[];
  fontSize: number;
  boldChars: number;
  totalChars: number;
  x: number;
}

interface RawRun {
  text: string;
  bold: boolean;
  italic: boolean;
  x: number;
  fontSize: number;
}

export async function extractMarkdown(
  doc: PDFDocumentProxy,
  onProgress?: (done: number, total: number) => void
): Promise<string> {
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const styles = tc.styles as Record<string, { fontFamily?: string }>;

    // 1. Collect raw runs into Y-buckets
    const rawLines = new Map<number, { y: number; h: number; runs: RawRun[] }>();

    for (const item of tc.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const transformed = Util.transform(vp.transform, item.transform);
      
      const h = Math.abs(transformed[3]) || Math.abs(transformed[0]) * 0.8 || 10;
      const x = transformed[4];
      
      // FIX: transformed[5] is already top-down in viewport space. 
      // Removing the vp.height subtraction fixes the upside-down reading order.
      const y = transformed[5]; 
      
      const bucket = nearestBucket(rawLines, y, Math.max(3, h * 0.45));
      
      const styleName = ("fontName" in item ? styles[item.fontName]?.fontFamily : "") ?? "";
      const rawFontName = "fontName" in item ? item.fontName : "";
      const nameProbe = `${styleName} ${rawFontName}`;
      const bold = /bold|black|heavy|semi[- ]?bold|demi/i.test(nameProbe);
      const italic = /italic|oblique|slant/i.test(nameProbe);
      
      const lineY = bucket !== null ? bucket : y;
      let line = rawLines.get(lineY);
      if (!line) {
        line = { y: lineY, h, runs: [] };
        rawLines.set(lineY, line);
      }
      line.h = Math.max(line.h, h);
      line.runs.push({ text: item.str, bold, italic, x, fontSize: h });
    }

    // 2. Sort lines top-to-bottom
    const sortedRawLines = Array.from(rawLines.values()).sort((a, b) => a.y - b.y);
    
    const lines: Line[] = [];
    for (const rawLine of sortedRawLines) {
      // Sort runs strictly left-to-right before merging text
      rawLine.runs.sort((a, b) => a.x - b.x);
      
      const finalRuns: { text: string; bold: boolean; italic: boolean; x: number }[] = [];
      let boldChars = 0;
      let totalChars = 0;
      let maxFontSize = 0;
      
      for (const run of rawLine.runs) {
        maxFontSize = Math.max(maxFontSize, run.fontSize);
        const cleanText = run.text.trim();
        totalChars += cleanText.length;
        if (run.bold) boldChars += cleanText.length;
        
        if (finalRuns.length > 0) {
          const last = finalRuns[finalRuns.length - 1];
          const space = needsSpace(last.text, run.text) ? " " : "";
          
          if (last.bold === run.bold && last.italic === run.italic) {
            last.text += space + run.text;
          } else {
            last.text += space;
            finalRuns.push({ text: run.text, bold: run.bold, italic: run.italic, x: run.x });
          }
        } else {
          finalRuns.push({ text: run.text, bold: run.bold, italic: run.italic, x: run.x });
        }
      }
      
      lines.push({
        y: rawLine.y,
        h: rawLine.h,
        runs: finalRuns,
        fontSize: maxFontSize,
        boldChars,
        totalChars,
        x: rawLine.runs[0]?.x ?? 0
      });
    }

    const baseH = modeFontSize(lines.map((l) => l.fontSize));

    let prev: Line | null = null;
    let para: string[] = [];
    const flush = () => {
      if (para.length) {
        out.push(para.join(" "));
        out.push("");
        para = [];
      }
    };
    
    let previousWasHeading = false;
    for (const line of lines) {
      const rawText = line.runs.map((run) => run.text).join("").replace(/\s+/g, " ").trim();
      if (!rawText) continue;
      
      const boldRatio = line.totalChars > 0 ? line.boldChars / line.totalChars : 0;
      
      // Detect ALL CAPS lines, which are very commonly used for headings in PDFs
      const letters = rawText.replace(/[^a-zA-Z]/g, "");
      const isAllCaps = letters.length > 2 && letters === letters.toUpperCase();
      
      let headingLevel = headingLevelFor(line.fontSize, baseH, boldRatio, rawText.length);
      
      // If it's not detected by font/bold, but it's ALL CAPS and short, make it an H3
      if (headingLevel === 0 && isAllCaps && rawText.length < 100) {
        headingLevel = 3;
      }

      const text = formatLine(line, headingLevel);
      
      if (!prev) {
        para.push(text);
      } else {
        // gap is now correctly calculated as positive vertical distance between baselines
        const gap = line.y - prev.y;
        const newPara =
          gap > Math.max(prev.h, line.h) * 1.65 || headingLevel > 0 || previousWasHeading || isBullet(rawText);
        if (newPara) flush();
        para.push(text);
      }
      prev = line;
      previousWasHeading = headingLevel > 0;
    }
    flush();
    if (p < doc.numPages) out.push("", "");
    page.cleanup();
    onProgress?.(p, doc.numPages);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function nearestBucket(lines: Map<number, { y: number }>, y: number, tol: number): number | null {
  let best: number | null = null;
  let bestD = tol;
  for (const key of lines.keys()) {
    const d = Math.abs(key - y);
    if (d < bestD) {
      bestD = d;
      best = key;
    }
  }
  return best;
}

function headingLevelFor(fontSize: number, medianSize: number, boldRatio: number, length: number): number {
  if (length > 140 || length === 0) return 0;
  const ratio = fontSize / medianSize;
  if (ratio >= 1.5) return 1;
  if (ratio >= 1.2) return 2;
  if (ratio >= 1.05 && boldRatio >= 0.4) return 2;
  if (boldRatio >= 0.6 && length < 100) return 3;
  if (boldRatio >= 0.9 && length < 120) return 3;
  return 0;
}

function formatLine(line: Line, headingLevel: number): string {
  let text = line.runs
    .map((run) => {
      // Extract leading/trailing spaces so they don't break Markdown markers like ** text **
      const match = run.text.match(/^(\s*)(.*?)(\s*)$/);
      if (!match || !match[2]) return run.text;
      const [, leading, core, trailing] = match;
      const value = core.replace(/\s+/g, " ");
      
      let formatted = value;
      if (run.bold && run.italic) formatted = `***${value}***`;
      else if (run.bold) formatted = `**${value}**`;
      else if (run.italic) formatted = `*${value}*`;
      
      return leading + formatted + trailing;
    })
    .join("")
    .trim();
    
  const bullet = text.match(/^[•●▪◦]\s*/);
  if (bullet) text = `- ${text.slice(bullet[0].length)}`;
  return headingLevel ? `${"#".repeat(headingLevel)} ${text.replace(/^[-*+]\s+/, "")}` : text;
}

function isBullet(text: string): boolean {
  return /^(?:[-*+]\s+|[•●▪◦]\s+)/.test(text);
}

function modeFontSize(sizes: number[]): number {
  if (!sizes.length) return 10;
  const rounded = sizes.map((s) => Math.round(s * 2) / 2);
  const counts = new Map<number, number>();
  for (const s of rounded) counts.set(s, (counts.get(s) ?? 0) + 1);
  let best = rounded[0];
  let bestCount = 0;
  for (const [size, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = size;
    }
  }
  return best;
}

function needsSpace(a: string, b: string): boolean {
  if (!a || !b) return false;
  const last = a[a.length - 1];
  const first = b[0];
  if (/[\s\-—–(/[]$/.test(last)) return false;
  if (/^[,.:;!?)\]%"'”’]/.test(first)) return false;
  if (/[。、，！？；：）】」』]$/.test(last) || /^[。、，！？；：（【「『]/.test(first)) return false;
  return true;
}

/* ————— Layout: page rendering ————— */

export async function renderPages(
  doc: PDFDocumentProxy,
  onProgress?: (done: number, total: number) => void,
  scale = 1.5
): Promise<PageData[]> {
  const pages: PageData[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D is unavailable in this browser.");
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;

    const tc = await page.getTextContent();
    const textItems = tc.items.flatMap((item) => {
      if (!("str" in item) || !item.str.trim()) return [];
      const transformed = Util.transform(vp.transform, item.transform);
      const h = Math.hypot(transformed[2], transformed[3]) || 10;
      const x = transformed[4];
      const y = transformed[5] - h;
      const w = "width" in item ? item.width * vp.scale : h;
      if (w <= 0 || h <= 0) return [];
      return [
        {
          str: item.str,
          x: x / vp.width,
          y: Math.max(0, y) / vp.height,
          w: w / vp.width,
          h: h / vp.height,
        },
      ];
    });

    pages.push({
      pageNum: p,
      imageUrl: canvas.toDataURL("image/jpeg", 0.85),
      textItems,
      w: canvas.width,
      h: canvas.height,
    });
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
    onProgress?.(p, doc.numPages);
  }
  return pages;
}

export async function makeThumb(imageUrl: string, maxW = 420): Promise<string> {
  const img = await loadImage(imageUrl);
  const s = Math.min(1, maxW / img.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * s);
  canvas.height = Math.round(img.height * s);
  const ctx = canvas.getContext("2d");
  if (!ctx) return imageUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode the rendered page."));
    img.src = src;
  });
}

/* ————— Ingest ————— */

export async function ingestPdf(
  file: File,
  mode: "reflow" | "layout",
  onProgress?: (label: string, frac: number) => void
): Promise<{ markdown: string; pages?: PageData[]; thumb?: string; numPages: number }> {
  const opened = await openPdf(file);
  const { doc } = opened;
  try {
    onProgress?.("Lifting the text layer…", 0.02);
    const markdown = await extractMarkdown(doc, (d, t) =>
      onProgress?.(`Reading the type — page ${d} of ${t}`, 0.02 + 0.4 * (d / t))
    );
    let pages: PageData[] | undefined;
    let thumb: string | undefined;
    if (mode === "layout") {
      pages = await renderPages(doc, (d, t) =>
        onProgress?.(`Pressing pages — ${d} of ${t}`, 0.44 + 0.52 * (d / t))
      );
      onProgress?.("Drying the ink…", 0.98);
      thumb = await makeThumb(pages[0].imageUrl);
    }
    onProgress?.("Done", 1);
    return { markdown, pages, thumb, numPages: opened.numPages };
  } finally {
    await opened.destroy();
  }
}

/* ————— Flattened annotated PDF export (hand-rolled writer) —————
 * Emits one JPEG XObject per source page, bakes marks (all six mark types)
 * underneath the image and draws sticky-note boxes in a base-14 font on top.
 * No compression, classic xref — deliberately boring and robust.
 */

const HL_RGB: Record<MarkColor, [number, number, number]> = {
  sun: [0.98, 0.83, 0.28],
  rose: [0.96, 0.55, 0.68],
  moss: [0.45, 0.78, 0.5],
  sky: [0.47, 0.72, 0.95],
  amber: [0.98, 0.68, 0.28],
  violet: [0.7, 0.55, 0.93],
  teal: [0.3, 0.75, 0.7],
  graphite: [0.55, 0.55, 0.6],
  coral: [0.97, 0.55, 0.42],
};

function wrapLines(text: string, width: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (trial.length > width && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = trial;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function stripNonLatin(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7e]/g, "");
}

function buildPdfFromJpegs(
  items: { jpeg: Uint8Array<ArrayBuffer>; w: number; h: number }[]
): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const chunks: Uint8Array<ArrayBufferLike>[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const pushStr = (s: string) => {
    const b = enc.encode(s);
    chunks.push(b);
    pos += b.length;
  };
  const pushBin = (b: Uint8Array<ArrayBuffer>) => {
    chunks.push(b);
    pos += b.length;
  };
  const obj = (n: number, body: string) => {
    offsets[n] = pos;
    pushStr(`${n} 0 obj\n${body}\nendobj\n`);
  };

  const n = items.length;
  const fontObj = 3 + 2 * n;
  const kids = items.map((_, i) => `${4 + 2 * i} 0 R`).join(" ");

  pushStr("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  items.forEach((it, i) => {
    const pageN = 4 + 2 * i;
    const imgN = 5 + 2 * i;
    obj(
      pageN,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${it.w} ${it.h}] /Resources << /XObject << /Im${i} ${imgN} 0 R >> /Font << /F1 ${fontObj} 0 R >> >> /Contents ${pageN + 1} 0 R >>`
    );
    const stream = `q ${it.w} 0 0 ${it.h} 0 0 cm /Im${i} Do Q`;
    obj(pageN + 1, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    offsets[imgN] = pos;
    pushStr(
      `${imgN} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${it.w} /Height ${it.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${it.jpeg.length} >>\nstream\n`
    );
    pushBin(it.jpeg);
    pushStr("\nendstream\nendobj\n");
  });
  obj(fontObj, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

  const xrefPos = pos;
  const total = fontObj + 1;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  pushStr(xref);

  const out = new Uint8Array(pos);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export async function exportAnnotatedPdf(
  doc: { title: string; pages?: PageData[] },
  ann: { highlights: Highlight[]; notes: Note[] }
): Promise<Blob> {
  if (!doc.pages?.length) {
    throw new Error("Layout pages are needed for a flattened PDF export.");
  }
  const items: { jpeg: Uint8Array<ArrayBuffer>; w: number; h: number }[] = [];
  for (const p of doc.pages) {
    const img = await loadImage(p.imageUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is unavailable in this browser.");
    ctx.drawImage(img, 0, 0);

    for (const h of ann.highlights) {
      if (h.anchor.kind !== "page" || h.anchor.page !== p.pageNum) continue;
      const [r, g, b] = HL_RGB[h.color] ?? HL_RGB.sun;
      for (const rect of h.anchor.rects) {
        const x = rect.x * canvas.width;
        const y = rect.y * canvas.height;
        const w = rect.w * canvas.width;
        const hh = rect.h * canvas.height;
        const dark = `rgb(${Math.round(r * 190)}, ${Math.round(g * 190)}, ${Math.round(b * 190)})`;
        if (h.type === "highlight") {
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
          ctx.fillRect(x, y, w, hh);
          ctx.globalAlpha = 1;
        } else if (h.type === "underline") {
          const t = Math.max(2, hh * 0.13);
          ctx.fillStyle = dark;
          ctx.fillRect(x, y + hh - t, w, t);
        } else if (h.type === "strikethrough") {
          const t = Math.max(2, hh * 0.12);
          ctx.fillStyle = dark;
          ctx.fillRect(x, y + hh * 0.45, w, t);
        } else if (h.type === "squiggly") {
          ctx.strokeStyle = dark;
          ctx.lineWidth = Math.max(1.6, hh * 0.09);
          ctx.beginPath();
          const baseY = y + hh * 0.92;
          const amp = Math.max(2, hh * 0.2);
          const lambda = Math.max(8, hh * 0.6);
          for (let sx = 0; sx <= w; sx += 2) {
            const sy = baseY + Math.sin((sx / lambda) * Math.PI * 2) * amp * 0.5;
            if (sx === 0) ctx.moveTo(x + sx, sy);
            else ctx.lineTo(x + sx, sy);
          }
          ctx.stroke();
        } else if (h.type === "box") {
          ctx.strokeStyle = dark;
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, y + 1, Math.max(1, w - 2), Math.max(1, hh - 2));
        } else if (h.type === "circle") {
          ctx.strokeStyle = dark;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(x + w / 2, y + hh / 2, Math.max(2, w / 2 - 1), Math.max(2, hh / 2 - 1), 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    const notes = ann.notes.filter((nt) => nt.page === p.pageNum);
    notes.forEach((nt, i) => {
      const pos = nt.position as { x?: number; y?: number; w?: number };
      const fx = typeof pos.x === "number" ? pos.x : 0.62;
      const fy = typeof pos.y === "number" ? pos.y : 0.08 + i * 0.16;
      const bw = Math.min((pos.w ?? 0.3) * canvas.width, canvas.width * 0.45);
      const text = nt.content.trim() || "(empty note)";
      const lines = wrapLines(text, Math.max(10, Math.floor(bw / 9)));
      const fs = Math.max(12, canvas.width * 0.021);
      const bh = lines.length * fs * 1.35 + fs * 1.4;
      const bx = Math.min(fx * canvas.width, canvas.width - bw - 6);
      const by = Math.min(fy * canvas.height, canvas.height - bh - 6);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = fs * 0.7;
      ctx.shadowOffsetY = fs * 0.25;
      ctx.fillStyle = "#fdf6a9";
      ctx.fillRect(bx, by, bw, bh);
      ctx.restore();
      ctx.fillStyle = nt.ink === "red" ? "#b02a2a" : nt.ink === "blue" ? "#1342ae" : "#5d5648";
      ctx.font = `${fs}px Helvetica, Arial, sans-serif`;
      lines.forEach((ln, j) => {
        ctx.fillText(stripNonLatin(ln), bx + fs * 0.6, by + fs * 1.5 + j * fs * 1.35);
      });
    });

    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("JPEG encoding failed."))), "image/jpeg", 0.88)
    );
    items.push({
      jpeg: new Uint8Array(await blob.arrayBuffer()),
      w: Math.round(img.width * 0.75),
      h: Math.round(img.height * 0.75),
    });
    canvas.width = 0;
    canvas.height = 0;
  }
  const bytes = buildPdfFromJpegs(items);
  return new Blob([bytes], { type: "application/pdf" });
}