import { createHash, randomBytes } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Public project key. Hex keeps it safe inside a DSN URL. */
export function generateApiKey(): string {
  return randomBytes(16).toString("hex");
}
