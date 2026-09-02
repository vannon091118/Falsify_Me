# Speed-Audit & Latenz-Plan (2026-09-02) — Messung, Befunde, Maßnahmen

Nutzer-Vorgabe: Ein Task muss SPÜRBAR schneller werden (»90+ sek. ist Spielerei«).
Ziele: (1) Modellwahl beschleunigen, (2) Latenzzeiten prüfen/optimieren,
(3) UI so gestalten, dass der Nutzer auf einen Blick sieht: »OK, gerade läuft X,
das ist X weiter als vorhin.«

**Status: AUDIT abgeschlossen, Maßnahmen-Plan — KEIN Code geändert (Plan-Modus).**

---

## 1. Messung (Live, 2026-09-02, realistische Prompt-Größe ~3,5k Tokens Input)

Befehl: `node /tmp/bench.mjs` — OpenAI-kompatibel, `stream:true`, TTFT = Zeit bis
erster Content-Chunk, Durchsatz = Chunks nach TTFT.

| Kandidat | TTFT | gesamt | Durchsatz | Anmerkung |
|---|---:|---:|---:|---|
| **Groq qwen/qwen3.6-27b** | **224 ms** | 1,0 s | **489 tok/s** | ⚡ Klarer TTFT- und Durchsatz-Sieger |
| NVIDIA nemotron-3-super-120b (Qualität) | 382 ms | 0,4 s | — | streams `reasoning_content` vor Content (Messzeit bis Content nicht isolierbar; Reasoning beginnt sofort) |
| NVIDIA nemotron-3.5-lightning-30b | — | — | — | **HTTP 400: »Function … DEGRADED«** (Provider-Backend aktuell degradiert — Live-Blocker, s. u.) |
| NVIDIA nemotron-3-nano-30b | — | — | — | **HTTP 410 Gone** (Modell eingestellt) |
| OpenRouter qwen/qwen3.6-27b | **25 093 ms** | 25 s | 0 (Content kam nicht) | ❌ 25 s TTFT — als Twin-Transit unbrauchbar |
| OpenRouter deepseek-v4-flash | 1 438 ms | 80 s | 2 tok/s | ❌ hohe Gesamtlatenz |
| OpenRouter nemotron-nano-reasoning:free | 31 895 ms | 43 s | 30 tok/s | ❌ Free-Tier-Warteschlange |

### Kernzahl für den Nutzer
- **Groq qwen3.6-27b: TTFT 0,22 s bei 489 tok/s** (gemessen mit reasoning_effort=default).
- **OpenRouter qwen3.6-27b: TTFT 25 s** — das ist der reale Twin-Transit von
  Speed-Lauf 2 (job-…bjserq) und erklärt maßgeblich dessen >14-min-Laufzeit.

---

## 2. Wo gehen die ~400 s pro Job hin? (Job-Zeitanalyse, DB-Logs)

| Job | Modell | Dauer | Befund |
|---|---|---|---|
| job-…bcaeev (Qualität It.1) | Super 120B | ~225 s | 1 Thinker-Pass, echte Falsifikation, SUBPROMPT |
| job-…kdqywn (Speed It.1) | Lightning | ~400 s (15:23:04→15:29:45) | Modell WRITE, Twin-Gate 400 → PLAN |
| job-…bjserq (Speed It.2) | Lightning + qwen@OpenRouter | >14 min → Abort | TTFT-Ketten: 25 s TTFT × mehrere Runden + degradiertes NVIDIA-Backend → kein Verdict |

### Zerlegung (Kandidaten-Modell, belegbar hoch)
- **Tool-Runden sind der Hauptkostenblock:** Jede Runde = neuer Modell-Call mit
  wachsendem Kontext (alle bisherigen Tool-Ergebnisse). Bei 14 erlaubten Runden
  (Default `maxToolRounds`) und 25 s–2 min TTFT pro Runde (je nach Transit)
  entstehen 5–15 min Laufzeit auch dann, wenn der eigentliche Befund schnell klar ist.
- **Provider-Latenz dominiert die Runde:** bei NVIDIA degradiert (400), bei
  OpenRouter 25 s TTFT, bei Groq 0,2 s TTFT.
- **Twin (Evil Twin) kostet einen ZUSÄTZLICHEN vollen Lauf** — aber nur bei
  WRITE-Kandidaten; bei Groq-Transit ist er mit 1–2 s Rundenzeit günstig.

---

## 3. Maßnahmen-Plan (nach Votum umsetzen)

### A. Modellwahl (Speed-Profil)
1. **Twin → Groq qwen/qwen3.6-27b** (statt OpenRouter): TTFT 0,2 s vs. 25 s.
   Voraussetzungen sind im Worktree bereits FIXT: `twinReasoningEffort=off`
   (F-3) und `twinMaxTokens ≤ 16384` (F-11, Default min(20000,16384)).
   Config: `falsify settings set twinApiBase=https://api.groq.com/openai/v1
   twinApiKeyEnv=OPENAI_API_KEY` (+ Groq-Key in .env).
2. **Primary: Lightning wenn NVIDIA-Backend wieder funktioniert** (400 DEGRADED
   ist provider-seitig, nicht unserer Config — vor Job-Start per Preflight-Call
   prüfen und ehrlich melden); Qualität weiterhin Super 120B (Reasoning erscheint
   sofort via `reasoning_content`, subjektiv schnell).
