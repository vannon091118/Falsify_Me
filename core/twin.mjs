// FalsifyMe · core/twin.mjs – Unabhängige Gegenprüfung (Evil Twin, Regel 6)
// Verantwortung: EINE Sache – WRITE-Kandidaten durch eine ZWEITE, kontextgetrennte
// Konversation gegenprüfen lassen. Der Twin kennt nur die BEHAUPTUNGEN des
// Erstprüfers (Falsifikationsversuche + Befund), nie dessen Gedankengang.
// Fail-closed: alles außer einem sauberen BESTAETIGT verweigert die Freigabe.
// Reine Funktionen, kein DB-Zugriff, kein Schreiben.
import { runAgent } from "./agent.mjs";
import { SYSTEM_EVILTWIN_DE, SYSTEM_EVILTWIN_EN } from "./prompt.mjs";

/** Twin-Urteile: nur BESTAETIGT trägt eine Freigabe. */
export const TWIN = Object.freeze({ CONFIRMED: "BESTAETIGT", CONTRADICTED: "WIDERSPRUCH", UNCLEAR: "UNKLAR" });

/** Mögliche Abschnitts-Header (DE/EN) des Falsifikationsversuche-Blocks. */
const CLAIM_HEADERS = ["## Falsifikationsversuche", "## Falsification attempts"];

/**
 * Extrahiert die Falsifikationsversuche des Erstprüfers aus dessen Antwort.
 * Nur dieser Abschnitt geht an den Twin (Kontext-Trennung: kein Reasoning,
 * keine toolRounds, keine Zwischenbefunde).
 * @param {string} content
 * @returns {string} Abschnitts-Text oder "" wenn keiner existiert
 */
export function extractClaims(content) {
  const text = String(content || "");
  for (const h of CLAIM_HEADERS) {
    const i = text.indexOf(h);
    if (i !== -1) {
      const rest = text.slice(i + h.length);
      const end = rest.search(/\n## /);
      return rest.slice(0, end === -1 ? undefined : end).trim();
    }
  }
  return "";
}

/**
 * Parst das Twin-Urteil aus dessen Antwort. Strenge Lesart: kein VERDICT,
 * kaputtes Format oder unbekanntes Wort ⇒ UNKLAR (fail-closed).
 * @param {string} content
 * @returns {"BESTAETIGT"|"WIDERSPRUCH"|"UNKLAR"}
 */
export function parseTwinVerdict(content) {
  const m = String(content || "").match(/VERDICT\s*:\s*(BESTÄTIGT|BESTAETIGT|WIDERSPRUCH|UNKLAR)/i);
  if (!m) return TWIN.UNCLEAR;
  const raw = m[1].toUpperCase();
  if (raw === "BESTÄTIGT") return TWIN.CONFIRMED;
  if (raw === "BESTAETIGT") return TWIN.CONFIRMED;
  if (raw === "WIDERSPRUCH") return TWIN.CONTRADICTED;
  return TWIN.UNCLEAR;
}

/**
 * Führt die unabhängige Gegenprüfung eines WRITE-Kandidaten aus.
 *
 * Kontext-Trennung (Kern der Regel): Der Twin erhält NUR header, Plan,
 * BEFUND und die Falsifikationsversuche – nie Findings-Historie, SubPrompt
 * oder das Reasoning des Erstlaufs. Eigene frische Konversation, eigene
 * Tool-Runden, eigener Kontext.
 *
 * Fail-closed (Verfügbarkeits-Semantik): Jeder Fehler (API, Netz, Timeout,
 * leere/ungültige Antwort) wird als UNKLAR beantwortet – niemals wird im
 * Fehlerfall eine Freigabe gegeben. Ein WRITE ohne unabhängige Bestätigung
 * existiert nicht.
 *
 * @param {Object} o
 * @param {string} [o.header]     Scope-HEADER (wörtlicher User-Input)
 * @param {string} o.planText     eingereichte Iteration
 * @param {string} [o.befund]     BEFUND des Erstprüfers
 * @param {string} o.claims       extrahierte Falsifikationsversuche (extractClaims)
 * @param {string} [o.lang]       'de'|'en' (Sprache des Twin-Prompts)
 * @param {string} o.model  o.apiKey  o.apiBase
 * @param {Object} [o.opts]       runAgent-Optionen (maxTokens u.a., Defaults wie Erstlauf)
 * @param {string} o.root         Arbeitsverzeichnis (Tool-Zugriff)
 * @param {string[]} [o.whitelist]
 * @param {(info: {tool:string, file: string|null}) => void} [o.onTool]
 * @param {Function} [o.runner]   injizierbar für Tests (Default: runAgent)
 * @returns {Promise<{verdict:string, befund:string, content:string, toolRounds:number, toolEvidence:Array, usage:object|null, error:string|null}>}
 */
export async function runTwinCheck({ header, planText, befund, claims, lang = "de", model, apiKey, apiBase, opts = {}, root, whitelist = [], onTool, runner = runAgent } = {}) {
  const systemPrompt = lang === "en" ? SYSTEM_EVILTWIN_EN : SYSTEM_EVILTWIN_DE;

  const userContent = [
    header ? `## HEADER (wörtlicher User-Input)\n${header}` : null,
    `## Eingereichte Iteration\n${planText || "(leer)"}`,
    befund ? `## BEFUND des Erstprüfers\n${befund}` : null,
    `## Falsifikationsversuche des Erstprüfers (zu prüfen)\n${claims || "(keine – das allein ist bereits ein WIDERSPRUCH: eine Freigabe ohne Widerlegung ist nicht belastbar)"}`,
    `Zugriff erlaubt – NUR diese Dateien lesen: ${whitelist.join(", ") || "(keine)"}`,
  ].filter(Boolean).join("\n\n");

  try {
    const result = await runner({
      systemPrompt,
      userContent,
      model,
      apiKey,
      apiBase,
      maxTokens: opts.maxTokens ?? 20000,
      reasoningEffort: opts.reasoningEffort ?? "high",
      maxToolRounds: opts.maxToolRounds ?? 14,
      temperature: opts.temperature ?? 0.3,
      timeoutMs: opts.timeoutMs ?? 180000,
      root,
      whitelist,
      onTool,
    });
    const content = String(result?.content || "");
    return {
      verdict: parseTwinVerdict(content),
      befund: content.match(/BEFUND\s*:\s*([^\n]+)/i)?.[1]?.trim() || "",
      content,
      toolRounds: result?.toolRounds ?? 0,
      toolEvidence: Array.isArray(result?.toolEvidence) ? result.toolEvidence : [],
      usage: result?.usage ?? null,
      error: null,
    };
  } catch (e) {
    return {
      verdict: TWIN.UNCLEAR,
      befund: "",
      content: "",
      toolRounds: 0,
      toolEvidence: [],
      usage: null,
      error: String(e?.message || e),
    };
  }
}