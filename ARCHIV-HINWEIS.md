# Archiv-Hinweis — Falsify_ME (lokaler Quell-Worktree)

**Stand: 2026-09-03 · Dieser Ordner ist ein ARCHIV, kein aktives Projekt-Root.**

## Was ist das?

Quell-Repository von **FalsifyMe 0.9.0** (GitHub: `vannon091118/Falsify_Me`,
Remote `origin` in `.git/config`). Enthält den kompletten Quellstand inkl.
uncommitteter Änderungen (ca. 47 modifizierte Dateien, Stand Archivierung —
unverändert erhalten).

## Warum archiviert?

Am 2026-09-03 wurde die lokale FalsifyMe-Installation vollständig entfernt
(`node uninstall.mjs`):

- `~/.Falsify_Core` (Programm-Kopie) — entfernt
- `~/.Falsify_Private` (FALSIFY_HOME: SQLite, Logs, config) — entfernt
- Agent-Skills `~/.agents/skills/falsifyme*` — entfernt
- Desktop-Icons `FalsifyMe*.lnk` — entfernt
- PATH-/Marker-Zeilen in `~/.bashrc` / `~/.bash_profile` — entfernt

Der Ordner wurde aus dem Desktop-Root ins Archiv
(`Dev archive und Projekte\Falsify_ME`) verschoben, damit Agents ihn **nicht
versehentlich als Projekt-Root erkennen** und dort FalsifyMe-Workflows
anstoßen. Er bleibt vollständig erhalten und nutzbar.

## API-Keys

Nicht gelöscht, liegen gesichert unter:

- `~/.Falsify.env.uninstall-backup` (aktueller NVIDIA-Key)
- `~/.Falsify.env.uninstall-backup.legacy-home` (älterer NVIDIA-Key,
  anderer Fingerabdruck)
- `~/.Falsify.env.bak` (leer, Vorlage)

## AGENTS.md — gilt weiterhin (bewusst NICHT entfernt)

`AGENTS.md` im Root bleibt unangetastet und wird bei einem frischen
GitHub-Clone ohnehin mitgeliefert. **Agent-Auto-Load muss funktionieren:**

- Sagt der Nutzer **„INSTALLIER BITTE https://github.com/vannon091118/Falsify_Me"**,
  folgt der Agent der AGENTS.md: Installation → zwingende Reichweiten-/Modus-
  Entscheidung mit dem Nutzer (Hybrid: User + Agent) → Terminal/Dock →
  Aufgabe festlegen (Job 1).
- **Nicht** auf diesem archivierten Ordner selbst FalsifyMe-Aufgaben
  ausführen (Selbstprüfung/Jobs). Quelle für Neuinstallation ist der
  GitHub-Clone oder ein Zurückverschieben dieses Ordners.

## Reaktivierung

`mv` zurück an einen Arbeitsort (z. B. Desktop) genügt — Git-Repo, Remote
und Inhalt sind intakt. Alternativ frisch von GitHub klonen.
