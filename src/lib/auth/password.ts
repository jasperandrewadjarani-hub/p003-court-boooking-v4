import { hash, verify } from "@node-rs/argon2";

// @node-rs/argon2 is a native napi-rs binary — runs fine in Vercel's Node.js
// serverless runtime (the default for Server Actions in this app already),
// but will NOT work on the Edge runtime. Never import this from proxy.ts or
// any route with `export const runtime = "edge"`.

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  return verify(hashValue, password);
}

export function validatePassword(password: string): void {
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  if (password.length > 72) throw new Error("Password must be 72 characters or fewer.");
}
