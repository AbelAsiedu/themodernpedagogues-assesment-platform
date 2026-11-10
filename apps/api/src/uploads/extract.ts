import { MAX_UPLOAD_BYTES, type UploadKind } from "@tmp/shared";
import type { StoredQuestionTable, StoredSection } from "../db/schema.js";
import { detectKind } from "./detect.js";
import { LIMITS, UploadError } from "./errors.js";
import { checkImage } from "./image.js";
import { ocrAvailable, ocrImage, ocrPdf, type OcrOptions } from "./ocr.js";
import { readDocx, readPptx } from "./office.js";
import { looksLikeText, readPdf } from "./pdf.js";
import { parseQuestionTable } from "./questionTable.js";
import { capSections, chunkParagraphs, type RawSection } from "./sections.js";
import { decodeText, parseCsv } from "./text.js";
import { readXlsx, type Grid } from "./xlsx.js";

export interface Extracted { kind: UploadKind; sections: StoredSection[]; questionTable: StoredQuestionTable | null; warnings: string[] }

const OCR_WARNING = "This text was read from a picture (OCR), so it may contain mistakes. Check the questions carefully.";

const gridText = (g: Grid) => g.rows.filter((r) => r.some(Boolean)).map((r) => r.filter(Boolean).join(" | "));

function textSections(text: string, md: boolean): RawSection[] {
  // Markdown headings start a new section; otherwise paragraphs are packed by size.
  const groups: { title: string; paras: string[] }[] = [{ title: "Text", paras: [] }];
  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const first = block.trim().split(/\r?\n/, 1)[0] ?? "";
    const h = md ? /^#{1,3}\s+(.{1,100})$/.exec(first) : null;
    if (h) groups.push({ title: h[1]!.trim(), paras: [block.trim().slice(first.length).trim()].filter(Boolean) });
    else groups[groups.length - 1]!.paras.push(block.replace(/\r?\n/g, " ").trim());
  }
  return groups.flatMap((g) => (g.paras.length ? chunkParagraphs(g.paras, g.title) : []));
}

function pdfSections(pages: string[], ocr: boolean): RawSection[] {
  const out: RawSection[] = [];
  let cur: string[] = [], from = 0, len = 0;
  const flush = (to: number) => { if (cur.length) { out.push({ label: from === to ? `Page ${from}` : `Pages ${from}–${to}`, text: cur.join("\n"), ocr }); cur = []; len = 0; } };
  pages.forEach((p, i) => {
    const t = p.replace(/[ \t]+/g, " ").trim();
    if (!t) return;
    if (!cur.length) from = i + 1;
    else if (len + t.length > LIMITS.sectionChars) { flush(i); from = i + 1; }
    cur.push(t); len += t.length;
  });
  flush(pages.length);
  // A single page can exceed the target: split those further.
  return out.flatMap((s) => (s.text.length > LIMITS.sectionChars * 1.5 ? chunkParagraphs(s.text.split("\n"), s.label).map((c) => ({ ...c, ocr: s.ocr })) : [s]));
}

/**
 * Turn an uploaded file into text sections and, where the file holds a table of ready-made questions, a parsed question table.
 * Everything here is deterministic and runs on the server. Errors thrown are UploadError with messages safe to show.
 */
export async function extractUpload(buf: Uint8Array, filename: string, ocr: OcrOptions): Promise<Extracted> {
  if (buf.length === 0) throw new UploadError("unreadable", "This file is empty.");
  if (buf.length > MAX_UPLOAD_BYTES) throw new UploadError("too_large", `This file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Split it into smaller files.`, 413);
  const detected = detectKind(buf, filename);
  const warnings: string[] = [];
  let kind: UploadKind;
  let raw: RawSection[] = [];
  let table: StoredQuestionTable | null = null;

  if (detected === "xlsx") {
    kind = "xlsx";
    const grids = readXlsx(buf);
    table = parseQuestionTable(grids);
    raw = grids.flatMap((g) => { const lines = gridText(g); return lines.length ? chunkParagraphs(lines, g.name) : []; });
  } else if (detected === "docx") { kind = "docx"; raw = readDocx(buf); }
  else if (detected === "pptx") { kind = "pptx"; raw = readPptx(buf); }
  else if (detected === "pdf") {
    kind = "pdf";
    const { pages, pageCount, truncated } = await readPdf(buf);
    if (looksLikeText(pages.join("\n"))) {
      raw = pdfSections(pages, false);
      if (truncated) warnings.push(`This PDF has ${pageCount} pages. Only the first ${LIMITS.pdfPages} were read.`);
    } else if (await ocrAvailable(ocr)) {
      const read = await ocrPdf(buf, ocr).catch(() => { throw new UploadError("unreadable", "Text recognition failed on this PDF. Try a clearer scan or a text-based PDF."); });
      raw = pdfSections(read, true);
      warnings.push(OCR_WARNING);
      if (pageCount > LIMITS.ocrPages) warnings.push(`Only the first ${LIMITS.ocrPages} of ${pageCount} pages were read by OCR.`);
      if (!looksLikeText(read.join("\n"))) raw = [];
    } else {
      throw new UploadError("no_text", "This PDF has no readable text (it may be a scan, or its fonts are broken), and text recognition (OCR) isn't available on this server. Upload a text-based PDF, or a Word or Excel file instead.");
    }
  } else if (detected === "image") {
    kind = "image";
    checkImage(buf);
    if (!(await ocrAvailable(ocr))) throw new UploadError("no_text", "Reading text from pictures (OCR) isn't available on this server. Upload a Word, Excel or text-based PDF file instead.");
    const t = await ocrImage(buf, checkImage(buf).type, ocr).catch(() => { throw new UploadError("unreadable", "Text recognition failed on this picture. Try a clearer photo."); });
    if (looksLikeText(t)) raw = chunkParagraphs(t.split(/\n\s*\n/), "Picture").map((s) => ({ ...s, ocr: true }));
    warnings.push(OCR_WARNING);
  } else {
    const text = decodeText(buf);
    const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
    if (ext === "csv" || ext === "tsv") {
      kind = "csv";
      const rows = parseCsv(text, LIMITS.sheetRows, LIMITS.sheetCols);
      const grid = { name: "Table", rows };
      table = parseQuestionTable([grid]);
      raw = chunkParagraphs(gridText(grid), "Table");
    } else {
      kind = "txt";
      raw = textSections(text, ext === "md" || ext === "markdown");
    }
  }

  const sections = capSections(raw, warnings).map((s, i): StoredSection => ({ id: `s${i + 1}`, label: s.label.slice(0, 120), text: s.text, ocr: !!s.ocr }));
  const chars = sections.reduce((n, s) => n + s.text.length, 0);
  if (!table && chars < 20) throw new UploadError("no_text", "No readable text was found in this file.");
  return { kind, sections, questionTable: table, warnings: [...new Set(warnings)] };
}
