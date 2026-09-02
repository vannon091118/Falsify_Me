// FalsifyMe TUI - Views: App (Komposition der Zonen)
// Verantwortung: Zonen zusammenbauen + UI-Lifecycle (Tick-Subscription,
// useInput -> keys.mjs). KEIN State-Management, KEIN Parsen - nur
// Darstellung. Der Snapshot kommt fertig aus der Kompositions-Wurzel.
// Routing der Hauptflaeche:
//   globalIdle  -> IdleView (WARTE AUF EINGABE, animiert, fest)
//   2..3 Slots  -> SlotsView (Fenster-Split im einen Terminal-pid)
//   1 Slot      -> Volle Ansicht (Boot/Partikel/Reasoning/Verdict)
import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { mapKey } from "../keys.mjs";
import Header from "./Header.mjs";
import BootView from "./BootView.mjs";
import ReasoningView from "./ReasoningView.mjs";
import OutputView from "./OutputView.mjs";
import EvilTwinView from "./EvilTwinView.mjs";
import VerdictView from "./VerdictView.mjs";
import IdleView from "./IdleView.mjs";
import SlotsView from "./SlotsView.mjs";
import Footer from "./Footer.mjs";

const h = React.createElement;
const MIN_COLS = 46;
const MIN_ROWS = 12;

export default function App({ getSnapshot, subscribe, emit }) {
  const [snap, setSnap] = useState(() => getSnapshot());

  useEffect(() => {
    return subscribe(setSnap);
  }, [subscribe]);

  useInput((input, key) => {
    const action = mapKey({ input, key });
    if (action) emit(action);
  });

  const { cols, rows } = snap.dims;
  if (!cols || !rows || rows < MIN_ROWS || cols < MIN_COLS) {
    return h(Box, { flexDirection: "column" },
      h(Text, { color: "red" }, "TERMINAL ZU KLEIN"),
      h(Text, { color: "gray" }, `Bitte vergrössern (aktuell ${cols || 0}x${rows || 0}, minimal ${MIN_COLS}x${MIN_ROWS}).`),
    );
  }

  const headerH = 3;
  const footerH = 3;
  const mainH = Math.max(2, rows - headerH - footerH);

  const busyCount = (snap.slotPanels ?? []).length;
  let main;
  if (snap.globalIdle) {
    main = h(IdleView, { snap, cols, rows: mainH });
  } else if (snap.state === "VERDICT" && snap.verdict) {
    main = h(VerdictView, { snap, cols, rows: mainH });
  } else if (snap.jobsStarted === 0 && snap.boot && snap.boot.mode !== "live") {
    // Vollbild-Label NUR beim Start waehrend der Selftests. Sobald ein Job
    // belegt ist (jobsStarted > 0), zeigen wir NIE wieder den Bootscreen -
    // nicht mal waehrend STARTING (E2E-Befund 2026-09-02: das Bild hing
    // waehrend laufender Jobs im Boot-Intro).
    main = h(BootView, { snap, cols, rows: mainH });
  } else if (snap.twinActive) {
    // Evil-Twin-Gegenpruefung (Regel 6, UI-109): das Bild WECHSELT in den
    // Rot/Schwarz-Kontrast-Bildschirm und zeigt den Roh-Text des Gegenpruefers
    // (unabhaengig vom t-Toggle - die Phase selbst ist das Signal).
    main = h(EvilTwinView, { snap, cols, rows: mainH });
  } else if (snap.state === "THINKING" || snap.state === "TOOL_ACTIVITY") {
    // UI-Traceability (Live-Befund 2026-09-02): Solange ein Slot wirklich
    // DENKT (Reasoning laeuft), ist der lesbare Verlauf die Hauptsache —
    // NICHT die Partikel-Animation. Das gilt auch, wenn parallel ein zweiter
    // Slot in STARTING steht (vorher gewann SlotsView und verdeckte den Text
    // komplett). Kopf zeigt THINKER/EVIL TWIN + Modell + Aktivitaet.
    main = h(OutputView, { snap, cols, rows: mainH, withStatusHeader: true });
  } else if (busyCount > 1) {
    // Mehrere Slots parallel, aber keiner denkt gerade: die Übersicht (mehrere
    // Fenster-Kacheln) statt Verlauf. Der Fokus-Slot bleibt über [1..3] wählbar.
    main = h(SlotsView, { snap, cols, rows: mainH });
  } else if (snap.mode === "thinking") {
    // t-Toggle (2026-09-01): „thinking“ = LLM-Rohtext SICHTBAR.
    main = h(OutputView, { snap, cols, rows: mainH });
  } else {
    main = h(ReasoningView, { snap, cols, rows: mainH });
  }

  return h(Box, { flexDirection: "column", width: cols, height: rows },
    h(Header, { snap, cols }),
    h(Box, { width: cols, height: mainH, flexDirection: "column" }, main),
    h(Footer, { snap, cols }),
  );
}