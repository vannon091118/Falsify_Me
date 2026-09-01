// FalsifyMe TUI - Maschinen-Boot-Intro (Timeline)
// Verantwortung: reine Berechnung der Intro-Phase aus (state, now).
// Visualisiert NUR STARTING: build -> condense -> live (Handoff an Live-UI).
// Der Soft-Cap (STARTING -> IDLE) lebt in events.tick (SOFT_CAP_MS).
// Pure, kein I/O.

// Spec §5: visueller Startup als F A L S I F Y _ M E (mit Unterstrich, gespaced).
export const WORD = "FALSIFY_ME";
export const BUILD_MS = 900;
export const CONDENSE_MS = 600;
export const BLOCK_ROWS = ["░", "░ █ ░", "░ ███ █ ░", "░ ███████ █ ░"];

// mode: "build" | "condense" | "live"
// chars: Anzahl sichtbarer Wordmark-Buchstaben (0..WORD.length)
// block: Wachstumsstufe 0..3
// t: 0..1 Fortschritt innerhalb der Phase
export const stage = (state, now = Date.now()) => {
  if (state.state !== "STARTING") {
    return { mode: "live", t: 1, chars: WORD.length, block: 3 };
  }
  const e = Math.max(0, now - state.bootAt);
  if (e < BUILD_MS) {
    const t = e / BUILD_MS;
    return {
      mode: "build",
      t,
      chars: Math.min(WORD.length, Math.max(1, Math.ceil(t * WORD.length))),
      block: Math.min(3, Math.floor(t * 4)),
    };
  }
  if (e < BUILD_MS + CONDENSE_MS) {
    return { mode: "condense", t: (e - BUILD_MS) / CONDENSE_MS, chars: WORD.length, block: 3 };
  }
  return { mode: "live", t: 1, chars: WORD.length, block: 3 };
};

// Partikel sollen spaetestens in der Condense-Phase sichtbar sein
// (nahtloser Uebergang in die Live-Activity-Animation).
export const particlesVisible = (s) => s.mode !== "build" || s.block >= 1;