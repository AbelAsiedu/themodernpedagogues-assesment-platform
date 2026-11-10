import { LIMITS, UploadError } from "./errors.js";
import { attr, decodeEntities, elements, stripElements, textOf } from "./xml.js";
import { readZip, utf8 } from "./zip.js";

export interface Grid { name: string; rows: string[][] }

const colIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/[^A-Za-z]/g, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Read every sheet of an .xlsx into rows of strings. Formulas show their last saved value; dates are not interpreted. */
export function readXlsx(buf: Uint8Array): Grid[] {
  const files = readZip(buf, (n) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  const wb = files["xl/workbook.xml"];
  if (!wb) throw new UploadError("unreadable", "This doesn't look like a valid Excel file.");
  const rels = new Map<string, string>();
  for (const m of elements(utf8(files["xl/_rels/workbook.xml.rels"] ?? new Uint8Array()), "Relationship")) {
    const id = attr(m.attrs, "Id"), target = attr(m.attrs, "Target");
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const shared: string[] = [];
  if (files["xl/sharedStrings.xml"]) {
    for (const si of elements(utf8(files["xl/sharedStrings.xml"]), "si")) {
      // Rich text has several <r><t> runs; phonetic hints (<rPh>) are not part of the text.
      shared.push(textOf(stripElements(si.body, "rPh"), "t").join(""));
      if (shared.length > 200_000) break;
    }
  }
  const grids: Grid[] = [];
  const sheets = [...elements(utf8(wb), "sheet")].slice(0, LIMITS.sheets);
  for (const sh of sheets) {
    const name = attr(sh.attrs, "name") ?? `Sheet ${grids.length + 1}`;
    const rid = attr(sh.attrs, "r:id");
    const path = rid ? rels.get(rid) : undefined;
    const xml = path ? files[path] : undefined;
    if (!xml) continue;
    grids.push({ name, rows: readSheet(utf8(xml), shared) });
  }
  return grids;
}

function readSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rm of elements(xml, "row")) {
    const rowNum = parseInt(attr(rm.attrs, "r") ?? "", 10);
    if (!rowNum || rowNum > LIMITS.sheetRows) { if (rowNum > LIMITS.sheetRows) break; continue; }
    const cells: string[] = [];
    for (const cm of elements(rm.body, "c")) {
      const head = cm.attrs, body = cm.body;
      const ref = attr(head, "r");
      const col = ref ? colIndex(ref) : cells.length;
      if (col < 0 || col >= LIMITS.sheetCols) continue;
      const t = attr(head, "t");
      let value = "";
      if (t === "s") value = shared[parseInt(/<v>([^<]*)<\/v>/.exec(body)?.[1] ?? "", 10)] ?? "";
      else if (t === "inlineStr") value = textOf(body, "t").join("");
      else if (t === "str") value = decodeEntities(elements(body, "v").next().value?.body ?? "");
      else if (t === "b") value = /<v>1<\/v>/.test(body) ? "TRUE" : "FALSE";
      else if (t === "e") value = "";
      else {
        const v = /<v>([^<]*)<\/v>/.exec(body)?.[1];
        if (v !== undefined && v !== "") { const num = Number(v); value = Number.isFinite(num) ? String(num) : decodeEntities(v); }
      }
      while (cells.length < col) cells.push("");
      cells[col] = value.trim();
    }
    while (rows.length < rowNum - 1) rows.push([]);
    rows[rowNum - 1] = cells;
  }
  return rows;
}
