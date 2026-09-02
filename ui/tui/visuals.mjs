// FalsifyMe TUI - Visual tokens inspired by Crush / CharmTone.
// Rendering only: no state, no IO, no product semantics.
export const COLORS = Object.freeze({
  primary: "#6B50FF",      // CharmTone Charple
  secondary: "#FF60FF",    // CharmTone Dolly
  mint: "#68FFD6",         // CharmTone Bok
  active: "#00FFB2",       // CharmTone Julep
  info: "#00A4FF",         // CharmTone Malibu
  warning: "#E8FE96",      // CharmTone Zest
  error: "#EB4268",        // CharmTone Sriracha
  errorAlt: "#FF577D",     // CharmTone Coral
  bright: "#F7F6FB",       // CharmTone Salt
  text: "#ECEBF0",         // CharmTone Sash
  muted: "#858392",        // CharmTone Squid
  subtle: "#605F6B",       // CharmTone Oyster
  panel: "#2D2C36",        // CharmTone BBQ
  panelDeep: "#201F26",    // CharmTone Pepper
});

export const PROCESS = Object.freeze({
  upcoming: "#858392",     // gray
  inactive: COLORS.error,   // red
  warm: COLORS.warning,     // yellow
  active: COLORS.active,    // yellow-green -> green
  done: COLORS.active,
});

const clamp01 = (n) => Math.max(0, Math.min(1, n));

const hexRgb = (hex) => {
  const clean = String(hex).replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
};

const rgbHex = ({ r, g, b }) =>
  `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;

export const blend = (a, b, t) => {
  const ca = hexRgb(a);
  const cb = hexRgb(b);
  const k = clamp01(t);
  return rgbHex({
    r: ca.r + (cb.r - ca.r) * k,
    g: ca.g + (cb.g - ca.g) * k,
    b: ca.b + (cb.b - ca.b) * k,
  });
};

export const animatedGradient = (now, width, from, to, speed = 140) => {
  const safeWidth = Math.max(1, Number(width) || 1);
  const cycle = Math.max(1, Math.floor(safeWidth));
  const shift = (Math.floor(Number(now || 0) / speed) % cycle) / Math.max(1, safeWidth - 1);
  return Array.from({ length: Math.ceil(safeWidth) }, (_, i) => {
    const phase = (i / Math.max(1, safeWidth - 1) + shift) % 1;
    const wave = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    return blend(from, to, wave);
  });
};

export const activeGradient = (now, width, warm = PROCESS.warm, hot = PROCESS.active) =>
  animatedGradient(now, width, warm, hot, 110);

export const processStepColor = ({ index, activeIndex, animated = false, now = 0 }) => {
  if (activeIndex == null || activeIndex < 0) return PROCESS.upcoming;
  if (index > activeIndex) return PROCESS.inactive;
  if (index < activeIndex) return PROCESS.done;
  if (!animated) return PROCESS.warm;
  const phase = (Math.floor(Number(now || 0) / 180) % 10) / 9;
  return blend(PROCESS.warm, PROCESS.active, phase);
};

export const activeGlyph = (now) =>
  Math.floor(Number(now || 0) / 180) % 2 === 0 ? "►" : "▷";
