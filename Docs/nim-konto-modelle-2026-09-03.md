# NVIDIA-NIM-Konto: verifizierte Modell-Verfügbarkeit (03.09.2026)

> Live-Prüfung mit dem NVIDIA_API_KEY aus `FALSIFY_HOME/.env` (Key nie ausgegeben).
> Methode: `GET /v1/models` (Katalog) + echte Konto-Probe `POST /chat/completions`
> (`max_tokens=5`, Timeout 15 s) für die relevanten Kandidaten.

## Wichtige Erkenntnis: Katalog ≠ Konto-Zugriff

`GET /v1/models` liefert **81 Modell-IDs des ORG-Katalogs** — aber nicht, was das
**Konto** wirklich aufrufen darf. Der Konto-Zugriff entscheidet sich pro
„Function": Fehlt die Funktion, antwortet NIM mit
`HTTP 404 … Function '<uuid>': Not found for account '<konto>'`.
Die Katalog-Liste allein ist deshalb **ungeeignet als Onboarding-Quelle**
(das war der „Onboarding-Leak": Der Agent wählte Namen aus dem Katalog, das
Konto konnte sie nicht aufrufen → 404er-Serie im Live-E2E vom 03.09.2026).

## Verifiziert OK (HTTP 200, Konto-Zugriff vorhanden)

| Modell-ID | Probe-Latenz | Anmerkung |
|---|---|---|
| `openai/gpt-oss-20b` | ~15 s | aktuelles Main-Modell; Job 13 → PLAN (75 s) |
| `nvidia/nemotron-3-ultra-550b-a55b` | ~2 s | Job 1/4 (1× Abbruch, 1× UNBEKANNT) |
| `nvidia/nemotron-3.5-lightning-30b-a3b` | ~0,5 s | Jobs 8/11 → UNBEKANNT (Antwort leer) |
| `nvidia/nemotron-3-super-120b-a12b` | ~2 s | Job 12 → PLAN (140 s) |
| `minimaxai/minimax-m3` | ~0,4 s | neuer Fund, nie getestet |

## HTTP 404 — im Katalog, aber Konto OHNE Zugriff (ungültig für dieses Konto)

- `nvidia/llama-3.1-nemotron-70b-instruct` (Job 5)
- `nvidia/nemotron-nano-3-30b-a3b` (Job 9)
- `mistralai/mistral-large-2-instruct` (Job 10)
- `nvidia/llama-3.1-nemotron-51b-instruct` (Probe)
- `mistralai/mistral-large` (Probe)
- `moonshotai/kimi-k2.6` (Probe)

## Timeout 15 s — vorhanden, aber überlastet/zu langsam (unzuverlässig)

- `deepseek-ai/deepseek-v4-flash-0731` (Job 6: 283 s Überlastung) — die Antwort auf
  „hohe RPM?": kein 404, das Modell existiert im Konto, aber die Inferenz kam nie durch
- `deepseek-ai/deepseek-v4-pro-0813` (Probe)
- `mistralai/mistral-nemotron` (Job 7: 190 s Überlastung)

## Ergebnis der Aufräumaktion

- `~/.Falsify_Private/config.json` ist **sauber**: Main `openai/gpt-oss-20b`
  (NIM, 200 ✓) und Twin `openai/gpt-oss-20b` (OpenRouter, 200 ✓) — beides live
  verifiziert. **Es gab keine ungültigen Namen zu entfernen.**
- `.env`-Kommentare (`# FALSIFY_MODEL=…`) sind inert (nie gelesen) und enthalten
  nur den validen `nemotron-3-ultra-550b-a55b`.
- Die 404-Namen existieren ausschließlich **historisch** in der Job-DB
  (`runtime_config` der archivierten Läufe) — unveränderliche Records, kein
  Aufräumziel.
- Repo-Code enthält **keine** hartkodierten Modellnamen (0 Treffer).

## Empfehlung

1. Onboarding/`fetchAvailableModels` sollte statt der reinen Katalog-Liste eine
   **Konto-Probe** (Mini-Completion) oder eine gepflegte Whitelist der oben
   verifizierten IDs verwenden — sonst wiederholt sich die 404er-Serie.
2. Schnellste verifizierte Alternativen für künftige Läufe:
   `nvidia/nemotron-3-super-120b-a12b`, `nvidia/nemotron-3.5-lightning-30b-a3b`,
   `minimaxai/minimax-m3` (alle < 2 s Probe, Konto-Zugriff bestätigt).