import { unzipSync } from "fflate";
import { LIMITS, UploadError } from "./errors.js";

/** Read only the wanted entries of a zip, refusing oversized ones. Never writes anything to disk. */
export function readZip(buf: Uint8Array, wanted: (name: string) => boolean): Record<string, Uint8Array> {
  let seen = 0, total = 0;
  try {
    return unzipSync(buf, {
      filter: (f) => {
        if (++seen > LIMITS.zipEntries) throw new UploadError("unreadable", "This file has too many parts to read safely.");
        if (!wanted(f.name)) return false;
        total += f.originalSize;
        if (f.originalSize > LIMITS.zipEntryBytes || total > LIMITS.zipTotalBytes) throw new UploadError("too_large", "This file expands to too much data to read safely.", 413);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof UploadError) throw e;
    throw new UploadError("unreadable", "This file looks damaged, so it couldn't be read. Try saving it again from the original program.");
  }
}

export const entryNames = (buf: Uint8Array): string[] => {
  const names: string[] = [];
  try {
    unzipSync(buf, { filter: (f) => { if (names.length < LIMITS.zipEntries) names.push(f.name); return false; } });
  } catch { /* unreadable zip: caller sees no names */ }
  return names;
};

export const utf8 = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);
