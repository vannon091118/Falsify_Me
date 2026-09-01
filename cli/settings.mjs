#!/usr/bin/env node
import { fetchAvailableModels, getRuntimeSettings, updateRuntimeSettings } from "../core/settings.mjs";

const mask = (value) => value ? "********" : "nicht gesetzt";

export async function runSettings(args = []) {
  const action = args[0] || "show";
  if (action === "show") {
    const settings = getRuntimeSettings();
    console.log(JSON.stringify({ ...settings, apiKey: mask(settings.keyConfigured) }, null, 2));
    return;
  }
  if (action !== "set") throw new Error("Verwendung: falsify settings show | falsify settings set key=value …");
  const patch = {};
  for (const raw of args.slice(1)) {
    const index = raw.indexOf("=");
    if (index <= 0) throw new Error(`Einstellung muss key=value sein: ${raw}`);
    const key = raw.slice(0, index);
    const value = raw.slice(index + 1);
    patch[key] = value;
  }
  const result = updateRuntimeSettings(patch);
  console.log(JSON.stringify({ ...result, apiKey: mask(result.keyConfigured) }, null, 2));
}

export async function runModels(args = []) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--api-base") options.apiBase = args[++i];
    else if (args[i] === "--api-key") options.apiKey = args[++i];
    else throw new Error(`Unbekannte models-Option: ${args[i]}`);
  }
  const models = await fetchAvailableModels(options);
  console.log(JSON.stringify(models, null, 2));
}
