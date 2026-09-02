// FalsifyMe · core/twin.mjs – Unabhängige Gegenprüfung (Evil Twin, Regel 6)
// Verantwortung: EINE Sache – WRITE-Kandidaten durch eine ZWEITE, kontextgetrennte
// Konversation gegenprüfen lassen. Der Twin kennt nur die BEHAUPTUNGEN des
// Erstprüfers (Falsifikationsversuche + Befund), nie dessen Gedankengang.
// Fail-closed: alles außer einem sauberen BESTAETIGT verweigert die Freigabe.
// Reine Funktionen, kein DB-Zugriff, kein Schreiben.
//
// P0-Cutover (Regel 4, 2026-09-02): Der Twin ist EXEKUTOR des strukturierten
// Probe-Sets – runProbeExecution führt JEDE Probe aus und liefert ProbeResult[]
// {probe_id, status: BESTAETIGT|WIDERSPRUCH|UNKLAR, evidence}. Die alte
// Freitext-Rolle (runTwinCheck) bleibt als Schutznetz/Pfad für Bestands-Tests
// bestehen; die Gate-Hoheit liegt ab dem Cutover bei core/probes.mjs computeVerdict.
import { runAgent } from "./agent.mjs";
import { SYSTEM_EVILTWIN_DE, SYSTEM_EVILTWIN_EN, SYSTEM_PROBE_EXECUTOR_DE, SYSTEM_PROBE_EXECUTOR_EN } from "./prompt.mjs";

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

// ── P0-Cutover: Probe-Exekution (die EINZIGE Twin-Semantik des neuen Pfads) ──

/** Parst ProbeResult[] aus der Executor-Antwort (letzter json-Fence mit results). */
export function parseProbeResults(content) {
  const text = String(content || "");
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
    .map((m) => m[1])
    .filter((b) => /"results"\s*:/.test(b));
  if (!fences.length) return { ok: false, results: [], error: "kein ```json-Ergebnis-Block mit \"results\" gefunden" };
  try {
    const data = JSON.parse(fences[fences.length - 1]);
    if (!data || !Array.isArray(data.results)) {
      return { ok: false, results: [], error: "Ergebnis-Block ohne results-Array" };
    }
    return { ok: true, results: data.results, error: null };
  } catch (e) {
    return { ok: false, results: [], error: `Ergebnis-JSON kaputt: ${e.message}` };
  }
}

/**
 * Normalisiert die Executor-Rohergebnisse zu strikten ProbeResult[] (fail-closed):
 * status außerhalb BESTAETIGT|WIDERSPRUCH|UNKLAR → UNKLAR; fehlende probe_id →
 * diese Probe UNKLAR („fehlende probe_id → UNKLAR“); Ergebnis ohne Probe-Set-
 * Autorität (globale Zusatzaussagen) bleibt outside – hier gibt es sie nicht.
 * @param {any[]} raw           geparste results (parseProbeResults)
 * @param {{id: string}[]} probes  das formal gültige Probe-Set (Referenz)
 * @returns {{probe_id: string, status: string, evidence: string}[]}
 */
export function normalizeProbeResults(raw, probes = []) {
  const byId = new Map();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r !== "object") continue;
    const id = String(r.probe_id ?? r.id ?? "").trim();
    if (!id) continue;                                  // ohne ID: keine Zuordnung
    const statusRaw = String(r.status ?? "").trim().toUpperCase();
    const status = ["BESTAETIGT", "BEST\u00c4TIGT", "WIDERSPRUCH", "UNKLAR"].includes(statusRaw)
      ? (statusRaw === "BEST\u00c4TIGT" ? "BESTAETIGT" : statusRaw)
      : "UNKLAR";                                       // unbekanntes Wort = UNKLAR
    byId.set(id, { probe_id: id, status, evidence: String(r.evidence ?? "").trim() });
  }
  const known = new Set(probes.map((p) => String(p.id ?? "").trim()));
  const results = [];
  for (const p of probes) {
    const id = String(p.id ?? "").trim();
    const r = byId.get(id);
    // Fehlende probe_id → UNKLAR (fail-closed; keine Probe verschwindet still).
    results.push(r ?? { probe_id: id, status: "UNKLAR", evidence: "kein Ergebnis des Gegenprüfers für diese Probe" });
  }
  // Unbekannte IDs (Autoritätsanspruch ohne Probe) werden verworfen – das
  // Probe-Set ist die einzige Pflichtliste; Zusatzaussagen tragen kein Urteil.
  return results;
}

