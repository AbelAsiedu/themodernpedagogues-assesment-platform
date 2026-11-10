/**
 * CSV for spreadsheets. Two things matter beyond quoting:
 * a cell that starts with = + - @ (or a tab/CR) is run as a FORMULA by Excel and Sheets, and names come from user input,
 * so such cells get a leading apostrophe. Numbers are written as numbers, never run through that rule.
 */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const csvRow = (cells: (string | number | null | undefined)[]) => cells.map(csvCell).join(",");

/** Safe file name from a title: letters, digits, dashes only. */
export const safeFileName = (title: string) => title.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "results";
