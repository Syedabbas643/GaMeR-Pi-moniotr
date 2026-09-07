const path = require("path");

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const PORT = numberFromEnv("PORT", 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const COMMAND_TIMEOUT_MS = numberFromEnv("COMMAND_TIMEOUT_MS", 2000);
const PUBLIC_IP_TIMEOUT_MS = numberFromEnv("PUBLIC_IP_TIMEOUT_MS", 3000);
const TRANSMISSION_URL = process.env.TRANSMISSION_URL || "";
const TRANSMISSION_USERNAME = process.env.TRANSMISSION_USERNAME || "";
const TRANSMISSION_PASSWORD = process.env.TRANSMISSION_PASSWORD || "";
const TRANSMISSION_TIMEOUT_MS = numberFromEnv("TRANSMISSION_TIMEOUT_MS", 3000);
const MEMORY_WARN_PERCENT = numberFromEnv("MEMORY_WARN_PERCENT", 80);
const MEMORY_CRIT_PERCENT = numberFromEnv("MEMORY_CRIT_PERCENT", 90);
const DISK_WARN_PERCENT = numberFromEnv("DISK_WARN_PERCENT", 80);
const DISK_CRIT_PERCENT = numberFromEnv("DISK_CRIT_PERCENT", 90);
const METRICS_INTERVAL_MS = numberFromEnv("METRICS_INTERVAL_MS", 10000);
const DEBUG_STATS = String(process.env.DEBUG_STATS || "").toLowerCase() === "true" || String(process.env.DEBUG_STATS || "") === "1";
const DISABLE_SQLITE = String(process.env.DISABLE_SQLITE || "").toLowerCase() === "true" || String(process.env.DISABLE_SQLITE || "") === "1";

module.exports = {
  COMMAND_TIMEOUT_MS,
  NODE_ENV,
  PORT,
  PUBLIC_DIR,
  PUBLIC_IP_TIMEOUT_MS,
  TRANSMISSION_URL,
  TRANSMISSION_USERNAME,
  TRANSMISSION_PASSWORD,
  TRANSMISSION_TIMEOUT_MS,
  MEMORY_WARN_PERCENT,
  MEMORY_CRIT_PERCENT,
  DISK_WARN_PERCENT,
  DISK_CRIT_PERCENT,
  METRICS_INTERVAL_MS,
  DEBUG_STATS,
  DISABLE_SQLITE,
};