/**
 * Führt das (bereits validierte) Probe-Set aus: der Twin bekommt Proben +
 * H_i-Originaltexte + Iteration (+ Diff) und liefert je Probe ein striktes
 * ProbeResult. Nutzt die bestehende Twin-Config (twinModel/twinReasoningEffort/
 * twinMaxTokens werden vom Aufrufer weitergegeben – Regeln 4/Ergänzung).
 *
 * Fail-closed (Verfügbarkeit): Parse-Fehler/Timeout/Runner-Fehler → ALLE
 * Proben UNKLAR (Gate: PLAN); es gibt nie eine Teilausführung als WRITE-Grund.
 *
 * @param {Object} o
 * @param {{id: string, requirement_ref: string, class: string, target: string, claim: string, check: string}[]} o.probes
 *        das formal GÜLTIGE Probe-Set (validateProbeSet-Ausgabe)
 * @param {string} [o.requirementList] H_i-Originaltexte (<H1>…</H1> …)
 * @param {string} o.planText          eingereichte Iteration
 * @param {string} [o.diffText]        Diff der Iteration
 * @param {string} [o.header]          Scope-HEADER (wörtlicher User-Input)
 * @param {string} [o.lang]            'de'|'en'
 * @param {string} o.model  o.apiKey  o.apiBase
 * @param {Object} [o.opts]            runAgent-Optionen (maxTokens u.a., Defaults wie Twin)
 * @param {string} o.root              Arbeitsverzeichnis (Tool-Zugriff)
 * @param {string[]} [o.whitelist]
 * @param {(info: {tool:string, file: string|null}) => void} [o.onTool]
 * @param {Function} [o.runner]        injizierbar für Tests (Default: runAgent)
 * @returns {Promise<{results: {probe_id, status, evidence}[], toolRounds: number,
 *                     toolEvidence: any[], usage: object|null, error: string|null}>}
 */
export async function runProbeExecution({ probes, requirementList, planText, diffText, header, lang = "de", model, apiKey, apiBase, opts = {}, root, whitelist = [], onTool, runner = runAgent } = {}) {
  const systemPrompt = lang === "en" ? SYSTEM_PROBE_EXECUTOR_EN : SYSTEM_PROBE_EXECUTOR_DE;
  const userContent = [
    header ? `## HEADER (wörtlicher User-Input)\n${header}` : null,
    requirementList ? `## Anforderungs-Liste (Original-IDs)\n${requirementList}` : null,
    `## Eingereichte Iteration\n${planText || "(leer)"}`,
    diffText ? `## Diff der Iteration\n\n\`\`\`diff\n${diffText}\n\`\`\`` : null,
    `## Zugriffsrahmen – NUR diese Dateien lesen: ${whitelist.join(", ") || "(ganzer Root)"}`,
    `## Probe-Set (jede Probe ausführen, probe_id exakt übernehmen)\n${JSON.stringify({ probes }, null, 2)}`,
  ].filter(Boolean).join("\n\n");
  try {
    const result = await runner({
      systemPrompt,
      userContent,
      model,
      apiKey,
      apiBase,
      maxTokens: opts.maxTokens ?? 16384,
      reasoningEffort: opts.reasoningEffort ?? "high",
      maxToolRounds: opts.maxToolRounds ?? 14,
      temperature: opts.temperature ?? 0.3,
      timeoutMs: opts.timeoutMs ?? 180000,
      root,
      whitelist,
      onTool,
    });
    const content = String(result?.content || "");
    const parsed = parseProbeResults(content);
    if (!parsed.ok) {
      // Parse-Fehler → ALLE Proben UNKLAR (fail-closed, kein Fake-Verdict).
      return {
        results: (probes || []).map((p) => ({
          probe_id: String(p.id ?? "").trim(),
          status: "UNKLAR",
          evidence: `Ergebnis unlesbar: ${parsed.error}`,
        })),
        toolRounds: result?.toolRounds ?? 0,
        toolEvidence: Array.isArray(result?.toolEvidence) ? result.toolEvidence : [],
        usage: result?.usage ?? null,
        error: parsed.error,
        content,
      };
    }
    return {
      results: normalizeProbeResults(parsed.results, probes || []),
      toolRounds: result?.toolRounds ?? 0,
      toolEvidence: Array.isArray(result?.toolEvidence) ? result.toolEvidence : [],
      usage: result?.usage ?? null,
      error: null,
      content,
    };
  } catch (e) {
    // Timeout/Netz/Runner-Fehler → ALLE Proben UNKLAR (kein Fake-Verdict).
    return {
      results: (probes || []).map((p) => ({
        probe_id: String(p.id ?? "").trim(),
        status: "UNKLAR",
        evidence: `Gegenprüfung fehlgeschlagen: ${String(e?.message || e)}`,
      })),
      toolRounds: 0,
      toolEvidence: [],
      usage: null,
      error: String(e?.message || e),
      content: "",
    };
  }
}