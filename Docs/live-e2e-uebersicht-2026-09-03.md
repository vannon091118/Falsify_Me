# Live-E2E-Übersicht: „Analyse des Potenzials von FalsifyMe"

> Datenstand **03.09.2026, 21:46 Uhr (lokal, UTC+2)**. Quellen: `~/.Falsify_Private/falsify.db`
> (read-only Query), `logs/`, `config.json`/`.env` (nur Key-Namen), `worker.mjs --check`.
> Zeiten in der Job-Tabelle sind lokal; die DB speichert UTC (18:21Z = 20:21 lokal).

## 1. Setup & Live-Zustand

| | |
|---|---|
| Projekt (Checkout) | `C:\Users\Vannon\Desktop\user_inputs_parser\Falsify_Me` (Root-Name `Falsify_Me`, Identität via `FalsifyME.md`) |
| Scope | `scope-1788459663826-7gv0we` — **active**, Phase `plan`, Header: *Analyse des Potenzials von FalsifyMe* |
| Modus / Selbstprüfung | `plan`, Selbstprüfung erkannt → Kern-Whitelist (run.mjs, verdict.mjs, twin.mjs, AGENTS.md …) |
| Worker (live) | **PID 10804, Fenster 1**, läuft seit 20:21:24; `--check` → RUNNING (21:46) → **IDLE**; Queue: 0 offene Jobs |
| Konfig (final) | Main: NVIDIA NIM `NVIDIa 55b Lightning` (integrate.api.nvidia.com/v1, maxTokens 32768, reasoningEffort low) · Twin: OpenRouter `openai/gpt-oss-20b` (openrouter.ai/api/v1, maxTokens 16384) · Keys gesetzt (NVIDIA/OPENAI/FALSIFY/GROQ/OPENROUTER) |
| Baseline | `change_digest 4c3350513c…` über **alle 13 Jobs identisch** → Code wurde während des Runs nie verändert |

## 2. Job-Verlauf (13 Jobs, 20:21–21:05)

| # | Zeit (lokal) | Dauer | Modell (Versuch) | Ergebnis |
|---|---|---|---|---|
| 1 | 20:21:18–20:22:30 | 66 s | nemotron-3-ultra-550b-a55b | ❌ ERROR Worker-Abbruch (Exit 0xC000013A) — **einziger Scope-Lauf** |
| 2 | 20:23:52 | 1 s | – (kein Modell) | ❌ HTTP 400 „model field is required" |
| 3 | 20:24:23 | 1 s | – (kein Modell) | ❌ HTTP 400 „model field is required" |
| 4 | 20:26:24–20:27:49 | 85 s | nemotron-3-ultra-550b-a55b | ⚠️ DONE UNBEKANNT (kein Verdict parsebar) |
| 5 | 20:28:20 | 1 s | llama-3.1-nemotron-70b-instruct | ❌ HTTP 404 „Function … not found for account `5Oj…`" |
| 6 | 20:28:39–20:33:22 | 283 s | deepseek-ai/deepseek-v4-flash-0731 | ❌ API-Überlastung (Retry 5/30/60 s erschöpft) |
| 7 | 20:33:33–20:36:43 | 190 s | mistralai/mistral-nemotron | ❌ API-Überlastung |
| 8 | 20:36:58–20:48:04 | 666 s | nemotron-3.5-lightning-30b-a3b | ⚠️ DONE UNBEKANNT (Call lief 11 min, Antwort leer/unerkannt) |
| 9 | 20:50:03 | 1 s | nemotron-nano-3-30b-a3b | ❌ HTTP 404 (nicht im Konto) |
| 10 | 20:50:14 | 1 s | mistral-large-2-instruct | ❌ HTTP 404 (nicht im Konto) |
| 11 | 20:50:32–20:52:49 | 137 s | nemotron-3.5-lightning-30b-a3b | ⚠️ DONE UNBEKANNT |
| 12 | 20:53:24–20:55:43 | 140 s | nemotron-3-super-120b-a12b | ✅ DONE **PLAN** |
| 13 | 21:03:37–21:04:52 | 75 s | openai/gpt-oss-20b | ✅ DONE **PLAN** |

