import { extractText, getDocumentProxy } from "unpdf";
import { LIMITS, UploadError } from "./errors.js";

export interface PdfPages { pages: string[]; pageCount: number; truncated: boolean }

/** Quality gate: some PDFs have a text layer that is really garbage (broken font maps). Real prose is mostly letters and spaces. */
export function looksLikeText(s: string): boolean {
  if (s.length < 40) return false;
  let ctrl = 0, letters = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 32 && c !== 10 && c !== 13 && c !== 9) ctrl++;
    else if (c === 0xfffd) ctrl++;
    else if (/\p{L}/u.test(ch)) letters++;
  }
  return ctrl / s.length <= 0.02 && letters / s.length >= 0.5; // letters among all characters, spaces and digits included
}

export async function readPdf(buf: Uint8Array): Promise<PdfPages> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf), { isEvalSupported: false } as never);
    const pageCount = pdf.numPages;
    if (pageCount > LIMITS.pdfPages * 4) throw new UploadError("too_large", `This PDF has ${pageCount} pages, which is too many. Split it into smaller files.`, 413);
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (text as string[]).slice(0, LIMITS.pdfPages);
    return { pages, pageCount, truncated: pageCount > LIMITS.pdfPages };
  } catch (e) {
    if (e instanceof UploadError) throw e;
    const msg = e instanceof Error ? e.message : "";
    if (/password/i.test(msg)) throw new UploadError("unreadable", "This PDF is password-protected. Remove the password and upload it again.");
    throw new UploadError("unreadable", "This PDF couldn't be read. It may be damaged.");
  }
}
