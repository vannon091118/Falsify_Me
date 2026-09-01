// Bootstrap-Modul: Agent-Detektion (pure, ohne I/O)
// Wichtig: CODEBUFF_HOME/FREEBUFF_SESSION werden als echte Env-Marker geprueft;
// fuer nicht erkannte Agenten gilt das generische Format (keine erfundenen
// Agenten-Konventionen).

export function detectAgent(env = process.env, platform = process.platform) {
  if (env.CODEBUFF_HOME || env.FREEBUFF_SESSION) {
    return { type: "codebuff", format: "md", label: "Codebuff/Freebuff" };
  }
  if (typeof env.SHELL === "string" && env.SHELL.includes("bash")) {
    return { type: "bash", format: "sh", label: "Bash-Agent" };
  }
  if (platform === "win32" && env.PSModulePath) {
    return { type: "powershell", format: "ps1", label: "PowerShell-Agent" };
  }
  return { type: "generic", format: "md", label: "Generischer Agent" };
}
