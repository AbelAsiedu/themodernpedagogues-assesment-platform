/** A problem with an uploaded file that is safe to show to the person who uploaded it. */
export class UploadError extends Error {
  constructor(public code: "too_large" | "unsupported" | "unreadable" | "no_text" | "legacy_format", message: string, public status = 400) {
    super(message);
  }
}

export const LIMITS = {
  /** Largest single file entry we will decompress from an Office file. Guards against zip bombs. */
  zipEntryBytes: 25 * 1024 * 1024,
  /** All parts we read from one Office file, added together. */
  zipTotalBytes: 60 * 1024 * 1024,
  zipEntries: 2000,
  /** Total extracted text kept per upload. */
  totalChars: 400_000,
  /** A section is a unit a teacher can pick; sections aim for this size. */
  sectionChars: 5000,
  maxSections: 200,
  sheetRows: 5000,
  sheetCols: 60,
  sheets: 20,
  pdfPages: 150,
  ocrPages: 15,
  imageMegapixels: 16,
  questionRows: 500,
} as const;
