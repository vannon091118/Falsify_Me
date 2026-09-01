// FalsifyMe TUI - Stream-Parser
// Verantwortung: Zeichenkette -> Zeilen -> Events (FM-EVT:) / Roh-Zeilen.
// ANSI wird beim Parsen gestrippt (nie im Renderloop). Einmaliges, lineares
// Lesen pro Chunk; Teilzeilen werden gepuffert. Pure (nur String-Operationen).

export const MARKER = "FM-EVT:";

// Bewaehrte ANSI-Escape-Erkennung (CSI + OSC + nackte ESC-Sequenzen).
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[PX^_].*?(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export const stripAnsi = (s) => s.replace(ANSI_RE, "");

const parseEvent = (line) => {
  const i = line.indexOf(MARKER);
  if (i === -1) return null;
  const payload = line.slice(i + MARKER.length).trim();
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null; // kaputte Marker-Zeile faellt als normale Zeile durch
  }
};

export const createParser = ({ onEvent, onLine } = {}) => {
  let partial = "";

  const handleLine = (raw) => {
    // ANSI erst strippen, dann parsen - Marker koennen farbbeklebt sein.
    const line = stripAnsi(raw.endsWith("\r") ? raw.slice(0, -1) : raw);
    const evt = parseEvent(line);
    if (evt !== null) {
      onEvent?.(evt);
      return;
    }
    onLine?.(line);
  };

  return {
    feed(chunk) {
      partial += chunk;
      let idx;
      while ((idx = partial.indexOf("\n")) !== -1) {
        const line = partial.slice(0, idx);
        partial = partial.slice(idx + 1);
        handleLine(line);
      }
    },
    flush() {
      if (partial.length > 0) {
        const rest = partial;
        partial = "";
        handleLine(rest);
      }
    },
  };
};