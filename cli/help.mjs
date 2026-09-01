// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/help.mjs – Hilfetext der Verwaltungs-CLI
// ─────────────────────────────────────────────────────────────────────────────
export const HELP_TEXT = `FalsifyMe 2.0 · Verwaltungs-CLI

Verwendung:
  falsify status <job-id>                 Status + Zeiten eines Jobs
  falsify jobs                            Warteschlange: QUEUED / RUNNING / DONE / ERROR
  falsify history [--last n]              letzte Befunde aus der DB
  falsify scope new "<user-input>"        Scope anlegen (HEADER = User-Input 1:1)
  falsify scope show <id> [--full]        Scope-Artefakt (Header, Phase, letzter Befund, alle Befunde)
  falsify scope list [--all]              aktive (oder alle) Scopes
  falsify log <job-id>                    volles Protokoll eines Jobs (Payload + Antwort)
  falsify answer <job-id> [--file <pfad>] Antwort als Datei exportieren (optional)
  falsify ensure-home                     FALSIFY_HOME anlegen/prüfen (Keys + DB, ausserhalb des Repos)
  falsify doctor                          Runtime-Vertragsprüfung (Node, Config, Key, DB-Schema)
  falsify settings show                   effektive Runtime-Settings (Secrets maskiert)
  falsify settings set key=value …       Provider/Model/API-Base/API-Key runtime setzen
  falsify models [--api-base URL]         verfügbare Modelle + Provider-Pricing abrufen
  falsify help                            diese Hilfe`;
