#!/usr/bin/env bash
# FalsifyMe 2.0 – visible disposable end-to-end self-test.
# This test deliberately starts the real worker through the existing UI launcher.
set -u

_SRC="${BASH_SOURCE[0]:-$0}"
REPO_ROOT="$(cd "$(dirname "$_SRC")" >/dev/null 2>&1 && pwd)"
FILES="core/tools.mjs,cli/run.mjs,core/prompt.mjs"
WINDOW_PID=""
fail() { echo "❌ $*" >&2; exit 1; }
step() { echo ""; echo "── [$1] $2 ──"; }
T="$(mktemp -d)" || fail "Kein Temp-Verzeichnis"
TW="$(cygpath -w "$T" 2>/dev/null || printf '%s' "$T")"
WR="$(cygpath -w "$REPO_ROOT" 2>/dev/null || printf '%s' "$REPO_ROOT")"
export FALSIFY_HOME="$TW"
cleanup() { [ -n "$WINDOW_PID" ] && taskkill //PID "$WINDOW_PID" //F >/dev/null 2>&1 || true; rm -rf "$T" 2>/dev/null || true; }
trap cleanup EXIT

echo "Wegwerf-Home: $TW (kein API-Key → Fehlerpfad, kein API-Verbrauch)"
echo "Test-Gegenstand: $REPO_ROOT (eigenes Repo, read-only)"
md5sum "$REPO_ROOT/core/tools.mjs" "$REPO_ROOT/cli/run.mjs" "$REPO_ROOT/core/prompt.mjs" > "$T/before.md5" || fail "Checksummen fehlgeschlagen"

step "1/7" "Scope anlegen (PLAN = Init, HEADER 1:1)"
SID="$(bash "$REPO_ROOT/falsify" scope new "Selbsttest: komplette Kette gegen das eigene Repo" | sed -n 's/^SCOPE_ID=//p')"
[ -n "$SID" ] || fail "Scope nicht angelegt"
echo "SCOPE_ID=$SID"

step "2/7" "submit → SQLite-Queue"
printf 'Selbsttest-Iteration: Prüfe die Kette gegen die Repo-Dateien %s.\n' "$FILES" > "$T/plan.txt"
OUT="$(bash "$REPO_ROOT/falsify" submit --scope "$SID" --plan-file "$T/plan.txt" --root "$REPO_ROOT" --files "$FILES" --no-wait 2>&1)" || fail "submit fehlgeschlagen: $OUT"
JOB="$(echo "$OUT" | sed -n 's/^JOB_ID=//p' | head -1)"
[ -n "$JOB" ] || fail "Keine JOB_ID in: $OUT"
echo "JOB_ID=$JOB"

step "3/7" "Queue-Zustand vor Claim"
ST="$(bash "$REPO_ROOT/falsify" status "$JOB" | head -1)"
[ "$ST" = "QUEUED" ] || fail "Erwartet QUEUED, ist: $ST"
echo "Status: QUEUED ✅"

step "4/7" "Atomarer Claim (zweiter Worker bekommt nichts)"
CLAIM="$(cd "$REPO_ROOT" && node --input-type=module -e "
const jobs = await import('./artifacts/jobs.mjs');
const db = (await import('./artifacts/db.mjs')).openDb();
const a = jobs.claimNextJob(db, 1, '');
const b = jobs.claimNextJob(db, 2, '');
console.log('C1=' + (a ? a.id : 'keiner'));
console.log('C2=' + (b ? b.id : 'KEINER-ATOMAR'));
(await import('./artifacts/db.mjs')).closeDb();
" 2>/dev/null)"
C1="$(echo "$CLAIM" | sed -n 's/^C1=//p')"
C2="$(echo "$CLAIM" | sed -n 's/^C2=//p')"
[ "$C1" = "$JOB" ] || fail "Worker 1 hat falschen Job: $CLAIM"
[ "$C2" = "KEINER-ATOMAR" ] || fail "Worker 2 hat doch etwas bekommen: $CLAIM"
echo "Worker 1 claimt: $C1 ✅"
echo "Worker 2 claimt: nichts (atomar) ✅"

cd "$REPO_ROOT" && node --input-type=module -e "
const db = (await import('./artifacts/db.mjs')).openDb();
db.prepare(\"UPDATE jobs SET status='QUEUED', window_idx=NULL, started_at=NULL WHERE id=?\").run('$JOB');
(await import('./artifacts/db.mjs')).closeDb();
" || fail "Job konnte nicht zurückgesetzt werden"

step "5/7" "Sichtbares Produktions-Worker-Fenster starten"
if ! command -v cmd.exe >/dev/null 2>&1; then
  fail "Sichtbarer Worker-Test benötigt Windows (cmd.exe nicht gefunden)"
fi
BOOT="$T/start-visible.cmd"
printf '@echo off\r\nset "FALSIFY_HOME=%s"\r\nset "FALSIFY_WINDOW=1"\r\ncd /d "%s\\ui"\r\ncall start-dock.cmd 1\r\n' "$TW" "$WR" > "$BOOT"
BOOT_W="$(cygpath -w "$BOOT" 2>/dev/null || printf '%s' "$BOOT")"
# start.exe trennt das sichtbare Fenster vom Bash-Testprozess.
cmd.exe /c start "Falsify-Dock 1" cmd.exe /k "$BOOT_W" >/dev/null 2>&1
sleep 3
echo "Sichtbares Worker-Fenster gestartet"

step "6/7" "Worker → run.mjs → Status/Fehlerpfad (kein Key)"
ST=""
for i in $(seq 1 90); do
  ST="$(bash "$REPO_ROOT/falsify" status "$JOB" 2>/dev/null | head -1)"
  echo "  [t+${i}s] Status: $ST"
  case "$ST" in QUEUED*|RUNNING*) sleep 1 ;; *) break ;; esac
done
case "$ST" in
  "ERROR API-Key fehlt") echo "✅ Fehlerpfad sauber: ERROR, kein hängender RUNNING-Job" ;;
  *) fail "Unerwarteter Status: $ST" ;;
esac
LOG="$(bash "$REPO_ROOT/falsify" log "$JOB" | sed -n '1,12p')"
echo "$LOG" | grep -q "HEADER (1:1): Selbsttest" || fail "HEADER 1:1 fehlt im Job-Log"
echo "$LOG" | grep -q "Gestartet:" && echo "$LOG" | grep -q "Fertig:" || fail "Job-Zeiten fehlen"

step "7/7" "Read-only-Nachweis + Cleanup"
md5sum "$REPO_ROOT/core/tools.mjs" "$REPO_ROOT/cli/run.mjs" "$REPO_ROOT/core/prompt.mjs" > "$T/after.md5" || fail "Checksummen fehlgeschlagen"
diff -q "$T/before.md5" "$T/after.md5" >/dev/null || fail "Repo wurde verändert"
echo "✅ Repo-Dateien unverändert – FalsifyMe ist read-only zum Projekt"
echo "✅ SELBSTTEST BESTANDEN – CLI → Queue → sichtbares Fenster → Worker → run.mjs → ERROR"
exit 0
