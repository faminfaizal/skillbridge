// Loads skillbridge/.env (one level above the app) into process.env without overriding existing values.
import fs from "node:fs";
import path from "node:path";

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const file = path.resolve(process.cwd(), "../.env");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function env(key: string, fallback = ""): string {
  loadEnv();
  return process.env[key] ?? fallback;
}
