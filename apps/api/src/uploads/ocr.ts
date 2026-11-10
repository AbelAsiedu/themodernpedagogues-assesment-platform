import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { LIMITS } from "./errors.js";

const run = promisify(execFile);
const TIMEOUT_MS = 60_000;

export interface OcrOptions { enabled: boolean; lang: string }

let probed: Promise<boolean> | undefined;
/** True when both programs exist. Checked once per process; never throws. */
export function ocrAvailable(opts: OcrOptions): Promise<boolean> {
  if (!opts.enabled) return Promise.resolve(false);
  probed ??= Promise.all([run("tesseract", ["--version"], { timeout: 5000 }), run("pdftoppm", ["-v"], { timeout: 5000 })]).then(() => true, () => false);
  return probed;
}

// At most this many OCR jobs run at once; others wait their turn. Keeps a burst of scans from exhausting the server.
const MAX_CONCURRENT = 2;
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  return slot(async () => {
    const dir = await mkdtemp(join(tmpdir(), "tmp-ocr-"));
    try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }).catch(() => undefined); }
  });
}

// Programs are run with an argument array (no shell), inside a private temp directory, with a time limit.
const tess = (img: string, lang: string) => run("tesseract", [img, "stdout", "-l", lang, "--psm", "3"], { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }).then((r) => r.stdout);

export function ocrImage(bytes: Uint8Array, ext: "png" | "jpg", opts: OcrOptions): Promise<string> {
  return withTmp(async (dir) => {
    const f = join(dir, `in.${ext}`);
    await writeFile(f, bytes, { mode: 0o600 });
    return tess(f, opts.lang);
  });
}

/** OCR the first pages of a PDF. Returns one text per page that was read. */
export function ocrPdf(bytes: Uint8Array, opts: OcrOptions, pages: number = LIMITS.ocrPages): Promise<string[]> {
  return withTmp(async (dir) => {
    const f = join(dir, "in.pdf");
    await writeFile(f, bytes, { mode: 0o600 });
    await run("pdftoppm", ["-q", "-r", "150", "-l", String(pages), "-png", f, join(dir, "p")], { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
    const imgs = (await readdir(dir)).filter((n) => /^p-\d+\.png$/.test(n)).sort();
    const out: string[] = [];
    for (const n of imgs) { out.push(await tess(join(dir, n), opts.lang)); }
    return out;
  });
}
