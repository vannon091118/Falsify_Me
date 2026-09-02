# Umsetzungsplan: Live-E2E-Härtung (3 validierte Befunde)

## Auftrag

Behebe die drei unten belegten Befunde in FalsifyMe (Key-Laden, Settings-CLI, Evil-Twin-Konfiguration) und sichere sie mit Regressionstests ab. Keine anderen Dateien anfassen.

## Phasen-Semantik (wichtig für die Prüfung)

Dies ist ein PLAN (Scope-Phase: plan). Es wird in dieser Iteration NOCH NICHTS implementiert — der Plan beschreibt den Zielzustand, der NACH der Freigabe (VERDICT: WRITE) vom Coding-Agenten umgesetzt wird. Dass die Änderungen aktuell nicht im Quelltext stehen, ist der belegte IST-Zustand, kein Plan-Fehler, kein Widerspruch und kein SCOPE-DIVERGENZ-Grund.

| IST-Zustand (heute belegt) | SOLL-Zustand (erst nach Freigabe umgesetzt) |
|---|---|
| `core/keys.mjs:20` `.find()` wählt den ersten Treffer | letzte / erste nicht-leere Zeile gewinnt |
| `core/settings.mjs:9-12` `CONFIG_KEYS` ohne twin*-Namen | `twinModel`/`twinApiBase`/`twinApiKeyEnv`/`twinReasoningEffort` + Validierung |
| `core/config.mjs` liefert kein `twinReasoningEffort` | lädt `twinReasoningEffort` (Fallback `reasoningEffort`, Enum) |
| `cli/run.mjs:596` übergibt nur `CFG.reasoningEffort` | übergibt `CFG.twinReasoningEffort` an `runTwinCheck` |

## Befund 1 — Duplikat-Schatten-Falle beim API-Key-Laden (.env)

Beobachtung im Live-E2E: Nach einem manuellen Append lagen in der privaten `.env` zwei `OPENAI_API_KEY=`-Zeilen — zuerst die leere Vorlagen-Zeile, dann die befüllte Kopie. Der Key wurde danach nicht geladen.

Beleg: `core/keys.mjs:20` → `const line = lines.find((l) => l.startsWith(`${name}=`));` — `.find()` wählt die ERSTE passende Zeile; ist sie leer (Vorlage), gewinnt der leere Wert und der spätere echte Wert bleibt unsichtbar (Schatten-Semantik). Folge: ein befülltes Duplikat erscheint als „Kein API-Key", obwohl ein Wert existiert.

Fix: `readKeyFromEnvFile` muss bei mehreren passenden Zeilen die ZULETZT geschriebene (bzw. die erste NICHT-leere) wählen; leere Vorlagen-Zeilen zählen nie als Wert.

## Befund 2 — `falsify settings set` kennt die Twin-Diversität nicht

Beobachtung: Die Evil-Twin-Diversität (Security-Review Pkt 3) ist im Live-E2E nur per Hand-Edit der `config.json` konfigurierbar; die CLI weist `twinModel`/`twinApiBase`/`twinApiKeyEnv` ab.

Beleg: `core/settings.mjs:9-12` definiert `CONFIG_KEYS` ohne die drei Twin-Namen; `core/settings.mjs:94-95` wirft für alles außerhalb „Unbekannte Runtime-Einstellung" — obwohl `core/config.mjs` (`twinModel`/`twinApiBase`/`twinApiKeyEnv`) die Werte längst liest. Doku und CLI klaffen auseinander.

Fix: `CONFIG_KEYS` um die drei Twin-Namen erweitern, `twinApiBase` gegen das http(s)-Präfix validieren (wie `apiBase`), `settings show` zeigt die Twin-Konfiguration.

## Befund 3 — Evil Twin erbt den reasoningEffort des Primärmodells

Beobachtung: Live-Preflight — Groq antwortet auf `reasoning_effort=high` mit HTTP 400 (`reasoning_effort must be one of none or default`); NVIDIA akzeptiert `high`. Da der Twin denselben `reasoningEffort` wie der Primärlauf erhält, ist eine Twin-Freigabe (BESTAETIGT) mit Groq-Twin bei konfiguriertem `high` strukturell unmöglich → fail-closed PLAN, aber aus dem falschen Grund.

Beleg: `cli/run.mjs:596` → `reasoningEffort: CFG.reasoningEffort,` (einziger, gemeinsamer Wert; kein twin-eigener Effort in der Konfiguration).

Fix: eigener Konfigurationswert `twinReasoningEffort` (Default: Wert des Primärlaufs), der in `core/config.mjs` geladen wird (Fallback auf `reasoningEffort`), in `core/settings.mjs` validiert wird (Enum wie beim primären `reasoningEffort`) und den `run.mjs` an den Twin durchreicht; bei nicht unterstützten Providerwerten (z. B. Groq-`high`) ehrlich warnen und auf einen kompatiblen Wert ausweichen.

## Umzusetzende Änderungen

- `core/keys.mjs` — Duplikat-Auflösung in `readKeyFromEnvFile` (letzte / erste nicht-leere Zeile gewinnt).
- `core/config.mjs` — `twinReasoningEffort` laden (Fallback auf `reasoningEffort`, Enum-Validierung wie beim Primärwert).
- `core/settings.mjs` — `CONFIG_KEYS` um `twinModel`/`twinApiBase`/`twinApiKeyEnv`/`twinReasoningEffort` erweitern mit passender Validierung (String für Modell/Key-Env, http(s)-Präfix für `twinApiBase`, Enum für `twinReasoningEffort`); `settings show` zeigt die Twin-Konfiguration.
- `cli/run.mjs` — `twinReasoningEffort` an `runTwinCheck` durchreichen.
- Regressionstests in der bestehenden Test-Suite ergänzen (Schatten-Falle mit leeren Vorlagen-Zeilen; settings-set akzeptiert Twin-Namen; Twin-Reasoning-Effort-Übergabe).

## Falsifikationsversuche

- Versuch, Befund 1 zu widerlegen: „In core/keys.mjs steht an Zeile 20 KEIN `.find` auf die erste Zeile." → widerlegt: `core/keys.mjs:20` existiert real und enthält genau `lines.find((l) => l.startsWith(`${name}=`))` — die Schatten-Semantik (erste Zeile gewinnt) ist damit belegt, keine Fantasie-Zeile, Bug bestätigt.
- Versuch, Befund 2 zu widerlegen: „`falsify settings set twinModel=…` funktioniert bereits." → widerlegt: `core/settings.mjs:94-95` verwirft Namen außerhalb `CONFIG_KEYS` (`core/settings.mjs:9-12`), und `twinModel` fehlt dort — die CLI-Kluft ist real, die Annahme ist falsch.
- Versuch, Befund 3 zu widerlegen: „Der Twin nutzt einen eigenen reasoningEffort." → widerlegt: `cli/run.mjs:596` übergibt einen einzigen gemeinsamen `CFG.reasoningEffort` — ein twin-spezifischer Wert existiert nicht; das Gegenteil ist live belegt (Groq-400 bei `high`). Iteration 2 schließt die zuvor gefundene Lücke: `core/config.mjs` lädt `twinReasoningEffort` (Fallback `reasoningEffort`), `core/settings.mjs` validiert ihn — der Widerspruch aus Iteration 1 („config.mjs unverändert") ist damit beseitigt, belegt durch die reale `loadConfig()`-Struktur.