**Bilanz:** 13 Jobs · 0 WRITE (korrekt fail-closed) · 8 ERROR (1 Crash, 2× 400, 3× 404, 2× Überlastung) · 3 UNBEKANNT · 2 PLAN · **0 Findings, 0 offene Konflikte.**

## 3. Befunde & Auffälligkeiten

1. **Modell-Roulette:** Jeder Versuch lief mit einem anderen Modell (8 verschiedene, teils ohne Modell-Feld). Die 404-Fehler („Function … not found for account `5Oj…`") sind **kein Namensfehler, sondern Konto-Zugriff**: Alle benutzten Namen stehen im NIM-Katalog (`GET /v1/models`, 81 IDs), aber das Konto darf nur einen Teil aufrufen. Live-Probe am 03.09.2026 verifiziert — Details in `docs/nim-konto-modelle-2026-09-03.md`.
2. **Der Scope-Lauf ist nie zu Ende gegangen:** Nur Job 1 war dem Scope zugeordnet — sein Worker-Kindprozess wurde abgebrochen (Exit 0xC000013A = Fenster geschlossen/Ctrl+C, 66 s nach Start). Alle weiteren Jobs liefen als Scan-Welle (`wave=scan`, ohne `scope_id`). Die eigentliche Scope-Frage (*Analyse des Potenzials von FalsifyMe*) ist damit bislang **unbeantwortet**.
3. **Fail-closed war korrekt:** 0 WRITE bei stabiler Code-Basis — auch leere/unparsebare Modellantworten (Jobs 4/8/11, bis zu 11 min Call) endeten in UNBEKANNT, nie in einer Freigabe.
4. **Status-Ausgabe:** Die Anker-Zeile in der `worker.mjs --state`-Ausgabe passte nicht zu den gespeicherten Daten (vermutlich Template ohne echte Scope-Zahlen).
5. **Sonstiges:** `falsify.db-wal` ist mit 3,4 MB ungewöhnlich groß (Checkpoint offen); rate_limit-Slot frei; Worker läuft sauber weiter (kein Orphan — sichtbares Dock-Fenster, daher nicht gekillt).

**Kurzfassung:** Der Live-E2E-Test hat das System 13 Läufe lang gegen eine stabile Code-Basis belastet und nie fälschlich freigegeben — belastbare Antworten kamen aber erst nach der Modell-Konfiguration (gpt-oss-20b), und die eigentliche Scope-Frage blieb wegen des abgebrochenen ersten Laufs bislang unbeantwortet.

## 4. Anmerkungen des Users (aus der Job-Tabelle, 1:1)

| Job | Anmerkung | Bedeutung |
|---|---|---|
| 1 | „war ich" | Der Scope-Lauf wurde vom User **selbst** gestartet (Fenster geschlossen → 0xC000013A), kein System-Crash. |
| 2/3 | „ONBOARDING LEAK — MODELLE MÜSSEN AUSWÄHLBAR SEIN FÜR DEN NUTZER, NICHT VOM AGENTEN VIA API CALL" | Fehlendes Modell-Feld (400) entstand, weil der Agent das Modell per API-Call bestimmt hat statt einer Nutzer-Auswahl im Onboarding. |
| 6 | „ist nicht free model, Agent ist daran schuld, onboarding leak" | deepseek-v4-flash ist **kein kostenloses Modell**; der Agent hat es trotzdem gewählt — derselbe Onboarding-Leak. |
| 6 | „Deepseek v4 Flash = hohe RPM?" | Offene Frage: War die API-Überlastung eine RPM-Grenze des Modells? |
| 7 | „KEIN KEY?!" | Offene Frage: Fehlte für mistral-nemotron ein Key? (Config zeigt Keys gesetzt; Überlastung statt Auth-Fehler.) |
| 8–10 | „NIM KATALOG/DOCS" | Modellnamen gegen den NVIDIA-NIM-Katalog/die Docs prüfen — `docs/NIM KATALOG.pdf` liegt bereits im Repo. |

## 5. Nächste Schritte / offene Aufgaben

1. **Scope-Frage beantworten:** `falsify resume` (bzw. Submit mit `--header "Analyse des Potenzials von FalsifyMe"`) mit dem jetzt konfigurierten `gpt-oss-20b` — der eigentliche Analyse-Auftrag ist nie durchgelaufen.
2. **Onboarding-Leak schließen:** Modell-Auswahl gehört in den Onboarding-Dialog (Nutzer), nicht in den Agenten-Call — vgl. PLAN-Task UI-073 (API-Key-Dialog als TODO); Modellwahl analog ergänzen.
3. **NIM-Katalog-Abgleich:** ✅ Erledigt (03.09.2026) — Live-Probe aller relevanten Kandidaten, verifizierte Liste in `docs/nim-konto-modelle-2026-09-03.md`. Offen: Onboarding/`fetchAvailableModels` soll die Konto-Probe bzw. Whitelist statt der reinen Katalog-Liste nutzen (siehe Punkt 2).
4. **WAL-Größe beobachten:** 3,4 MB WAL bei offenem Checkpoint — nach Worker-Stopp prüfen, ob der Checkpoint normal läuft.

## 6. Befunde aus den rohen DB-Einträgen (falsify.db, read-only Query 21:46)

| Feld | Befund |
|---|---|
| `verdict`-Spalte | Bei **allen 11** UNBEKANNT/ERROR-Jobs **leer** — das Urteil steckt nur im `status`-String (`DONE UNBEKANNT`). Nur die PLAN-Jobs #12/#13 tragen `verdict='PLAN'`. Der Zustand ist von `checkQueueConsistency` abgedeckt („DONE-Status vs. jobs.verdict inkl. UNBEKANNT"). |
| `retry_at` | **NULL bei allen Jobs** — auch bei den transienten Überlastungen #6/#7 (`failure_kind=transient`). `attempt` blieb 1 von `max_attempts=2`: Die 5s/30s/60s-Stufen liefen **innerhalb des einen Calls** (Stufe 3/3 = Timeout nach 60 s), ein zweiter Versuch wurde nie geplant/geclaimt → **Transient-Retry-Pfad faktisch tot**. **✅ GEFIXT (03.09.2026):** `cli/run.mjs` ruft im Fehlerpfad jetzt `retryJob` (artifacts/jobs.mjs) statt direktem `jobDone` — transient mit Versuchsrest → QUEUED + `retry_at`, der Worker claimt als Versuch 2; erst Limit/permanent → ERROR. |
| Antwort-Logs | Nur **2 von 13** Jobs haben eine `logs/falsify-answer-*.txt`-Datei: #1 („kein Inhalt – Fehler: Worker-Abbruch") und #8 („kein Inhalt – Status DONE UNBEKANNT"). Die UNBEKANNT-Jobs **#4 und #11 haben GAR KEIN Antwort-Log** → vom Modell kam nichts Persistierbares zurück. |
| `diff_text` | NULL bei allen 11 UN/ERROR-Jobs (kein Diff archiviert — Scan-Wellen ohne WRITE-Kandidaten). |
| `payload` | Exakt 802 B bei allen 11 — identischer Eingabe-Prompt. |
| `window_idx` | Nur #1 trägt `window=1` (Scope-Fenster); alle anderen `-` (Scan-Wellen ohne Scope-Zuordnung). |
| `worker.debug.log` | #1 endete `code=3221225786` (0xC000013A); danach mehrere Worker-(Re)Starts (u. a. 18:59/19:15 mit `agent="Agent 1"`) — die Scan-Wellen entstanden durch Worker-Neustarts, der Scope wurde nie wieder beansprucht. |

**Konsequenz:** Die DB archiviert alle 11 sauber fail-closed (kein Fake-Verdict), aber (a) UNBEKANNT ist nur als Status sichtbar, nicht als `verdict`-Wert; (b) transiente Fehler endeten ohne Re-Queue trotz `max_attempts=2` — **behoben am 03.09.2026** (retryJob-Verdrahtung in cli/run.mjs, Tests in tests/queue.test.mjs, statische Wächter in tests/invariants.test.mjs); (c) leere Modellantworten hinterlassen teils keine Antwort-Spur. (c) bleibt Kandidat für einen eigenständigen Fix.