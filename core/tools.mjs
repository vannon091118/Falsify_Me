// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · core/tools.mjs – sandboxed Agent-Tools (GEHÄRTET)
// -----------------------------------------------------------------------------
// list_dir / read_file / glob, hart auf das Arbeitsverzeichnis + Whitelist
// beschränkt. SICHERHEITSVERTRAG (regressionstest in tests/security.test.mjs):
//   1. SYMLINK-SCHUTZ: Root UND Zielpfad werden mit realpathSync aufgelöst –
//      ein Symlink aus dem Root nach außen wird BLOCKIERT (kein lexikalischer
//      Bypass über path.resolve möglich).
//   2. WHITELIST: read_file und glob beachten die Whitelist; list_dir zeigt
//      NUR freigegebene Pfade (Regel 4/UI-100): Whitelist-Dateien selbst +
//      Unterordner, die Vorfahr einer erlaubten Datei sind. Namen NICHT
//      freigegebener Daten (Dateien wie "secret.db", fremde Ordner) sind
//      unsichtbar – nur der minimale Baum, der den Zugriff trägt.
//   3. READ-ONLY: keine Schreib-APIs in diesem Modul.
// Reine Funktion: makeTools(ROOT, whitelist).
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";

const TOOLS = [
  { type: "function", function: { name: "list_dir", description: "Listet Dateien und Unterordner relativ zum Arbeitsverzeichnis – NUR freigegebene Pfade: Whitelist-Dateien und Ordnervorfahren freigegebener Dateien; nicht freigegebene Namen sind unsichtbar (Regel 4).", parameters: { type: "object", properties: { path: { type: "string", description: "Verzeichnispfad relativ zum Arbeitsverzeichnis (z. B. \".\" oder \"src\")" } }, required: ["path"] } } },
  { type: "function", function: { name: "read_file", description: "Liest eine Datei relativ zum Arbeitsverzeichnis (UTF-8, max. 200 KB). Nur Dateien aus der Zugriffs-Whitelist.", parameters: { type: "object", properties: { path: { type: "string", description: "Dateipfad relativ zum Arbeitsverzeichnis" } }, required: ["path"] } } },
  { type: "function", function: { name: "glob", description: "Findet erlaubte Dateien per Glob-Muster (z. B. \"**/*.js\") relativ zum Arbeitsverzeichnis.", parameters: { type: "object", properties: { pattern: { type: "string", description: "Glob-Muster relativ zum Arbeitsverzeichnis" } }, required: ["pattern"] } } },
];

function globToRegex(pattern) {
  // '**/' matcht AUCH null Verzeichnisse (Root-Dateien), '**' alle, '*' ohne '/', '?' ein Zeichen.
  let rx = "^";
  const chars = [...pattern];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === "*") {
      if (chars[i + 1] === "*") {
        i++;                                  // beide '*' verbrauchen
        if (chars[i + 1] === "/") { i++; rx += "(?:.*/)?"; }   // '**/' -> null oder mehr Verzeichnisse
        else rx += ".*";                     // nacktes '**' -> alles
      } else {
        rx += "[^/]*";
      }
    } else if (c === "?") rx += "[^/]";
    else rx += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(rx + "$");
}

