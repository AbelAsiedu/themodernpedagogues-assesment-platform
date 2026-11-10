import { UploadError } from "./errors.js";

/** Decode text. UTF-8 first; if that isn't valid, assume Windows-1252 (what older Excel/Notepad exports use). */
export function decodeText(buf: Uint8Array): string {
  let s: string;
  try { s = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { s = new TextDecoder("windows-1252").decode(buf); }
  if (s.includes("\u0000")) throw new UploadError("unsupported", "This type of file can't be read. Use .xlsx, .docx, .pptx, .pdf, .csv, .txt or .md (or a PNG/JPG picture).");
  return s.replace(/^﻿/, "");
}

/** RFC 4180-style CSV/TSV with quoted fields and embedded newlines. The delimiter is detected from the first line. */
export function parseCsv(text: string, maxRows = 5000, maxCols = 60): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  const endField = () => { if (row.length < maxCols) row.push(field.trim()); field = ""; };
  const endRow = () => { endField(); if (row.some((c) => c !== "") ) rows.push(row); else rows.push([]); row = []; };
  for (let i = 0; i < text.length && rows.length <= maxRows; i++) {
    const ch = text[i]!;
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch;
    } else if (ch === '"' && field === "") inQ = true;
    else if (ch === delim) endField();
    else if (ch === "\n") endRow();
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) endRow();
  return rows;
}
