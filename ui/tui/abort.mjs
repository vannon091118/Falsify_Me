// FalsifyMe TUI - Abort-Ablauf (Prozess-Terminierung)
// Verantwortung: Kindprozess beenden + Verifikation (kein weiterlaufender
// Child, keine Fake-Beendigung). Idempotent.
// Kein React-Import; onProgress meldet ABORTING/ABORTED/ERROR.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// PID wirklich tot? process.kill(pid,0) wirft ESRCH wenn nicht existiert.
export const isDead = (pid) => {
  if (!pid) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return e?.code === "ESRCH";
  }
};

export const createAbort = ({ child, killDelayMs = 2000, onProgress = () => {} } = {}) => {
  let started = false;
  return {
    started: false,
    async request() {
      if (started) return "ALREADY";
      started = this.started = true;
      // Ohne Kind ist nichts beendbar - kein Fake-ABORTED.
      if (!child || typeof child.kill !== "function") {
        onProgress("ERROR");
        return "ERROR";
      }
      onProgress("ABORTING");

      // Auf 'close' warten (falls child ein EventEmitter ist).
      const waitClose = () =>
        child && typeof child.once === "function"
          ? new Promise((res) => {
              let settled = false;
              const done = (code) => {
                if (!settled) {
                  settled = true;
                  res(code);
                }
              };
              child.once("close", done);
              // Absicherung: falls 'close' nie kommt, nach killDelayMs weiter.
            })
          : Promise.resolve(null);

      const closed = waitClose();
      let killed = false;
      try {
        killed = child?.kill?.() ?? false;
      } catch {
        killed = false;
      }
      const race = await Promise.race([
        closed.then((code) => ({ kind: "closed", code })),
        sleep(killDelayMs).then(() => ({ kind: "timeout" })),
      ]);
      if (race.kind === "timeout") {
        // Haertet nach: SIGKILL (POSIX) / TerminateProcess (Windows).
        try {
          child?.kill?.("SIGKILL");
        } catch {
          /* egal */
        }
        await closed;
      }
      const dead = isDead(child?.pid);
      onProgress(dead ? "ABORTED" : "ERROR");
      return dead ? "ABORTED" : "ERROR";
    },
  };
};