export function makeTools(ROOT, FILE_WHITELIST = []) {
  // Root-Echtadresse EINMAL auflösen (Symlinks im Root-Pfad selbst aufgelöst).
  const ROOT_REAL = fs.realpathSync(ROOT);

  function checkWhitelist(relPosix) {
    if (!FILE_WHITELIST.length) return;
    const ok = FILE_WHITELIST.some((w) => {
      const wp = w.replace(/\\/g, "/");
      return relPosix === wp || relPosix.startsWith(wp + "/");
    });
    if (!ok) throw new Error(`Datei nicht in der Zugriffs-Whitelist: ${relPosix}`);
  }

  /** Pfad auflösen + REALPATH-prüfen (Symlink-Escape blockiert). */
  function resolveInRoot(p, { mustExist = false } = {}) {
    const t = path.resolve(ROOT, p || ".");
    if (t !== ROOT && !t.startsWith(ROOT + path.sep)) {
      throw new Error(`Zugriff außerhalb des Arbeitsverzeichnisses verweigert: ${p}`);
    }
    // Symlink-Kette auflösen: das reale Ziel muss weiterhin im REAL-Root liegen.
    if (mustExist) {
      if (!fs.existsSync(t)) throw new Error(`Nicht gefunden: ${p}`);
      const real = fs.realpathSync(t);
      if (real !== ROOT_REAL && !real.startsWith(ROOT_REAL + path.sep)) {
        throw new Error(`Symlink-Ziel außerhalb des Arbeitsverzeichnisses verweigert: ${p}`);
      }
      return { t, real };
    }
    // Existiert der Pfad, ebenfalls realpath-prüfen; sonst lexikalisch OK.
    if (fs.existsSync(t)) {
      const real = fs.realpathSync(t);
      if (real !== ROOT_REAL && !real.startsWith(ROOT_REAL + path.sep)) {
        throw new Error(`Symlink-Ziel außerhalb des Arbeitsverzeichnisses verweigert: ${p}`);
      }
    }
    return { t, real: t };
  }

  function execTool(name, args) {
    switch (name) {
      case "list_dir": {
        const { t, real } = resolveInRoot(args.path || ".", { mustExist: true });
        if (!fs.statSync(real).isDirectory()) throw new Error(`Kein Verzeichnis: ${args.path}`);
        const relDir = path.relative(ROOT_REAL, real).replace(/\\/g, "/");
        // Whitelist-Vertrag: außerhalb des Roots nur listen, wenn dort erlaubte
        // Dateien liegen; das Root selbst ist immer listen allowed.
        const wl = FILE_WHITELIST.map((w) => w.replace(/\\/g, "/"));
        // path.relative liefert fuer das Root "" (nicht ".") – beides = Root.
        const isRoot = relDir === "" || relDir === ".";
        const norm = isRoot ? "" : relDir + "/";
        if (wl.length && !isRoot) {
          const inScope = wl.some((w) => w === relDir || w.startsWith(relDir + "/"));
          if (!inScope) throw new Error(`Verzeichnis nicht in der Zugriffs-Whitelist: ${relDir}`);
        }
        const entries = fs.readdirSync(real, { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() }));
        if (wl.length) {
          // Regel 4 (UI-100): Namen NICHT freigegebener Daten sind unsichtbar.
          // Sichtbar sind nur Whitelist-Dateien selbst und Unterordner, die
          // Vorfahr (mind.) einer whitelisted Datei sind – der minimale Baum,
          // der den freigegebenen Zugriff trägt. Dateinamen wie "secret.db"
          // oder fremde Unterordner leaken nicht mehr.
          const visible = entries.filter((e) => {
            const rel = norm + e.name;
            if (e.dir) return wl.some((w) => w === rel || w.startsWith(rel + "/"));
            return wl.includes(rel);
          });
          return visible.map((e) => (e.dir ? e.name + "/" : e.name)).join("\n");
        }
        return entries.map((e) => (e.dir ? e.name + "/" : e.name)).join("\n");
      }
      case "read_file": {
        const { real } = resolveInRoot(args.path, { mustExist: true });
        if (fs.statSync(real).isDirectory()) throw new Error(`Ist ein Verzeichnis: ${args.path}`);
        checkWhitelist(path.relative(ROOT, path.resolve(ROOT, args.path)).replace(/\\/g, "/"));
        const size = fs.statSync(real).size;
        let txt = fs.readFileSync(real, "utf8");
        if (size > 200000) txt = `(Datei zu groß: ${size} B – nur die ersten 200 KB)\n` + txt.slice(0, 200000);
        return txt;
      }
      case "glob": {
        const rx = globToRegex(args.pattern || "");
        const out = [];
        const walk = (dir) => {
          if (out.length >= 100) return;
          let entries = [];
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const e of entries) {
            if (out.length >= 100) return;
            const full = path.join(dir, e.name);
            // Symlink-Härte: reale Adresse muss im REAL-Root bleiben.
            let real;
            try { real = fs.realpathSync(full); } catch { continue; }
            if (real !== ROOT_REAL && !real.startsWith(ROOT_REAL + path.sep)) continue;
            const rel = path.relative(ROOT, full).replace(/\\/g, "/");
            if (rel === ".git" || rel.startsWith(".git/") || rel === "node_modules" || rel.startsWith("node_modules/")) continue;
            if (e.isDirectory()) walk(full);
            else if (rx.test(rel)) {
              if (FILE_WHITELIST.length) {
                try { checkWhitelist(rel); } catch { continue; }
              }
              out.push(rel);
            }
          }
        };
        walk(ROOT);
        return out.length ? out.join("\n") : "(keine Treffer)";
      }
      default:
        throw new Error(`Unbekanntes Tool: ${name}`);
    }
  }
  return { TOOLS, execTool };
}
