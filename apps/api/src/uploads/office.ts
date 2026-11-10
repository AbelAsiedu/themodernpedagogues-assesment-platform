import { UploadError } from "./errors.js";
import { chunkParagraphs, type RawSection } from "./sections.js";
import { elements, textOf } from "./xml.js";
import { readZip, utf8 } from "./zip.js";

/** Paragraph texts of a .docx. A new section starts at each heading so teachers can pick topics. */
export function readDocx(buf: Uint8Array): RawSection[] {
  const files = readZip(buf, (n) => n === "word/document.xml");
  const doc = files["word/document.xml"];
  if (!doc) throw new UploadError("unreadable", "This doesn't look like a valid Word file.");
  const xml = utf8(doc);
  const groups: { title: string; paras: string[] }[] = [{ title: "Document", paras: [] }];
  for (const pm of elements(xml, "w:p")) {
    const body = pm.body;
    // Tabs and line breaks become spaces so words in neighbouring runs don't glue together.
    const text = textOf(body.replace(/<w:(?:tab|br|cr)\s*\/>/g, "<w:t> </w:t>"), "w:t").join("").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (/<w:pStyle\s+w:val="(?:Heading\d|Title)"/.test(body) && text.length < 120) groups.push({ title: text, paras: [] });
    else groups[groups.length - 1]!.paras.push(text);
  }
  const out: RawSection[] = [];
  for (const g of groups) if (g.paras.length) out.push(...chunkParagraphs(g.paras, g.title === "Document" ? "Document" : g.title));
  return out;
}

/** One section per slide (text boxes only; pictures and speaker notes are not read). */
export function readPptx(buf: Uint8Array): RawSection[] {
  const files = readZip(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const slides = Object.keys(files).sort((a, b) => parseInt(/(\d+)\.xml$/.exec(a)![1]!, 10) - parseInt(/(\d+)\.xml$/.exec(b)![1]!, 10));
  if (!slides.length) throw new UploadError("unreadable", "This doesn't look like a valid PowerPoint file.");
  const out: RawSection[] = [];
  for (const name of slides) {
    const xml = utf8(files[name]!);
    const paras = [...elements(xml, "a:p")].map((p) => textOf(p.body.replace(/<a:br\s*\/>/g, "<a:t> </a:t>"), "a:t").join("").trim()).filter(Boolean);
    if (paras.length) out.push({ label: `Slide ${parseInt(/(\d+)\.xml$/.exec(name)![1]!, 10)}`, text: paras.join("\n") });
  }
  return out;
}
