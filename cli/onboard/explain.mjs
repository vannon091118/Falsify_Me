// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/onboard/explain.mjs – API-Key-Erklärung (pure)
// -----------------------------------------------------------------------------
// Ein Text-Baustein, den Onboarding (steps.mjs) UND Bootstrap
// (cli/bootstrap/apikey.mjs) nutzen: Wozu braucht FalsifyMe einen API-Key,
// wozu werden (bis zu) ZWEI APIs genutzt (Hauptmodell + optionaler
// Evil-Twin-Anbieter), welche Online-Key-Seiten gibt es, wo liegt der Key.
// Reine Daten/Funktionen — KEINE Logik, KEINE Secrets, kein Dateizugriff.
// ─────────────────────────────────────────────────────────────────────────────
export const PROVIDER_LINKS = Object.freeze([
  {
    name: "NVIDIA NIM",
    keyUrl: "https://build.nvidia.com",
    note: "API-Base (FalsifyMe-Default): https://integrate.api.nvidia.com/v1",
  },
  {
    name: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    note: "API-Base: https://api.openai.com/v1",
  },
]);

/** Erklärt, wozu FalsifyMe (bis zu) zwei APIs nutzt + Provider-Links. */
export function apiKeyExplanationLines() {
  return [
    "Ein echter Falsifikations-Job ruft einen OpenAI-kompatiblen Modell-Endpunkt.",
    "Ohne Key (und ohne lokalen Endpunkt wie Ollama/LM Studio) startet kein Job —",
    "FalsifyMe erfindet kein Verdict: ehrlich Exit 3, kein Fake-WRITE.",
    "",
    "Wozu FalsifyMe (bis zu) ZWEI APIs nutzt:",
    "  1. Haupt-API (THINKER/Falsifikation): das Modell, das deine Änderung",
    "     gegen die echten Dateien prüft. Pflicht. Key in FALSIFY_HOME/.env.",
    "  2. Evil-Twin-API (optional): die unabhängige Gegenprüfung nutzt",
    "     STANDARDMÄSSIG dieselbe API/denselben Key wie das Hauptmodell",
    "     (dann genügt EIN Key). Erst wenn der Evil Twin bewusst auf einem",
    "     ZWEITEN Anbieter/Modell laufen soll, brauchst du eine zweite API:",
    "       falsify settings set twinApiBase=\"…\" twinModel=\"…\" twinApiKeyEnv=\"…\"",
    "     und den zweiten Key zusätzlich in FALSIFY_HOME/.env.",
    "",
    "Online-Key-Seiten der Beispiel-Anbieter:",
    ...PROVIDER_LINKS.map((p) => `  • ${p.name}: ${p.keyUrl}   (${p.note})`),
    "Jeder OpenAI-kompatible Endpunkt funktioniert (Azure, Groq, OpenRouter, …);",
    "lokal (Ollama/LM Studio) geht auch ohne Online-Key.",
    "Keys gehören ausschließlich in FALSIFY_HOME/.env (Default:",
    "~/.Falsify_Private, private Rechte) — niemals ins Repo.",
  ];
}

export function printApiKeyExplanation(log = console.log) {
  for (const line of apiKeyExplanationLines()) log(line);
}
