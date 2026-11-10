import { entryNames } from "./zip.js";
import type { UploadKind } from "@tmp/shared";
import { UploadError } from "./errors.js";

const startsWith = (b: Uint8Array, bytes: number[]) => bytes.every((x, i) => b[i] === x);

/** Decide what a file is from its CONTENT. The file name and the browser's claimed type are never trusted. */
export function detectKind(b: Uint8Array, filename: string): UploadKind | "text" {
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47]) || startsWith(b, [0xff, 0xd8, 0xff])) return "image";
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0])) throw new UploadError("legacy_format", "Older Office files (.doc, .xls, .ppt) can't be read. Open the file and use Save As to make a .docx, .xlsx or .pptx, then upload that.");
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) {
    const names = new Set(entryNames(b));
    if (names.has("xl/workbook.xml")) return "xlsx";
    if (names.has("word/document.xml")) return "docx";
    if (names.has("ppt/presentation.xml")) return "pptx";
    throw new UploadError("unsupported", "This is a compressed file, not a Word, Excel or PowerPoint document.");
  }
  if (startsWith(b, [0x52, 0x61, 0x72, 0x21]) || startsWith(b, [0x37, 0x7a, 0xbc, 0xaf]) || startsWith(b, [0x7f, 0x45, 0x4c, 0x46]) || startsWith(b, [0x4d, 0x5a])) {
    throw new UploadError("unsupported", "This type of file isn't supported.");
  }
  // Anything else must be real text. The name only decides between csv and txt later.
  void filename;
  return "text";
}