3. **OpenRouter nur als Notfall-Transit** dokumentieren (25 s TTFT, Free-Tier
   402-Grenze bei max_tokens > ~5k).

### B. Latenz-Optimierung (Code, nach Votum)
1. **`maxToolRounds` senken** (14 → z. B. 6–8): Summe der Rundenlatenzen ist der
   größte Hebel; der Agent soll mit weniger, gezielteren Lesezugriffen arbeiten.
   (Wägung: zu wenige Runden → schwächere Falsifikation. Vorschlag: Speed-Profil
   als eigene Config, Qualitätsprofil behält 14.)
2. **TTFT-Vorprüfung im `doctor` / preflight:** vor jedem Job einen 1-Token-Call
   an Primary- und Twin-Endpoint messen; >5 s ⇒ Warnung (»Transit langsam:
   gemessen X ms — erwartet < 2 s«). Macht Provider-Degradierung sichtbar, statt
   stumm 14 min zu hängen.
3. **Kein Puffer-Truncation:** `streamWrite`/`wrapStreamLines` ist nicht die
   Latenzquelle (nur Display); KEINE Anpassung nötig.

### C. UI: »Auf einen Blick: gerade passiert X, das ist X weiter als vorhin«
(F-9-Fix-Richtung + Nutzer-Anforderung, code-frei dokumentiert)
1. **Phase-Bar statt statischem Banner:** Zeigt live `CLAIM → LESEN → ANALYSE →
   FALSIFIKATION → TWIN → VERDICT` mit aktuellem Marker (FM-EVT `state`/`phase`
   werden bereits von run.mjs emittiert — sie kommen nur wegen F-9 nicht zur
   Anzeige).
2. **Fortschritts-Zähler:** `Schritt n/N` je Phase + Tool-Aktivität
   (`read core/keys.mjs`, werden bereits als `activity`-Events emittiert).
3. **»X weiter als vorhin«:** Deltas über Sessions hinweg persistieren
   (FALSIFY_HOME, nicht Worktree) — z. B. Job-Nr., Phase-Wechsel-Zeitstempel,
   letzte-Phase-Timeline: »Phase 3/6 (Falsifikation) seit 12 s — vorher: Phase 2
   dauerte 41 s«.
4. **Reasoning-Ticker:** `reasoning_content` (NVIDIA) bzw. Output-Ringzeilen
   live anzeigen — der Nutzer sieht den Gedankengang entstehen (statt »– noch
   kein Output –«).
5. **Render-Regime:** 15 FPS nur bei sichtbaren Panels; sonst 1 Hz — beseitigt
   die Frame-Zeiten >1 s (F-10).

### D. Akzeptanz-Kriterium (Speed)
- E2E-Job (Speed-Modus, Groq-Twin): **Ziel < 90 s Gesamt** (inkl. Falsifikation).
- Erste Messreihe nach Umsetzung: 3× Job mit gleichem Plan; Median dokumentieren.

---

## 4. Cross-Referenzen
- F-3 (twinReasoningEffort), F-11 (twinMaxTokens) — beide FIXT im Worktree.
- F-9/F-10 (Dock-Sichtbarkeit/RAM) — Teilziel C.
- F-12 ([T]-Toggle tot) — Teilziel C (Modus real verdrahten oder entfernen).
- Befund »NVIDIA lightning 400 DEGRADED« + »nano 410 Gone« als neue
  Audit-Notizen (Provider-Landschaft, s. findings.md F-14).
## Live-Bestätigung durch E2E-User-Test (2026-09-02, DOKI-Projekt)

Zwei Gate-Einreichungen des Nutzers (Plan-Only, WRITE-Ziel) endeten
fail-closed mit UNBEKANNT/Exit 3 — Modell bestätigte, Evidenz-Vertrag griff.
Konsequenzen für die Speed-/UX-Planung:

- **Ablehnungsgrund fehlt in der UI:** Dock zeigt nur „KEIN gültiges
  Verdict". Erste Maßnahme im UI-Paket: Gate-Grund (fehlender
  Falsifikationsversuch / Evidenz-Triade / Coverage) als eine Zeile im
  Verdict-Panel + im CLI-Exit-Hinweis — spart dem Nutzer den Log-Lookup
  (das ist der eigentliche „tot"-Eindruck bei Start-abgelehnten Jobs).
- **Per-Tier-Modellwahl ist der nächste Speed-Hebel:** Die env-Overrides
  (`FALSIFY_MODEL`/`FALSIFY_API_BASE`/`FALSIFY_API_KEY_ENV`) sind einzeln
  vorhanden, aber nicht gebündelt wählbar (kein Matrix-Mechanismus). Der
  Nutzer plant einen projekt-lokalen Wrapper (falsify-check.sh +
  falsifyme-matrix.json) — FalsifyMe bleibt read-only. Sobald der
  Mechanismus existiert, lässt sich das Speed-Profil (Lightning + Groq-Twin)
  pro Aufgabe aus der Cycle-Zeit drücken: Akzeptanzziel < 90 s bleibt.
