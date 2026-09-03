// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/bootstrap/apikey.mjs – API-Key-Check im Bootstrap
// -----------------------------------------------------------------------------
// Nach der Installation prüft der Bootstrap, ob ein API-Key existiert
// (loadApiKey: beliebiger Name aus der Key-Liste, nicht nur der erste).
// Fehlt der Key, wird ehrlich erklärt, wozu FalsifyMe (bis zu) zwei APIs
// nutzt (Hauptmodell + optionaler Evil-Twin-Anbieter) und es werden die
// Online-Key-Seiten der Beispiel-Anbieter genannt.
//   • interaktiv (TTY): Übergang in den Onboarding-Dialog (falsify onboard)
//   • headless (Agent): klare Anleitung für den Agenten — kein stiller Hang,
//     kein Fake-Erfolg; ohne Key startet weiterhin kein echter Job (Exit 3).
// KEIN Schreibpfad an FalsifyMe-Daten; Keys werden nie geladen/gedruckt.
// ─────────────────────────────────────────────────────────────────────────────
import { loadApiKey } from "../../core/keys.mjs";
import { printApiKeyExplanation } from "../onboard/explain.mjs";

/** True, wenn irgendein Key der konfigurierten Key-Namen vorhanden ist. */
export function hasApiKey() {
  try {
    return Boolean(loadApiKey());
  } catch {
    return false; // kaputte Config ist KEIN Key — ehrlich als fehlend behandeln
  }
}

/**
 * Bootstrap-API-Key-Schritt. Liefert { configured } + mode.
 * interactive=false (Agent-Shell ohne TTY): nur Anleitung, kein Dialog.
 */
export async function ensureApiKeyAtBootstrap({ interactive = false, skipDock = false } = {}) {
  if (hasApiKey()) return { configured: true, mode: "configured" };

  console.log("");
  console.log("=".repeat(64));
  console.log("  KEIN API-KEY GEFUNDEN — ohne Key startet kein echter Job");
  console.log("=".repeat(64));
  printApiKeyExplanation();

  if (!interactive) {
    console.log("");
    console.log("Agent-Shell ohne Terminal erkannt — der interaktive Key-Dialog ist hier");
    console.log("nicht möglich. Frage den Nutzer und biete ihm diese Optionen an:");
    console.log('  • Nutzer startet im Terminal:  falsify onboard   (Dialog erklärt 1–2 APIs');
    console.log('                               + Provider-Links)');
    console.log('  • Key direkt setzen (Agent):   falsify settings set apiBase="…" model="…"');
    console.log('                                 apiKeyName="…" apiKey="…"');
    console.log("");
    console.log("Ohne Key startet weiterhin kein Job — FalsifyMe erfindet kein Verdict.");
    console.log("=".repeat(64));
    return { configured: false, mode: "headless" };
  }

  const { defaultPrompter } = await import("../onboard/prompts.mjs");
  const prompter = defaultPrompter();
  try {
    const start = await prompter.confirm(
      "FALSIFYME ▸ Jetzt den Onboarding-Key-Dialog starten? (erklärt Endpunkt, Modell und wozu 1–2 APIs dienen)",
      { defaultValue: true },
    );
    if (!start) {
      console.log("OK — später jederzeit: falsify onboard. Ohne Key startet weiterhin kein Job.");
      return { configured: false, mode: "declined" };
    }
    const { runOnboardCli } = await import("../onboard.mjs");
    await runOnboardCli(skipDock ? ["--skip-dock"] : []);
    return { configured: hasApiKey(), mode: "onboarding" };
  } finally {
    prompter.close();
  }
}
