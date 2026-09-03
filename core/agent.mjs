// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · core/agent.mjs – Modell-Loop (Agent mit Tools)
// -----------------------------------------------------------------------------
// Streaming (Reasoning grau, Kritik weiß, ⟳ Tool-Aufrufe), 429-/Netz-Retry,
// Leere-Antwort-Handling, Runden-Limit. Reine Funktion ohne DB-Zugriff.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import { makeTools } from "./tools.mjs";
import { keyEnvFile, keyNames } from "./keys.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Live-Dock-Befund 2026-09-02: LLM-Reasoning kommt als Fliesstext OHNE
// Newlines; der UI-Parser kappt solche Riesen-Zeilen (OOM-Schutz) — der
// Beobachter sah keinen lesbaren Verlauf. Der Stream-Writer bricht daher
// an Wortgrenzen in UI-lesbare Zeilen um.
export function wrapStreamLines(text, width = 110) {
  const out = [];
  for (const para of String(text || "").split("\n")) {
    if (!para) { out.push(""); continue; }
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) { out.push(line); line = word; }
      else line = line ? line + " " + word : word;
    }
    if (line) out.push(line);
  }
  return out;
}

// ── Flüssige Ausgabe: kleine Stream-Chunks in ~40-ms-Frames bündeln ─────────
let streamBuf = "";
let streamTimer = null;
function streamWrite(s) {
  for (const line of wrapStreamLines(s, 110)) streamBuf += line + "\n";
  if (!streamTimer) streamTimer = setInterval(() => {
    if (streamBuf) { try { process.stdout.write(streamBuf); } catch { /* egal */ } streamBuf = ""; }
  }, 40);
}
function streamFlush() {
  if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
  if (streamBuf) { try { process.stdout.write(streamBuf); } catch { /* egal */ } streamBuf = ""; }
}

/**
 * Führt den Falsifizierungs-Agent-Loop aus.
 * @param {Object} o
 * @param {string} o.systemPrompt
 * @param {string} o.userContent
 * @param {string} o.model
 * @param {string} o.apiKey
 * @param {string} o.apiBase
 * @param {number} [o.maxTokens=20000]
 * @param {string} [o.reasoningEffort='high'] – 'auto'|'off' lässt den Parameter weg
 * @param {number} [o.maxToolRounds=14]
 * @param {number} [o.temperature=0.3]
 * @param {number} [o.timeoutMs=600000]
 * @param {string} o.root
 * @param {string[]} [o.whitelist]
 * @param {(info:{tool:string, file: string|null})=>void} [o.onTool] – optionaler
 *   Callback je echtem Tool-Aufruf (Phase 2 UI-Events; Default: keine Wirkung)
 * @returns {Promise<{content:string, usage:object, toolRounds:number}>}
 */
