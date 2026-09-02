// FalsifyMe TUI - Stream-Parser
// Verantwortung: Zeichenkette -> Zeilen -> Events (FM-EVT:) / Roh-Zeilen.
// ANSI wird beim Parsen gestrippt (nie im Renderloop). Einmaliges, lineares
// Lesen pro Chunk; Teilzeilen werden gepuffert. Pure (nur String-Operationen).

export const MARKER = "FM-EVT:";

// Heap-Leak-Schutz (OOM-B10, 2026-09-01): Beide Puffer des Parsers sind
// BYTE-begrenzt, nicht nur zaehlbegrenzt:
//   - MAX_PARTIAL: Der Teilzeilen-Puffer wuchs UNBEgrenzt, wenn ein Stream
//     (LLM-Reasoning ist oft ein Fliesstext OHNE Newlines ueber Minuten)
//     kein \n liefert — empirisch: 7,8 MB gefuettert -> 133 MB Heap
//     (UTF-16-Expansion + Rope-Retention). Ueber 30 min Dock-Lauf fuehrt
//     das in den V8-Heap-OOM. Ueber der Kappe wird der ANFANG verworfen
//     (Ende bleibt — ein FM-EVT:-Marker steht am ZeilenANFANG einer echten
//     Konsolenzeile; eine >1-MB-Zeile ist Garbage und verliert den Marker
//     bewusst).
//   - MAX_LINE: Der Output-Ring der UI ist nur zaehlbegrenzt (200 Zeilen) —
//     EINE Megabyte-Zeile reteniert dort 200x. Anzeige-Zeilen jenseits der
//     Kappe sind unlesbar; abgeschnitten wird nur der onLine-Pfad (Events
//     werden auf der vollen Zeile geparst, damit ein grosses, legitimes
//     Event-Payload intakt bleibt).
export const MAX_PARTIAL = 1_000_000;
export const MAX_LINE = 8_000;

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
    const full = stripAnsi(raw.endsWith("\r") ? raw.slice(0, -1) : raw);
    const evt = parseEvent(full);
    if (evt !== null) {
      onEvent?.(evt);
      return;
    }
    // Byte-Kappe fuer Anzeige-Zeilen (Ring ist zaehlbegrenzt, nicht byte-
    // begrenzt — eine Megabyte-Zeile reteniert sonst 200x im Output-Ring).
    onLine?.(full.length > MAX_LINE ? full.slice(0, MAX_LINE) : full);
  };

  return {
    feed(chunk) {
      partial += chunk;
      // Heap-Kappe: ohne \n im Stream wuchs partial ungebunden (OOM-B10).
      // Der ANFANG wird verworfen, das Ende bleibt (siehe MAX_PARTIAL oben).
      if (partial.length > MAX_PARTIAL) partial = partial.slice(-MAX_PARTIAL / 2);
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