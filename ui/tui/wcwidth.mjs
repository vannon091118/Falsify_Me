// FalsifyMe TUI - Display-Breite (wcwidth) + Truncation-Helfer
// Verantwortung: Unicode-Breiten und layout-sicheres Kuerzen.
// Pure, kein I/O, keine React-Imports.

// Kern-Ranges: kombinierende Zeichen + Zero-Width-Controls (praktischer
// wcwidth-Kompromiss; deckt die in TUIs relevanten Faelle ab).
const COMBINING_RANGES = [
  [0x0300, 0x036f], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f], [0xfe00, 0xfe0f], [0x200b, 0x200f], [0x202a, 0x202e],
  [0x180b, 0x180d], [0x3099, 0x309a], [0x2060, 0x2064], [0xfeff, 0xfeff],
];

const inCombiningRange = (c) => {
  for (const [a, b] of COMBINING_RANGES) {
    if (c >= a && c <= b) return true;
  }
  return false;
};

export const isWide = (c) =>
  (c >= 0x1100 && c <= 0x115f) ||
  ((c >= 0x2e80 && c <= 0xa4cf) && c !== 0x303f) ||
  (c >= 0xac00 && c <= 0xd7a3) ||
  (c >= 0xf900 && c <= 0xfaff) ||
  (c >= 0xfe30 && c <= 0xfe4f) ||
  (c >= 0xff00 && c <= 0xff60) ||
  (c >= 0xffe0 && c <= 0xffe6) ||
  (c >= 0x20000 && c <= 0x2fffd) ||
  (c >= 0x30000 && c <= 0x3fffd);

export const charWidth = (ch) => {
  const c = ch.codePointAt(0);
  if (c < 32 || (c >= 0x7f && c < 0xa0)) return 0; // Steuerzeichen
  if (inCombiningRange(c)) return 0;
  return isWide(c) ? 2 : 1;
};

export const strWidth = (str) => {
  let w = 0;
  for (const ch of str) w += charWidth(ch);
  return w;
};

export const padEnd = (str, width) => {
  const pad = width - strWidth(str);
  return pad > 0 ? str + " ".repeat(pad) : str;
};

// Kuerzt str auf Display-Breite maxWidth (mit Ellipsis, Breite-bewusst).
export const truncate = (str, maxWidth, ell = "…") => {
  if (maxWidth <= 0) return "";
  if (strWidth(str) <= maxWidth) return str;
  const budget = maxWidth - strWidth(ell);
  if (budget <= 0) return ell.slice(0, Math.max(0, maxWidth));
  let out = "";
  let w = 0;
  for (const ch of str) {
    const cw = charWidth(ch);
    if (w + cw > budget) break;
    out += ch;
    w += cw;
  }
  return out + ell;
};

// Fuellt width Spalten mit Zeichen ch (ch darf Breite 2 haben).
export const fill = (ch, width) => {
  if (width <= 0) return "";
  const cw = Math.max(1, strWidth(ch));
  return truncate(ch.repeat(Math.ceil(width / cw)), width, "");
};

export const clamp = (min, v, max) => Math.min(max, Math.max(min, v));