export async function runAgent({ systemPrompt, userContent, model, apiKey, apiBase, maxTokens = 20000, reasoningEffort = "high", maxToolRounds = 14, temperature = 0.3, timeoutMs = 180000, root, whitelist = [], onTool, retryBackoffMs = 1000, timeoutStagesMs = [5000, 30000, 60000], fetchRound: fetchRoundOverride = null } = {}) {
  const { TOOLS, execTool } = makeTools(root, whitelist);
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
  let toolRounds = 0;
  let emptyRetries = 0;
  const toolEvidence = []; // objektive Laufzeit-Evidenz erfolgreicher/versuchter Tool-Aufrufe

  // ── Timeout-Eskalation in STUFEN (2026-09-01): ueberlastete Provider
  // (Netzwerk-/429-/5xx-Kaskaden, gehaengte Streams) sollen nicht ewig in der
  // Schwebe bleiben, aber auch nicht an einer einzigen langsamen Antwort
  // scheitern. Die Leiter gibt der API erst wenig Zeit (5 s), dann mehr
  // (30 s, 60 s) — pro Versuch eine Stufe; nach Erschoepfung eskaliert der
  // Call deterministisch (kein Verdict, Job endet als ERROR, Exit 3).
  // Zusaetzlich beendet ein GESAMT-Zeitbudget (Deadline) Tool-Runden-Kaskaden.
  const sumStages = (timeoutStagesMs || []).reduce((a, b) => a + b, 0) || 60000;
  const budgetMs = Math.max(sumStages * 3, 600000);
  const deadlineMs = Date.now() + budgetMs;
  const remaining = () => Math.max(1000, deadlineMs - Date.now());

  // Provider wie NVIDIA NIM betten Tool-Aufrufe teils als XML ins Content-Stream
  // ein (<tool_call>…</tool_call>) und legen die Analyse in reasoning_content ab.
  // Solche Stubs gehoeren NICHT in Befund/Finding; als Fallback zaehlt Reasoning.
  const finalizeContent = (round) => {
    const stripped = String(round?.content || "").replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "").trim();
    return stripped || String(round?.reasoning || "").trim();
  };

  const fetchRound = fetchRoundOverride || ((body) => fetchRoundWith(body, { apiKey, apiBase, timeoutMs, deadlineMs, retryBackoffMs, timeoutStagesMs }));

  for (;;) {
    // reasoning_effort nur senden, wenn der Provider es unterstützt
    // ('auto'/'off' = Parameter weglassen – OpenAI-kompatibel, z. B. OpenAI selbst).
    const body = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      tools: TOOLS,
      stream: true,
    };
    const re = String(reasoningEffort || "").toLowerCase();
    if (re !== "auto" && re !== "off" && re !== "none") body.reasoning_effort = re;

    if (Date.now() > deadlineMs) {
      throw new Error(`API-Überlastung (Zeitbudget von ${Math.round(budgetMs / 1000)}s überschritten – Tool-Runden/Retries erschöpft)`);
    }
    let round;
    try {
      round = await fetchRound(body);
    } catch (e) {
      // Auth-Fehler (401/403) brechen JETT sofort ab – weniger Keys/Parameter
      // helfen nie, wenn der Key selbst abgelehnt wird (User-Ticket 2026-09-03).
      if (/HTTP 40[13]/.test(String(e.message))) throw e;
      if (/HTTP 4\d\d/.test(String(e.message)) && toolRounds === 0) {
        // F-3-Fix (Live-E2E 2026-09-02): Erst Retry NUR ohne reasoning_effort,
        // Tools bleiben — Groq lehnt `reasoning_effort=high` mit 400 ab und der
        // Twin BRAUCHT die Tools (twinEvidenceOk). Erst wenn das erneut 4xx ist
        // (Modell ohne Tool-Unterstützung), der alte Rettungsweg ohne Tools.
        process.stderr.write(`⚠️ ${e.message} – Retry ohne reasoning_effort (Tools bleiben) …\n`);
        try {
          round = await fetchRound({ ...body, reasoning_effort: undefined });
        } catch (e2) {
          if (/HTTP 4\d\d/.test(String(e2.message))) {
            process.stderr.write(`⚠️ ${e2.message} – Retry ohne Tools/reasoning_effort …\n`);
            round = await fetchRound({ ...body, tools: undefined, reasoning_effort: undefined });
          } else {
            throw e2;
          }
        }
      } else {
        throw e;
      }
    }
    if (process.env.FALSIFY_DEBUG) {
      process.stderr.write(`[dbg] runde: content=${(round.content || "").length}B toolCalls=[${(round.toolCalls || []).map((t) => t.name).join(",")}] finish=${round.finish || "?"} nachrichtenzahl=${messages.length}\n`);
    }

    const calls = (round.toolCalls || []).filter((t) => t.name);

    const c = (round.content || "").trim();
    const looksLikeToolJson = /^\s*\{[\s\S]*"(tool|name|path|arguments|function)"\s*:/.test(c);
    // NIM/OpenAI-kompatible Provider betten Tool-Wuensche teils als ONLY-Content
    // ein (<tool_call>…</tool_call>), ohne strukturierte tool_calls.
    // (1) Reiner Stub ODER (2) Stub+Resttext OHNE VERDICT (E2E 2026-09-01:
    // Antwort brach mit „Let me read core/prompt.mjs an" + Stub ab und wurde
    // als final abgestempelt) ist KEINE finale Antwort — wie leer behandeln.
    const hadStub = /<tool_call>/i.test(c);
    const hasVerdict = /VERDICT\s*:\s*\S+/i.test(c);
    const stubOnlyContent = c !== "" && c.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "").trim() === "";
    if (!calls.length && (stubOnlyContent || (hadStub && !hasVerdict) || !c || looksLikeToolJson) && emptyRetries < 3) {
      emptyRetries++;
      process.stderr.write(`⚠️ Leere Antwort (finish=${round.finish || "?"}) – Versuch ${emptyRetries}/3 …\n`);
      if (emptyRetries >= 2) {
        messages.push({ role: "user", content: "Antworte JETZT direkt mit deiner Falsifikations-Kritik – nur Text, sofort, ohne weiteres Nachdenken und ohne Tools. Ende mit: BEFUND: … und VERDICT: PLAN, RESEARCH oder WRITE." });
        round = await fetchRound({ ...body, tools: undefined, reasoning_effort: undefined });
        const c2 = finalizeContent(round);
        if (c2 && !/^\s*\{[\s\S]*"(tool|name|path|arguments|function)"\s*:/.test(c2)) {
          return { content: c2, usage: round.usage || {}, toolRounds, toolEvidence };
        }
      }
      continue;
    }

    if (calls.length && toolRounds >= maxToolRounds) {
      const finalMsg = { role: "user", content: "Du hast dein Tool-Runden-Limit erreicht. Gib JETZT deine abschließende Falsifikations-Kritik mit BEFUND und VERDICT (PLAN | RESEARCH | WRITE) – reiner Text, keine Tool-Aufrufe." };
      round = await fetchRound({ ...body, tools: undefined, messages: [...messages, finalMsg] });
      let content = finalizeContent(round);
      // Verdict-Pflicht (E2E 2026-09-01): NIM lieferte beim Schluss-Call einen
      // Stub-Resttext OHNE BEFUND/VERDICT („Let me read core/prompt.mjs an“),
      // der als finale Antwort durchging -> UNBEKANNT. Nachbohren, bis ein
      // VERDICT da ist (bounded: 2 Versuche, dann ehrlich UNBEKANNT-möglich).
      for (let attempt = 1; (!content || !/VERDICT\s*:\s*\S+/i.test(content)) && attempt <= 2; attempt++) {
        round = await fetchRound({ ...body, tools: undefined, messages: [...messages, finalMsg, { role: "user", content: "Deine Antwort enthält kein VERDICT. Liefere JETZT die abschließende Falsifikations-Kritik mit BEFUND und VERDICT (PLAN | RESEARCH | WRITE) – reiner Text, genau eine VERDICT-Zeile am Ende." }] });
        content = finalizeContent(round);
      }
      return { content, usage: round.usage || {}, toolRounds, toolEvidence };
    }

    if (calls.length) {
      toolRounds++;
      for (const tc of calls) {
        let args = {};
        try { args = JSON.parse(tc.arguments || "{}"); } catch { /* egal */ }
        const shown = Object.values(args).filter((v) => typeof v === "string" && v).join(", ");
        // Phase 2: echte Tool-Aktivitaet (Tool + Datei/Arg) an den Aufrufer
        // melden - additiv, ohne Aufrufer bleibt alles wie bisher.
        // Echte Dateipfad-Extraktion (UI-065-Befund 1): Nur Argumente, die wie
        // Pfade aussehen (Pfad-Separator oder Datei-Endung), werden als
        // Datei gemeldet - Suchbegriffe/JSON/IDs sind KEINE Dateien.
        const looksLikePath = (v) => {
          if (typeof v !== "string" || !v.trim()) return false;
          if (/[\/\\]/.test(v)) return true;                       // enthält Pfad-Separator
          return /^[^\s"']+\.\w{1,10}$/.test(v.trim());            // Datei-Endung
        };
        const fileArg = Object.values(args).find((v) => looksLikePath(v));
        onTool?.({ tool: tc.name, file: typeof fileArg === "string" && fileArg ? fileArg : null });
        console.log(`⟳ Agent liest: ${tc.name}(${shown || ""})`);
        let result;
        let toolOk = false;
        try { result = execTool(tc.name, args); toolOk = true; } catch (e) { result = `FEHLER: ${e.message}`; }
        // Objektive Tool-Evidence: nur tatsächlich erfolgreiche, erlaubte
        // Aufrufe zählen später als "eigenes Lesen" (Regel 6). Der Whitelist-
        // /Root-Check passiert in execTool (tools.mjs) – ein throw heißt
        // blockiert, ein Ergebnis heißt erfolgreich und erlaubt.
        toolEvidence.push({
          tool: String(tc.name || ""),
          path: typeof fileArg === "string" ? fileArg : (args?.path ?? args?.pattern ?? null),
          allowed: toolOk,
          success: toolOk,
          error: toolOk ? null : String(result).replace(/^FEHLER: /, "").slice(0, 200),
        });
        const callId = tc.id || `call_${toolRounds}_${Date.now()}`;
        messages.push({ role: "assistant", content: null, tool_calls: [{ id: callId, type: "function", function: { name: tc.name, arguments: tc.arguments || "{}" } }] });
        messages.push({ role: "tool", tool_call_id: callId, content: result });
      }
      continue;
    }

    // F-4-Fix (Live-E2E 2026-09-02): Eine nicht-leere Text-Antwort OHNE
    // VERDICT und OHNE Tool-Calls galt als final -> parseVerdict null ->
    // UNBEKANNT (Run 2: Antwort brach mit „Let's read it." ab, code=3).
    // Jetzt: begrenzt Nachbohren (bounded 2, ohne Tools) mit dem bewaehrten
    // BEFUND/VERDICT-Muster; erst die letzte (ggf. weiterhin verdict-lose)
    // Antwort wird ehrlich zurueckgegeben - fail-closed bleibt unantastbar.
    if (!calls.length && c && !hasVerdict) {
      const probe = { role: "user", content: "Deine Antwort enthält kein VERDICT. Liefere JETZT die abschließende Falsifikations-Kritik mit BEFUND und VERDICT (PLAN | RESEARCH | WRITE) – reiner Text, genau eine VERDICT-Zeile am Ende." };
      let content = c;
      for (let attempt = 1; attempt <= 2; attempt++) {
        process.stderr.write(`⚠️ Antwort ohne VERDICT (finish=${round.finish || "?"}) – Nachbohren ${attempt}/2 …\n`);
        round = await fetchRound({ ...body, tools: undefined, reasoning_effort: undefined, messages: [...messages, probe] });
        content = finalizeContent(round);
        if (content && /VERDICT\s*:\s*\S+/i.test(content)) break;
      }
      return { content: content || c, usage: round.usage || {}, toolRounds, toolEvidence };
    }

    return { content: finalizeContent(round), usage: round.usage || {}, toolRounds, toolEvidence };
  }
}

