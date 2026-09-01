// ─────────────────────────────────────────────────────────────────────────────
// FalsifyMe 2.0 · cli/onboard/prompts.mjs – echter Dialog mit dem Nutzer
// -----------------------------------------------------------------------------
// FALSIFYME redet hier DIREKT mit dem Nutzer (interaktiver Wizard):
//   • ask(...)       – Freitext-Frage mit optionalem Default
//   • askSecret(...) – API-Key-Eingabe mit Maskierung (jeder Tastendruck = *)
//   • confirm(...)   – Ja/Nein-Frage
//   • close()        – readline-Interface schließen
// Modular/injizierbar: Tests übergeben einen Fake-Prompter (kein echtes TTY
// nötig). Bei fehlendem TTY verweigert der Einstiegspunkt ehrlich statt still
// zu hängen (siehe steps.mjs / onboard.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import readline from "node:readline";

function defaultPrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let muted = false;

  const maskify = (str) => (muted ? "*".repeat(str.length) : str);

  if (rl._writeToOutput) {
    const orig = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (str) => orig(maskify(String(str)));
  }

  const ask = (question, { defaultValue } = {}) =>
    new Promise((resolve) => {
      const suffix = defaultValue !== undefined ? ` [${defaultValue}]` : "";
      rl.question(`${question}${suffix} `, (answer) => {
        const a = answer.trim();
        resolve(a || (defaultValue ?? ""));
      });
    });

  const askSecret = (question) =>
    new Promise((resolve) => {
      muted = true;
      rl.question(`${question} (Eingabe wird maskiert) `, (answer) => {
        muted = false;
        resolve(answer); // NICHT trimmen: Keys können Sonderzeichen enthalten
      });
    });

  const confirm = (question, { defaultValue = false } = {}) =>
    new Promise((resolve) => {
      const hint = defaultValue ? "j/N" : "j/n";
      rl.question(`${question} (${hint}) `, (answer) => {
        const a = answer.trim().toLowerCase();
        if (["j", "ja", "y", "yes"].includes(a)) return resolve(true);
        if (["n", "nein", "no", "n"].includes(a)) return resolve(false);
        resolve(defaultValue);
      });
    });

  const close = () => rl.close();

  return { ask, askSecret, confirm, close };
}

// Objekt mit denselben Methoden, aber lesbaren Dummies (für Tests / --dry-run).
// Verhält sich wie der echte Prompter: leere Antwort -> defaultValue.
// answers.askValue / secretValue / confirmValue können auch Arrays sein
// (sequentielle Antworten pro Aufruf) oder Funktionen (question, opts) => value.
export function fakePrompter(answers = {}) {
  const store = {};
  const seq = { ask: 0, secret: 0, confirm: 0 };
  const next = (kind, question, opts, fallback = "") => {
    const cfg = answers[`${kind}Value`];
    let value = "";
    if (Array.isArray(cfg)) value = cfg[seq[kind]] ?? opts?.defaultValue ?? fallback;
    else if (typeof cfg === "function") value = cfg(question, opts);
    else value = cfg ?? opts?.defaultValue ?? fallback;
    store[`${seq[kind]}|${kind}`] = question;
    seq[kind] += 1;
    return value;
  };
  const ask = async (question, opts) => next("ask", question, opts, "");
  const askSecret = async (question, opts) => next("secret", question, opts, "");
  const confirm = async (question, opts) => next("confirm", question, opts, opts?.defaultValue ?? false);
  const close = () => {};
  return { ask, askSecret, confirm, close, store };
}

export { defaultPrompter };