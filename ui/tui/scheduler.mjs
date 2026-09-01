// FalsifyMe TUI - Frame-Scheduler
// Verantwortung: getaktete Render-Frames (aktiv/idle), sofortiger Flush bei
// signifikanten Uebergaengen, Coalescing (viele requestNow -> EIN Frame).
// Kein React-Import; onFrame({ dt, now }) ist die einzige Schnittstelle.
export const createScheduler = ({ activeFps = 15, idleFps = 1, onFrame } = {}) => {
  let running = false;
  let timer = null;
  let active = false;
  let pending = false;
  let lastT = 0;

  const frame = () => {
    timer = null;
    if (!running) return;
    const now = performance.now();
    const dt = lastT > 0 ? now - lastT : 16;
    lastT = now;
    try {
      onFrame?.({ dt, now });
    } catch (e) {
      // Ein kaputter Frame darf den Scheduler nicht stoppen.
      console.error("scheduler frame error:", e);
    }
    schedule();
  };

  const schedule = () => {
    if (!running || timer !== null) return;
    const fps = Math.max(1, active ? activeFps : idleFps);
    const delay = Math.max(16, 1000 / fps);
    timer = setTimeout(frame, delay);
  };

  const flushPending = () => {
    if (!pending) return;
    pending = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    lastT = 0; // frischer Frame, kein geerbter dt
    frame();
  };

  return {
    start() {
      if (running) return;
      running = true;
      lastT = 0;
      schedule();
    },
    stop() {
      running = false;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = false;
    },
    setActive(a) {
      const next = !!a;
      if (next === active) {
        if (next && running && timer === null) schedule();
        return;
      }
      active = next;
      if (!running) return;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      schedule();
    },
    // Raten zur Laufzeit aendern (z.B. Warte-Screen: sanfte 6 FPS statt 15).
    setRates({ activeFps: af, idleFps: idf } = {}) {
      if (af !== undefined && Number.isFinite(af) && af >= 1) activeFps = af;
      if (idf !== undefined && Number.isFinite(idf) && idf >= 1) idleFps = idf;
      if (running && timer === null) schedule();
    },
    // Sofortiger Frame fuer signifikante Uebergaenge; mehrfache Aufrufe
    // im selben Turn koaleszieren zu EINEM Frame.
    requestNow() {
      if (!running) return;
      if (pending) return;
      pending = true;
      setTimeout(flushPending, 0);
    },
    get active() {
      return active;
    },
  };
};