async function fetchRoundWith(body, { apiKey, apiBase, timeoutMs = 180000, deadlineMs = null, retryBackoffMs = 1000, timeoutStagesMs = [5000, 30000, 60000] }) {
  let lastErr = null;
  const stages = Array.isArray(timeoutStagesMs) && timeoutStagesMs.length ? timeoutStagesMs : [5000, 30000, 60000];
  const attempts = stages.length;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res;
    // Effektiver Timeout je STUFE (5s -> 30s -> 60s), gedeckelt auf den
    // konfigurierten Gesamt-Timeout und die Deadline (Eskalation darf die
    // Deadline nicht sprengen).
    const stage = Math.min(stages[attempt - 1] ?? stages[stages.length - 1], timeoutMs);
    const effTimeout = deadlineMs ? Math.min(stage, Math.max(1000, deadlineMs - Date.now())) : stage;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Überlastung (Timeout nach ${Math.round(effTimeout / 1000)}s, Stufe ${attempt}/${attempts})`)), effTimeout);
    try {
      res = await fetch(`${apiBase}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      lastErr = /abort/i.test(String(e.name || e.message || "")) ? new Error(`Überlastung (Timeout nach ${Math.round(effTimeout / 1000)}s, Stufe ${attempt}/${attempts})`) : e;
      if (attempt < attempts) {
        process.stderr.write(`⚠️ Netzwerkfehler (${lastErr.message}) – Retry ${attempt}/${attempts - 1}, Backoff ${Math.round((retryBackoffMs * attempt) / 1000)}s …\n`);
        await sleep(retryBackoffMs * attempt);
        continue;
      }
      break;
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") || 0) * 1000;
      const wait = retryAfter || 5000 * attempt;
      process.stderr.write(`⚠️ 429 Rate-Limit – warte ${Math.round(wait / 1000)}s (Retry ${attempt}/3) …\n`);
      await sleep(wait);
      continue;
    }
    if (res.status >= 500 && attempt < 4) {
      process.stderr.write(`⚠️ HTTP ${res.status} – Retry ${attempt}/3 …\n`);
      await sleep(5000 * attempt);
      continue;
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      // Auth-Befund (User-Ticket 2026-09-03): 401/403 ist NICHT transient –
      // sofort failen OHNE Retry-Kaskade, mit Diagnose statt Kryptik. Häufigste
      // Ursache: der Key kam aus der Prozess-Env (geerbt), nicht aus der
      // .env von FALSIFY_HOME — dann sagt der Hinweis, WO der falsche Key
      // herkommt und WO der richtige liegen muss. Kein Key-Wert, kein Header.
      if (res.status === 401 || res.status === 403) {
        // Key-Herkunft ehrlich bestimmen: .env lesbar + gefüllt → Datei;
        // .env fehlt/leer aber Prozess-Env gefüllt → geerbtes Env (die Falle
        // aus dem 403-Livebefund: Dock-Fenster erben Keys aus der Shell).
        let origin = null;
        try {
          const envFile = fs.readFileSync(keyEnvFile(), "utf8");
          const hasAny = keyNames().some((n) => envFile.split(/\r?\n/).some((l) => l.startsWith(`${n}=`) && l.slice(n.length + 1).trim()));
          if (hasAny) origin = `${keyEnvFile()} (Datei)`;
        } catch { /* .env fehlt/unlesbar */ }
        if (!origin) {
          const envName = keyNames().find((n) => process.env[n]?.trim());
          origin = envName
            ? `Prozess-Umgebung (geerbtes ${envName}) – NICHT aus der .env-Datei`
            : `${keyEnvFile()} (Datei)`;
        }
        throw new Error(`HTTP ${res.status}: Autorisierung vom Provider abgelehnt (Key ungültig/abgelaufen/ohne Berechtigung für Modell ${body.model}). Key-Herkunft: ${origin}. Fix: falsify onboard (Dialog) oder Key in ${keyEnvFile()} eintragen, dann Job neu einreichen.`.slice(0, 500));
      }
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 500)}`);
    }

    const ctype = res.headers.get("content-type") || "";
    if (!ctype.includes("text/event-stream")) {
      const data = await res.json();
      const choice = data.choices?.[0]?.message || {};
      const toolCalls = (choice.tool_calls || []).map((tc) => ({ id: tc.id, name: tc.function?.name, arguments: tc.function?.arguments }));
      const content = choice.content || choice.reasoning_content || "";
      if (content) { streamWrite(content); streamFlush(); }
      return { content, usage: data.usage || {}, toolCalls };
    }
    return await readStream(res);
  }
  throw new Error(`API-Überlastung (Stufen ${stages.map((s) => `${Math.round(s / 1000)}s`).join("/")} erschöpft: ${lastErr?.message || "unbekannt"})`);
}

async function readStream(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  let usage = {};
  let finish = null;
  const toolCalls = [];
  let reasoningBuf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") { streamFlush(); return { content: content.trim(), reasoning: reasoningBuf.trim(), usage, toolCalls, finish }; }
      let chunk;
      try { chunk = JSON.parse(payload); } catch { continue; }
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finish = choice.finish_reason;
      const delta = choice.delta || {};
      const reasoning = delta.reasoning_content || "";
      const text = delta.content || "";
      if (reasoning) { reasoningBuf += reasoning; streamWrite(reasoning); }
      if (text) {
        streamWrite(text);
        content += text;
      }
      const tcs = delta.tool_calls;
      if (tcs) for (const tc of tcs) {
        const idx = tc.index ?? 0;
        toolCalls[idx] = toolCalls[idx] || { id: "", name: "", arguments: "" };
        if (tc.id) toolCalls[idx].id = tc.id;
        if (tc.function?.name) toolCalls[idx].name += tc.function.name;
        if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
      }
    }
  }
  streamFlush();
  return { content: content.trim(), reasoning: reasoningBuf.trim(), usage, toolCalls, finish };
}
