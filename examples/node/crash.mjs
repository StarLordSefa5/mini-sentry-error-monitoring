// Usage: node examples/node/crash.mjs <DSN> [rejection]
import * as MiniSentry from "../../packages/sdk/dist/node.js";

const [dsn, mode] = process.argv.slice(2);
if (!dsn) {
  console.error("Usage: node examples/node/crash.mjs <DSN> [rejection]");
  process.exit(2);
}

MiniSentry.init({ dsn, release: "example@1.0.0" });

function loadConfig() {
  throw new RangeError("Config value out of range: maxConnections=-1");
}

if (mode === "rejection") {
  Promise.reject(new Error("Database connection refused"));
} else {
  setTimeout(loadConfig, 10);
}
