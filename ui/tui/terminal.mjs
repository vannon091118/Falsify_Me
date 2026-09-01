// FalsifyMe TUI - Terminal-Transport
// Verantwortung: Alt-Screen ein/aus, Fenstertitel, Stil-Reset.
// Mode 2026 (Synced Output) + Cursor-Hide uebernimmt Ink selbst - hier KEINE
// Dopplung. Kein React-Import; reine ESC-Sequenz-Ausgabe.
export const ALT_ON = "\x1b[?1049h";
export const ALT_OFF = "\x1b[?1049l";

export const enter = (out = process.stdout, title = "FALSIFYME") => {
  out.write(ALT_ON);
  setTitle(title, out);
};

export const exit = (out = process.stdout) => {
  setTitle("", out);
  out.write("\x1b[0m"); // Stil-Reset
  out.write(ALT_OFF);
};

export const setTitle = (t, out = process.stdout) => {
  out.write(`\x1b]0;${t}\x07`);
};