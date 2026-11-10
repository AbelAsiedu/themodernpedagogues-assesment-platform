import { LIMITS, UploadError } from "./errors.js";

/** Width and height from the file header, without decoding the picture. Used to refuse decompression-bomb images before OCR. */
export function imageSize(b: Uint8Array): { type: "png" | "jpg"; w: number; h: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { type: "png", w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1]!;
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      const len = dv.getUint16(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: "jpg", h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

export function checkImage(b: Uint8Array) {
  const s = imageSize(b);
  if (!s || !s.w || !s.h) throw new UploadError("unreadable", "This picture couldn't be read. Use a PNG or JPG.");
  if (s.w * s.h > LIMITS.imageMegapixels * 1e6) throw new UploadError("too_large", "This picture is too large to read. Use a smaller photo or scan.", 413);
  return s;
}
