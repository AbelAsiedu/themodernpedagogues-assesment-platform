import { strToU8, zipSync } from "fflate";

/** Synthetic files for the upload tests. Built here so no third-party material is stored in the repository. */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i: number) => String.fromCharCode(65 + i);

export type Cell = string | number | null;

export function buildXlsx(sheets: { name: string; rows: Cell[][] }[]): Uint8Array {
  const shared: string[] = [];
  const idx = new Map<string, number>();
  const sst = (s: string) => { if (!idx.has(s)) { idx.set(s, shared.length); shared.push(s); } return idx.get(s)!; };
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="officeDocument" Target="xl/workbook.xml"/></Relationships>`),
  };
  const sheetTags: string[] = [], rels: string[] = [];
  sheets.forEach((sh, n) => {
    const rows = sh.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => {
      if (c === null || c === "") return "";
      const ref = `${colName(ci)}${ri + 1}`;
      return typeof c === "number" ? `<c r="${ref}"><v>${c}</v></c>` : `<c r="${ref}" t="s"><v>${sst(c)}</v></c>`;
    }).join("")}</row>`).join("");
    files[`xl/worksheets/sheet${n + 1}.xml`] = strToU8(`<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`);
    sheetTags.push(`<sheet name="${esc(sh.name)}" sheetId="${n + 1}" r:id="rId${n + 1}"/>`);
    rels.push(`<Relationship Id="rId${n + 1}" Type="worksheet" Target="worksheets/sheet${n + 1}.xml"/>`);
  });
  files["xl/workbook.xml"] = strToU8(`<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags.join("")}</sheets></workbook>`);
  files["xl/_rels/workbook.xml.rels"] = strToU8(`<?xml version="1.0"?><Relationships>${rels.join("")}</Relationships>`);
  files["xl/sharedStrings.xml"] = strToU8(`<?xml version="1.0"?><sst>${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`);
  return zipSync(files);
}

export const WAYGROUND_HEADER = ["Question Text", "Question Type", "Option 1", "Option 2", "Option 3", "Option 4", "Option 5", "Correct Answer", "Time in seconds", "Image Link", "Answer explanation"];

/** The layout of a Wayground/Quizizz export, with invented questions. */
export function waygroundRows(): Cell[][] {
  return [
    ["Wayground quiz template (instructions row)"],
    WAYGROUND_HEADER,
    ["What is 2 + 2?", "Multiple Choice", "3", "4", "5", "6", null, 2, 20, null, "Two plus two is four."],
    ["Which planet is known as the Red Planet?", "Multiple Choice", "Venus", "Mars", "Jupiter", null, null, "2", 30, null, "Mars looks red."],
    ["The sun is a star.", "True/False", "True", "False", null, null, null, "1", 15, null, null],
    ["Name the capital of Ghana.", "Fill in the Blank", "Accra", "accra", null, null, null, 1, 30, null, null],
    ["Explain why the sky is blue.", "Open-Ended", null, null, null, null, null, null, 60, null, null],
    ["Pick all prime numbers.", "Checkbox", "2", "3", "4", null, null, "1,2", 30, null, null],
    ["Which is the largest ocean?", "Multiple Choice", "Atlantic", "Pacific", null, null, null, 7, 30, null, null],
    ["What is 2 + 2?!", "Multiple Choice", "3", "4", "5", null, null, 2, 30, null, null],
    ["Which gas do plants absorb?", "Multiple Choice", "Oxygen", "Carbon dioxide", null, null, null, "Carbon dioxide", 45, "https://example.com/x.png", null],
  ];
}

export function buildDocx(paras: { text: string; heading?: boolean }[]): Uint8Array {
  const body = paras.map((p) => `<w:p>${p.heading ? `<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${esc(p.text)}</w:t></w:r></w:p>`).join("");
  return zipSync({
    "[Content_Types].xml": strToU8(`<Types/>`),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`),
  });
}

export function buildPptx(slides: string[][]): Uint8Array {
  const files: Record<string, Uint8Array> = { "[Content_Types].xml": strToU8(`<Types/>`), "ppt/presentation.xml": strToU8(`<p:presentation/>`) };
  slides.forEach((paras, i) => { files[`ppt/slides/slide${i + 1}.xml`] = strToU8(`<p:sld>${paras.map((t) => `<a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p>`).join("")}</p:sld>`); });
  return zipSync(files);
}

/** A small valid one-page PDF with real text, for the text path. Pass no lines to get a page with no text. */
export function buildPdf(lines: string[]): Uint8Array {
  const stream = lines.length ? `BT /F1 12 Tf 50 750 Td 14 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, "\\$&")}) Tj T*`).join(" ")} ET` : "";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n"; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(out);
}

/** Multipart body for fastify.inject. `parts` may be in any order. */
export function multipart(parts: ({ name: string; value: string } | { name: string; filename: string; data: Uint8Array | Buffer; type?: string })[]) {
  const boundary = "----tmpTestBoundary" + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const p of parts) {
    if ("filename" in p) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\nContent-Type: ${p.type ?? "application/octet-stream"}\r\n\r\n`), Buffer.from(p.data), Buffer.from("\r\n"));
    } else chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}
