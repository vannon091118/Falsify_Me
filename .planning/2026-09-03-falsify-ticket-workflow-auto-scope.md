# FalsifyMe: Ticket-Workflow mit automatischer Scope-Bestimmung (KOMPLETTE FEATURE-VERSION)

> Stand: 2026-09-03 · Status **ENTWURF – wartet auf das Entwickler-Gate des Nutzers.**
> Kein Code, keine Runtime, kein Skill-Change, kein ui/PLAN.md-Eintrag vor Gate-Entscheid.
> Diese Datei ist Plan-Dokument im Repo (Konvention `.planning/`), nicht Runtime-Verhalten.

---

## 1. Auftrag (User-Contract, 1:1)

**„Scope-ID MUSS FalsifyMe automatisch bestimmen. Der Agent darf NICHT selbst entscheiden."**
Der vollständige, für den Nutzer SICHTBARE Workflow (kein headless Beweis) lautet:

1. **Agent schreibt den Job als Ticket** („was soll gemacht werden") – ein Artefakt, kein ID-Buchhalter.
2. **FalsifyMe bestimmt den Scope automatisch** (minted ID, Zuordnung allein durch FalsifyMe).
3. **FalsifyMe fordert Daten an, um planen/falsifizieren zu können** (RESEARCH / Whitelist-Nachforderung – existiert, bleibt).
4. **Evil Twin falsifiziert** (Probe-Exekution – existiert, bleibt).
5. **BEIDES** (Agent-Ticket+Plan **und** FalsifyMe-Falsifikation) **wird als Prüfauftrag an den externen Agenten ausgegeben** (Handoff-Brief – existiert, wird sichtbar/explizit als Prüfauftrag ausgewiesen).
6. **Prüfergebnisse des externen Agenten gehen zurück an FalsifyMe** (handoff complete → automatisches Re-Review – existiert, bleibt).

Verbindliche Rahmenbedingungen (aus der Session, unverhandelbar):

- **FalsifyMe wird NIE vom Worktree aus genutzt** (nur die installierte Instanz).
- **User Experience = SICHTBAR**: Abnahme = voller E2E-Lauf im sichtbaren Dock-Fenster; ein headless Lauf zählt nicht als Beweis.
- **Keine stillen Änderungen**: Plan deckt ALLES ab (Code, CLI, Skills, Doku, UI, Tests, Invarianten, Migration).
- **Shared API Key – by design, nicht anfassen.**
- **Modell-Wechsel wenn Thinker idle / Evil Twin denkt – by design, nicht anfassen.**
- **Kein MVP, kein Proof – vollständige Feature-Version.**
- Während der laufenden E2E-Session des Nutzers: **keine Tests/Runtime-Befehle**, die die Runtime stören (diese Datei ist reines Plan-Dokument).

---

## 2. Ist-Zustand (verifiziert, Datei:Zeile)

| Fakt | Beleg |
|---|---|
| Scope-ID wird von FalsifyMe geminted | `artifacts/scopes.mjs:21-22` (`genId("scope")`) + `cli/scope.mjs:36-39` (`scope new`) |
| HEADER = User-Input 1:1, nie umformuliert | `artifacts/db.mjs:114` (Schema-Kommentar), `artifacts/scopes.mjs:20-28` |
| Agent MUSS die Scope-ID bei Loop-Fortsetzung selbst mitgeben | `skills/agent-skill-falsify.sh:24,96-113,273` (`--scope` Pflicht), `skills/agent-skill-falsify.mjs:26,158-161,300`, `skills/agent-skill-falsify.ps1:23,113-123`; `skills/falsifyme.md:33`; `skills/falsifyme-falsiflow.md:110`; `cli/onboard/steps.mjs:91`; `cli/bootstrap/templates/{bash.sh,generic.md,agents-codebuff.md}` |
| Agent parst `SCOPE_ID=` aus `scope new`-Output und reicht sie zurück | `skills/agent-skill-falsify.sh:113-120`, `.mjs:165-176`, `.ps1:116-120` |
| `submit` akzeptiert `--scope <id>` (optional) | `cli/run.mjs:122,195,399-408` |
| Ohne `--scope` entsteht ein Job OHNE Scope (scopeId null) | `cli/run.mjs:358-367` (`scopeId: scope ? scope.id : null`) – heute still möglich |
| HEADER-Digest + Change-Digest werden bei Submit eingefroren | `cli/run.mjs:346-357` (TASK-005), Abweichung → fail-closed ohne Modell-Call (`cli/run.mjs:450-459`) |
| RESEARCH-Whitelist-Nachforderung wird automatisch gemerged | `cli/run.mjs:236-257` (UI-094), gespeichert in `scopes.research_additions` |
| Evil-Twin-Probe-Exekution + Gate | `core/twin.mjs`, `core/probes.mjs`, `core/handoff.mjs` (P0) |
| Handoff-Brief enthält Ticket + Falsifikation + Twin-Probe-Ergebnis | `core/handoff.mjs:145-175` (`renderCoderBrief`: „Die Falsifikation (Thinker + Evil Twin, Probe-Exekution…)", „## Falsifikations-Ergebnis (Evil Twin, Probe-Exekution)") |
| Prüfergebnis-Rückweg: completeHandoff → Child-Job → Re-Review | `artifacts/handoff.mjs:40+` (eine Transaktion, genau ein Child), `artifacts/loopflow.mjs` (RE_REVIEW_QUEUED) |
| `scopes`-Tabelle: kein Unique-Index auf (checkout_id, header), kein Lookup-by-Header | `artifacts/db.mjs:109-124` |
| Scope-Zustände: `status active|hardened|done` | `artifacts/db.mjs:113`, `artifacts/scopes.mjs:34-36` (nur active läuft) |

**Kernbefund:** Die Falsifikationspipeline (Schritte 3–6 des Auftrags) existiert vollständig.
Der einzige strukturelle Punkt, an dem der Agent „entscheidet", ist die **Scope-Zuordnung bei Submit/Fortsetzung**
(`--scope <id>` im Agent-Pfad). Genau dort greift die Forderung an.

---

## 3. Kern-Design: Header-Identität statt Scope-ID (Agent darf nichts wählen)

### 3.1 Prinzip

Der **einzige** vom Agenten gelieferte Identitätsanker ist das Ticket (= User-Input 1:1, der HEADER).
FalsifyMe leitet daraus deterministisch den Scope ab:

> Scope-Auflösung: `(checkout_id, header)` → **genau ein aktiver Scope** = Fortsetzung.
> **kein aktiver Scope** = FalsifyMe legt ihn automatisch an (minted ID – wie heute, nur ohne Agent-Zutun).
> **mehrere aktive Scopes mit identischem Header** = mehrdeutig → fail-closed mit ehrlicher Liste (kein stilles Raten).

Der Agent sieht nie eine Scope-ID und gibt nie eine zurück. Seine Schleife ist nur noch:
**Ticket 1:1 + Plan + Dateien einreichen → Verdict lesen → handeln → wieder einreichen (gleiches Ticket).**

### 3.2 Neue Resolution-Funktion (rein additiv)

`artifacts/scopes.mjs`:
```js
export function resolveScopeForCheckout(db, checkoutId, header) {
  // aktive Scopes exakt mit diesem HEADER, neuester zuerst
  const rows = db.prepare(
    "SELECT * FROM scopes WHERE checkout_id = ? AND header = ? AND status = 'active' ORDER BY created_at DESC"
  ).all(checkoutId, header);
  if (rows.length === 0) return { kind: "new" };                       // → createScope (Auto-ID)
  if (rows.length === 1) return { kind: "continue", scope: rows[0] };  // → normale Loop-Fortsetzung
  return { kind: "ambiguous", scopes: rows };                          // → fail-closed (siehe 3.4)
}
```
- **Byte-identischer** Header-Vergleich (SQL `=`), keine Normalisierung, keine Fuzzy-Logik –
  dieselbe 1:1-Disziplin wie der heutige HEADER-Digest (`cli/run.mjs:346-348`).
- Additiver Index (kein Schema-Column, keine ALTER-Migration nötig; vorhandene Migrationen bleiben unberührt):
  `CREATE INDEX IF NOT EXISTS idx_scopes_checkout_header ON scopes(checkout_id, header);`

### 3.3 Neue Submit-Semantik (Agent-Pfad)

`cli/run.mjs` Submit-Zweig:
- Neues Pflicht-Flag **`--header "<Ticket 1:1>"`** für Einreichungen, die einen Scope tragen sollen.
  Fehlt `--header` UND `--scope` → fail-closed Exit 2 mit Hinweis (kein stiller unscoped Job mehr im Agent-Pfad).
- `--header` ersetzt im Agent-Pfad **vollständig** das bisherige `--scope <id>`.
  Ablauf bei Submit: Projekt-Identität verifizieren (wie heute) → `resolveScopeForCheckout(db, checkoutId, header)`
  → `new`: `createScope` + Meldung `Scope automatisch angelegt: scope-…  (Ticket = HEADER 1:1)`
  → `continue`: bestehender Scope, Meldung `Scope-Fortsetzung: scope-…` → Job an diesen Scope binden.
- `--scope <id>` **bleibt als Operator-/Diagnose-Flag** (Forensiik, Tests, Sonderfälle) – wird aber aus
  ALLEN Agent-Dokumenten, Skills, Templates und dem Onboarding entfernt (Abschnitt 5). Der Agent-Pfad
  darf es laut Invariante (Abschnitt 7) nie verwenden. **Kein stilles Entfernen der Fähigkeit** – nur
  Entkopplung vom Agent-Vertrag.
- Verhalten bei vorbestehendem Operator-Scope (per `falsify scope new` mit anderem HEADER-Text):
  Submit mit `--header` matcht nicht → legt neuen Scope an und WARNT explizit („kein aktiver Scope mit
  diesem HEADER – neuer Scope angelegt"). Kein stilles Verzweigen.

### 3.4 Fail-closed-Matrix (jeder Zweig getestet)

| Eingabe | Auflösung | Verhalten |
|---|---|---|
| `--header T`, 0 aktive Scopes mit T | `new` | Scope auto-angelegt, Job QUEUED, Header-Digest eingefroren |
| `--header T`, 1 aktiver Scope mit T | `continue` | Fortsetzung (Phase, research_additions, Anker bleiben) |
| `--header T`, ≥2 aktive Scopes mit T | `ambiguous` | Exit 2, Liste der Scopes + `falsify scope list`, KEIN Job, kein Raten |
| `--header` fehlt, kein `--scope` | – | Exit 2 „Ticket fehlt: --header \"<User-Input 1:1>\"" (kein stiller unscoped Job) |
| `--scope` aus Agent-Pfad (Skill/Doku-Test) | – | Statische Invariante schlägt an (Abschnitt 7), Doku sagt Nein |
| HEADER-Drift nach Erstellung | – | heute schon fail-closed ohne Modell-Call (`cli/run.mjs:450-459`) – unverändert |
| Identisches Ticket, alle alten Scopes terminal (hardened/done) | `new` | korrekt: abgeschlossene Aufgabe, neuer Durchlauf |

Begründung `continue`-Priorität: Ein offener (nicht terminaler) Scope mit identischem HEADER IST der
natürliche Loop-Zustand derselben Aufgabe (1 Scope = 1 Aufgabe; Phase lenkt). Terminale Zustände sind
immutabel – eine neue Einreichung derselben Worte startet deshalb bewusst frisch (kein Phantom-Reopen).

---

## 4. Vollständige Feature-Schnitte (komplette Version, kein MVP)

### Schritt A – Core-Auflösung + Submit (Code)
- `artifacts/scopes.mjs`: `resolveScopeForCheckout` (+ Kommentar „Scope-ID bestimmt AUSSCHLIESSLICH FalsifyMe").
- `artifacts/db.mjs`: additiver Index (IF NOT EXISTS, openDb-Migrationsblock, KEINE Versionsänderung nötig – prüfen).
- `cli/run.mjs`: `--header`-Parsing, Resolution vor `createJob`, Auto-Scope-Meldung, `ambiguous`-Exit,
  unscoped-Submit nur noch mit explizitem Operator-Flag (`--scope`-Pfad unverändert für Operator).
- `cli/scope.mjs`: Ausgabe bleibt (`SCOPE_ID=…` nur noch Information); kein Verhaltenszwang.
- `cli/falsify.sh`/`help.mjs`/`cli/run.mjs usage`: neue Oberfläche (Ticket statt Scope-ID).

**DONE-Kriterium:** Unit-Tests für die komplette Fail-closed-Matrix (3.4) isoliert grün; bestehende
Scope-/Submit-Tests unverändert grün (Regression); kein Verdict-Pfad berührt.

### Schritt B – Agent-Oberfläche (Skills, Templates, Onboarding)
- `skills/agent-skill-falsify.sh/.mjs/.ps1`: `--scope`-Zwang entfällt; Loop-Protokoll = gleiches
  `--header "<Ticket 1:1>"` bei jeder Iteration; kein `SCOPE_ID=`-Parsing mehr nötig (bleibt nur noch
  als Info-Zeile toleriert, nie benötigt). Erste Iteration identisch zur Fortsetzung (ein Pfad!).
- `skills/falsifyme.md`, `skills/falsifyme-falsiflow.md`: Protokolltext auf Ticket-Sprache umgestellt
  (Agent schreibt Job; FalsifyMe bestimmt Scope; RESEARCH = Daten liefern; WRITE → Prüfauftrag →
  Prüfergebnis zurück = Fortsetzung desselben Tickets).
- `cli/bootstrap/templates/{bash.sh,generic.md,agents-codebuff.md}`, `cli/onboard/steps.mjs`: `--header`
- statt `--scope`; Erklärtext „die Scope-ID bestimmt FalsifyMe – du lieferst nur das Ticket 1:1".
- `cli/bootstrap/instructions.mjs` (Modus-/Instruction-Texte): Ticket-Protokoll spiegeln.

**DONE-Kriterium:** Kein Vorkommen von `--scope` mehr in Agent-Pfad-Dateien (statische Suche),
Doku konsistent, Onboarding-Erklärung ohne ID-Buchhaltung.

### Schritt C – Sichtbarkeit im Dock (User Experience, „ALLES SICHTBAR")
- FM-EVT-Vertrag erweitert (nur Spiegelung, CON-004: UI besitzt keine Zustandswahrheit):
  - `scope_auto`-Event: `{ outcome: "new"|"continue"|"ambiguous", scope_id, header_kurz }` –
    das Dock zeigt sichtbar „Scope automatisch bestimmt → scope-…" statt einer Job-ID ohne Kontext.
  - Prüfauftrag klar ausgewiesen: beim `WRITE_AUTHORIZED`/Handoff-Zustand zeigt das Dock
    „Prüfauftrag an externen Agenten (Ticket + Falsifikation)" und beim `RE_REVIEW_RUNNING`
    „Prüfergebnis zurück → Re-Review".
- Submit-/Status-Kopfzeilen (CLI) nennen Ticket + Scope in EINER Zeile, damit der Nutzer die
  automatische Zuordnung im Fenster sieht.

**DONE-Kriterium:** Sichtbarer E2E-Beweis (Abschnitt 6), nicht headless.

### Schritt D – Doku („Doku ist Vertrag")
- `README.md`: Workflow-Abschnitt umschreiben – Agent-Ticket statt Scope-ID-Handling; der
  „Komplette Workflow"-Abschnitt aus 2026-09-03 wird auf die Ticket-Sprache angehoben.
- `WIRING.md`: §6-Kette + Modul-Referenz `resolveScopeForCheckout`; §16 Notiz „Scope-ID wird nie vom
  Agent gewählt"; neue Invariante in §0-Liste.
- `AGENTS.md` (User-Workflow-Vorgaben + Session-Learnings): Bullet „Scope-Zuordnung ist FalsifyMe-Sache –
  Agent liefert nur das Ticket (HEADER 1:1); `--scope` ist Operator-Flag, kein Agent-Vertrag."
- `ui/PLAN.md`: Tasks **UI-127 (Auto-Scope-Resolution)**, **UI-128 (Dock: Prüfauftrag sichtbar)**,
  **UI-129 (Ticket-Sprache in Skills/Doku)** – Eintrag NACH Gate-Entscheid, Status PLAN.

**DONE-Kriterium:** README/WIRING/AGENTS/AGENT-SKILL-README widersprechen sich an keiner Stelle
(Ticket-Protokoll überall), ui/PLAN führt die Tasks.

### Schritt E – Tests & Invarianten (laufen NACH der E2E-Session des Nutzers)
- `tests/invariants.test.mjs` (statischer Scan, qualifier-aware): **Skills/Templates/Onboarding-Dateien
  dürfen `--scope` im Agent-Aufrufpfad nicht mehr enthalten** (analog zum bestehenden
  jobDone-Writer-Scan; Ausnahme: Operator-/Doku-Kontext explizit markiert).
- `tests/queue.test.mjs` / neuer `tests/scopebinding.test.mjs`: komplette Fail-closed-Matrix (3.4)
  im isolierten mkdtemp-Muster (Fixture-Runner, kein Live-Key, kein Dock).
- Regression: bestehende Submit-Tests, die `--scope` nutzen, werden auf `--header` umgestellt oder
  explizit als Operator-Fall markiert – Zahl der Testfälle steigt, nichts wird still entfernt.

---

## 5. CLI-/Agent-Protokoll nach dem Feature (Zielbild)

```text
# Agent (jede Iteration identisch – ein Pfad, keine IDs):
falsify submit --header "<User-Request 1:1 / Ticket>" \
               --plan-file plan.txt --root <projekt> --files "a.js,b.js" \
               [--agent-intent "..."] [--diff-file d.patch]

# FalsifyMe antwortet sichtbar:
#   Scope automatisch bestimmt: scope-… (neu angelegt) | Fortsetzung
#   JOB_ID=…  ·  Verdict folgt im Fenster (wait)  →  PLAN | RESEARCH | WRITE
#
# WRITE → Prüfauftrag (Brief enthält Ticket + Plan + Falsifikations-Ergebnis)
# → externer Agent arbeitet → handoff complete → Prüfergebnis zurück →
# Re-Review (gleiches Ticket, FalsifyMe setzt Fortsetzung selbst).
```

Der Agent „entscheidet" damit nirgends eine ID – sein einziger Input ist das Ticket (User-Input 1:1,
der Vertragsanker der Falsifikation). Operator-Diagnose (`falsify scope list|show|trace`, `--scope`)
bleibt unangetastet für Menschen.

---

## 6. Abnahme: Sichtbarer E2E (Definition of Done des Nutzers)

EIN voller, sichtbarer Lauf auf der **installierten** FalsifyMe-Instanz (nie Worktree):
1. Nutzer gibt Ticket im Agenten ein; Agent ruft `falsify submit --header "<Ticket>" --plan-file …`.
2. **Sichtbar im Dock:** „Scope automatisch angelegt/fortgesetzt: scope-…", Job läuft, Thinker arbeitet.
3. RESEARCH-Runde sichtbar: FalsifyMe fordert Daten an → Agent liefert Dateien → automatischer
   Whitelist-Merge wird gemeldet → erneute Einreichung (gleiches Ticket, KEINE Scope-ID).
4. Evil-Twin-Probe-Exekution sichtbar (Zustand VERIFYING), Verdict im Fenster.
5. WRITE → „Prüfauftrag an externen Agenten" sichtbar → Agent (extern) implementiert mit dem Brief
   (Ticket + Falsifikation) → `falsify handoff complete` → Re-Review sichtbar → Scope done/hardened.
6. Gegenprobe (negativ): zweites identisches Ticket bei offenem Scope → continue (kein Duplikat);
   mutwillig `--scope` im Agent-Skript → statische Invariante schlägt an.
Nur dieser sichtbare Lauf zählt als UX-Beweis („Niemals headless", AGENTS/README/WIRING).

---

## 7. Harte Regeln & Grenzen (unverhandelbar)

- **Keine stillen Änderungen:** Jede Verhaltens-Änderung aus Abschnitt 4 steht in diesem Plan und
  bekommt einen DONE-Eintrag; was nicht hier steht, wird nicht gebaut.
- **Kein neuer Verdict-/Queue-/Write-Pfad:** Auflösung ist reine Scope-Bindung VOR `createJob` –
  eine Queue, eine Falsifikationspipeline, ein persistierter Verdict-Pfad (Regel 3/Architektur).
- **Shared API Key / Idle-Modell-Wechsel: unangetastet** (by design, kein Code-Touch in
  `core/ratelimit.mjs`, `core/config.mjs` Provider-Auswahl).
- **Verdict-Hoheit:** Neue Logik liefert Kontext/Zuordnung, nie ein Verdict; WRITE bleibt ausschließlich
  im bestehenden Gate (`core/probes.mjs` → Twin → `jobDone`).
- **Fail-closed:** `ambiguous`/fehlendes Ticket → Exit 2, kein Job, kein Raten; Terminalzustände immutabel.
- **Doku ist Vertrag:** README/WIRING/AGENTS/AGENT-SKILL-README/ui/PLAN werden im selben Paket
  mitgezogen; ui/PLAN-Eintrag erst nach Gate-Entscheid.
- **Kollisions-Schutz:** Im anderen Checkout liegen uncommittete `doki`-/Skill-Änderungen
  (`.planning/falsify-skill-workflow-plan.md` dort). Diese Datei fasst **hier** nichts an; Skill-Schritt B
  wird erst nach Abgleich mit jenem Stand ausgeführt, falls der Nutzer beide Stränge zusammenführt.
- **Runtime-Respekt:** Solange die Nutzer-E2E läuft: keine Tests, keine Worker/Dock-Befehle aus diesem
  Worktree. Abnahme erst nach Freigabe.
- **Kein Push** ohne ausdrückliches Wort des Nutzers.

---

## 8. Risiken / offene Punkte (ehrlich)

1. **Doppel-Ticket bei parallelen offenen Scopes** (3.4 `ambiguous`): selten, aber der fail-closed-Pfad
   verlangt dann eine explizite Operator-Entscheidung – dokumentieren, kein Automatismus.
2. **Test-Umstellung:** bestehende Tests/E2E-Fixtures, die `--scope` nutzen, müssen benannt auf
   `--header` oder Operator-Fall umgestellt werden – Teil von Schritt E, nicht still.
3. **`header` als Identität bei langen Tickets:** byte-identischer Vergleich ist hart, aber korrekt
   (1:1-Disziplin); Tippfehler = neuer Scope (Warnung sichtbar) – bewusst, kein Levenshtein.
4. **Sync mit dem anderen Checkout** (doki/Skill-Strang): Schritt B kann erst nach Klärung der
   Zuständigkeit laufen, damit keine doppelte Skill-Konsolidierung entsteht.

---

## CHANGE_GATE_10X (Plan-Dokument)

```text
A1: JA – Scope: Plan-Dokument nur für Auto-Scope + Ticket-Workflow; keine ungeplanten Dateien/Verhalten.
     Test: diese Datei (.planning/2026-09-03-…), kein weiterer Diff.
A2: JA – Architektur unverändert: eine Queue/ein Verdict-Pfad; Auflösung ist Scope-Bindung VOR createJob.
     Test: Abschnitt 7; keine Berührung von jobs.mjs-Verhalten/loops/handoff-Gate.
A3: JA – Verdict-Hoheit unangetastet; neue Logik liefert nur Zuordnung/Kontext (3.2/3.3).
     Test: Schritt A definiert keine Verdict-Änderung; WRITE bleibt im bestehenden Gate.
A4: JA – Keine Evidenz-Behauptung neu; Trennung Ticket (User-Input 1:1) vs. Falsifikation bleibt.
     Test: Abschnitt 3.1/5.
A5: JA – Jede Datei:Zeile-Referenz gegen den Worktree verifiziert (Abschnitt 2, alle Belege gelesen).
     Test: grep/sed-Belege oben; keine Fantasie-Pfade.
A6: JA – Fail-closed-Matrix vollständig (3.4): ambiguous/fehlendes Ticket → Exit 2, kein Job, kein Raten.
     Test: Matrix ist Teil von Schritt E als Testfall-Liste.
A7: JA – Twin-Isolation unberührt; Prüfauftrag nutzt den bestehenden renderCoderBrief (Kontext-getrennt).
     Test: core/handoff.mjs:145-175 unverändert referenziert.
A8: JA – Fehlerpfade benannt: Operator-Scope-Mismatch warnt, Duplikat fail-closed, HEADER-Drift bestehend.
     Test: 3.4-Zeilen.
A9: JA – Ausführbarer Beleg geplant: sichtbarer E2E (Abschnitt 6) + Matrix-Tests; Dokument selbst
     läuft keine Runtime (E2E-Respekt).
     Test: Abschnitt 6 als Abnahme-Skript.
A10: JA – Ein literalistischer Agent kann die Bindung nicht mehr wählen: `--scope` aus Agent-Pfad
     entfernt + statische Invariante (Schritt E); Operator-Flag bleibt für Menschen.
     Test: invariants-Scan „kein --scope im Agent-Aufrufpfad".
```

## FALSIFICATION_RECORD_10X (Plan-Dokument)

```text
F1: User-Agent-Behauptung: „Scope-ID MUSS FalsifyMe automatisch bestimmen, Agent darf nicht selbst
    entscheiden" + Ticket-Fluss (Agent schreibt Job → Daten-Anforderung → Twin → BEIDES als
    Prüfauftrag extern → Prüfergebnisse zurück). Betroffen: Scope-Bindung im Submit-/Loop-Pfad.
F2: User-Contract: obige Behauptung; Rahmen: sichtbare E2E, kein Worktree-Lauf, keine stillen
    Änderungen, Shared Key/Idle-Modell unangetastet, komplette Version.
F3: Scope-Match: Plan deckt exakt die Bindungslücke (--scope im Agent-Pfad, 5 Datei-Belege in §2);
    Pipeline-Schritte 3–6 als vorhanden verifiziert und explizit als „bleibt" markiert.
F4: Falsifizierbare Annahme: „Eine Header-Identität (checkout_id, header) ist deterministisch genug,
    um Fortsetzung vs. Neuanlage ohne Agent-ID zu trennen."
F5: Angriff: Duplikat-Header bei offenem Scope; Tippfehler-Header; unscoped Submit ohne Ticket;
    Agent, der --scope trotzdem nutzt.
F6: Evidence: cli/run.mjs:358-367 (scopeId-Bindung), 346-357 (Digest), skills/*:--scope-Belege,
    artifacts/scopes.mjs:20-28, db.mjs:109-124 (kein Header-Index), core/handoff.mjs:145-175
    (Prüfauftrag-Inhalt existiert), artifacts/handoff.mjs:40+ (Rückweg).
F7: Counterevidence: gesucht – ein bestehender Header-Lookup oder Auto-Scope-Mechanismus (keiner
    gefunden); ein Grund, --scope im Agent-Pfad zu behalten (keiner – Operator-Flag bleibt);
    ein Pipeline-Schritt des Auftrags ohne Existenz (keiner – 3–6 existieren).
F8: Unexamined: Verhalten von `falsify scope new`-Power-Usern nach Umstellung (Doku-Pfad, Schritt D);
    Sync-Strategie mit dem doki/Skill-Checkout (Abschnitt 8.4); exakte TUI-Rendering-Details (Schritt C).
F9: Residual Risk: Doppel-Ticket-Mehrdeutigkeit braucht Operator-Eingriff; Test-Umstellungsaufwand in
    bestehenden Fixtures; Zuständigkeitsüberschneidung Skill-Konsolidierung mit anderem Checkout.
F10: Release-Entscheidung: KEIN WRITE für Code – dies ist der Plan zur Freigabe durch das
    Entwickler-Gate des Nutzers; Code folgt erst nach Gate (dann CHANGE_GATE/FALSIFICATION_RECORD
    für die Umsetzung mit sichtbarem E2E-Beleg).
```
