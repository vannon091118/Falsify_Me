// FalsifyMe TUI - Tasten-Mapping
// Verantwortung: rohe Input-Daten -> Aktionen (abort | toggle | null).
// Interaktion ist BEWUSST minimal: nur Zuschauen + Abbruch + Ansichtswechsel.
// Pure, kein I/O, keine React-Imports.
export const ABORT_INPUTS = new Set(["q", "Q", "\x03"]);
export const TOGGLE_INPUTS = new Set(["t", "T"]);

export const isCtrlC = (input, key) =>
  input === "\x03" ||
  (key?.ctrl === true && (key?.name === "c" || input === "c"));

// Eingaben: { input: string, key: { name, ctrl, ... } } (wie Ink useInput liefert)
export const mapKey = ({ input = "", key = {} } = {}) => {
  if (isCtrlC(input, key)) return "abort";
  if (ABORT_INPUTS.has(input)) return "abort";
  if (TOGGLE_INPUTS.has(input)) return "toggle";
  return null;
};