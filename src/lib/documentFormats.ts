import { Readability } from "@mozilla/readability";
import JSZip from "jszip";
import mammoth from "mammoth";
import TurndownService from "turndown";

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });

type ZipKind = "docx" | "epub" | "odt";

function extensionOf(name: string): string {
  return name.toLowerCase().split(".").pop() ?? "";
}

function htmlToMarkdown(html: string, readable = true): string {
  const parser = new DOMParser();
  const document = parser.parseFromString(html, "text/html");
  document.querySelectorAll("script, style, noscript, nav, footer, header, aside, form, iframe").forEach((node) => node.remove());
  const root = readable ? new Readability(document).parse()?.content : document.body.innerHTML;
  const markdown = turndown.turndown(root || document.body.innerHTML).replace(/\n{3,}/g, "\n\n").trim();
  if (!markdown) throw new Error("That file contains no readable text.");
  return markdown;
}

function plainTextToMarkdown(text: string): string {
  const markdown = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!markdown) throw new Error("That file contains no readable text.");
  return markdown;
}

function parseCsv(text: string, delimiter: string): string {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) throw new Error("That table contains no readable rows.");
  const width = Math.max(...rows.map((r) => r.length));
  const escaped = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const normalized = rows.map((r) => [...r, ...Array(width - r.length).fill("")].map(escaped));
  return [
    `| ${normalized[0].join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...normalized.slice(1).map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

function rtfToMarkdown(text: string): string {
  // Strip destination groups whose content should never surface (font/color tables, doc info, embedded objects, images, etc.)
  const stripDestinations = (input: string): string => {
    const destinations = /\\(fonttbl|colortbl|stylesheet|info|generator|pict|object|footer|header|footnote|filetbl|xmlns|listtable|listoverridetable|revtbl|rsidtbl|themedata|colorschememapping|latentstyles|\*)\b/;
    let out = "";
    let depth = 0;
    let skipDepth = -1;
    let i = 0;
    while (i < input.length) {
      const char = input[i];
      if (char === "{") {
        depth++;
        if (skipDepth === -1) {
          const rest = input.slice(i + 1, i + 40);
          if (destinations.test(rest)) skipDepth = depth;
        }
        i++;
        continue;
      }
      if (char === "}") {
        if (skipDepth === depth) skipDepth = -1;
        depth--;
        i++;
        continue;
      }
      if (skipDepth === -1) out += char;
      i++;
    }
    return out;
  };

  let output = stripDestinations(text)
    .replace(/\\u(-?\d+)\??/g, (_, code) => String.fromCharCode(((Number(code) % 65536) + 65536) % 65536))
    .replace(/\\'[0-9a-fA-F]{2}/g, (match) => String.fromCharCode(parseInt(match.slice(2), 16)))
    .replace(/\\par\b/g, "\n\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\\line\b/g, "\n")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\\/g, "");
  return plainTextToMarkdown(output);
}

async function loadZip(file: File, kind: ZipKind): Promise<JSZip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error(`“${file.name}” is not a valid ${kind.toUpperCase()} archive.`);
  }
  const required = kind === "docx" ? "word/document.xml" : kind === "odt" ? "content.xml" : "META-INF/container.xml";
  if (!zip.file(required)) throw new Error(`“${file.name}” is not a valid ${kind.toUpperCase()} file.`);
  return zip;
}

async function epubToMarkdown(file: File): Promise<string> {
  const zip = await loadZip(file, "epub");
  const container = new DOMParser().parseFromString(await zip.file("META-INF/container.xml")!.async("string"), "application/xml");
  const rootfile = container.querySelector("rootfile")?.getAttribute("full-path");
  if (!rootfile) throw new Error(`“${file.name}” has no EPUB package file.`);
  const base = rootfile.slice(0, rootfile.lastIndexOf("/") + 1);
  const opf = new DOMParser().parseFromString(await zip.file(rootfile)!.async("string"), "application/xml");
  const manifest = new Map(Array.from(opf.querySelectorAll("manifest > item")).map((item) => [item.id, item.getAttribute("href") ?? ""]));
  const chapters: string[] = [];
  for (const item of Array.from(opf.querySelectorAll("spine > itemref"))) {
    const href = manifest.get(item.getAttribute("idref") ?? "");
    if (!href) continue;
    const path = `${base}${decodeURIComponent(href.split("#")[0])}`;
    const entry = zip.file(path);
    if (!entry) continue;
    const chapter = htmlToMarkdown(await entry.async("string"), false);
    chapters.push(chapter);
  }
  if (!chapters.length) throw new Error(`“${file.name}” has no readable EPUB chapters.`);
  return chapters.map((chapter, index) => `# Chapter ${index + 1}\n\n${chapter}`).join("\n\n");
}

async function odtToMarkdown(file: File): Promise<string> {
  const zip = await loadZip(file, "odt");
  const xml = await zip.file("content.xml")!.async("string");
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const paragraphs = [
    ...Array.from(document.getElementsByTagName("text:p")),
    ...Array.from(document.getElementsByTagName("text:h")),
  ].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const markdown = paragraphs.map((node) => {
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return node.localName === "h" ? `${"#".repeat(Math.min(6, Number(node.getAttribute("text:outline-level")) || 1))} ${text}` : text;
  }).filter(Boolean).join("\n\n");
  return plainTextToMarkdown(markdown);
}

export async function convertDocument(file: File): Promise<string> {
  const extension = extensionOf(file.name);
  switch (extension) {
    case "docx":
      await loadZip(file, "docx");
      return htmlToMarkdown((await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })).value, false);
    case "rtf":
      return rtfToMarkdown(await file.text());
    case "html":
    case "htm":
      return htmlToMarkdown(await file.text());
    case "csv":
      return parseCsv(await file.text(), ",");
    case "tsv":
      return parseCsv(await file.text(), "\t");
    case "epub":
      return epubToMarkdown(file);
    case "odt":
      return odtToMarkdown(file);
    case "txt":
    case "md":
    case "markdown":
      return plainTextToMarkdown(await file.text());
    default:
      throw new Error(`Unsupported file type: .${extension || "unknown"}.`);
  }
}
