/**
 * Minimal XML text helpers. No XML parser is used, so there is nothing to attack (no entity expansion, no external references),
 * and every scan below is linear in the size of the input (indexOf only, no backtracking patterns), so a hostile file cannot
 * make it slow by being malformed.
 */

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z]{2,5});/g, (m, g: string) => {
    if (g[0] === "#") {
      const code = g[1] === "x" || g[1] === "X" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) && code > 8 && code < 0x110000 && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
    }
    return NAMED[g] ?? m;
  });
}

const isBoundary = (c: number) => c === 32 || c === 62 || c === 47 || c === 9 || c === 10 || c === 13;

/** Every `<tag ...>body</tag>` (or `<tag .../>`) in order. A tag with no closing tag ends the scan. Tags must not nest inside themselves. */
export function* elements(xml: string, tag: string): Generator<{ attrs: string; body: string }> {
  const open = "<" + tag, close = "</" + tag + ">";
  let i = 0;
  for (;;) {
    const s = xml.indexOf(open, i);
    if (s < 0) return;
    const after = s + open.length;
    if (!isBoundary(xml.charCodeAt(after))) { i = after; continue; }
    const gt = xml.indexOf(">", after);
    if (gt < 0) return;
    if (xml.charCodeAt(gt - 1) === 47) { yield { attrs: xml.slice(after, gt - 1), body: "" }; i = gt + 1; continue; }
    const e = xml.indexOf(close, gt + 1);
    if (e < 0) return;
    yield { attrs: xml.slice(after, gt), body: xml.slice(gt + 1, e) };
    i = e + close.length;
  }
}

/** Decoded text of every `<tag>…</tag>`. */
export const textOf = (xml: string, tag: string): string[] => [...elements(xml, tag)].map((e) => decodeEntities(e.body));

/** Remove every `<tag>…</tag>` (used to drop phonetic hints from Excel strings). */
export function stripElements(xml: string, tag: string): string {
  const open = "<" + tag, close = "</" + tag + ">";
  let out = "", i = 0;
  for (;;) {
    const s = xml.indexOf(open, i);
    if (s < 0 || !isBoundary(xml.charCodeAt(s + open.length))) { if (s >= 0) { out += xml.slice(i, s + open.length); i = s + open.length; continue; } return out + xml.slice(i); }
    const e = xml.indexOf(close, s);
    if (e < 0) return out + xml.slice(i, s);
    out += xml.slice(i, s); i = e + close.length;
  }
}

export function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? decodeEntities(m[1]!) : undefined;
}
