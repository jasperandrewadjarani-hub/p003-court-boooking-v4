import "server-only";
import { randomUUID } from "crypto";
import type { Prisma } from "@/generated/prisma/client";

// Same pattern as src/lib/email/transport.ts: SUPABASE_STORAGE_URL/
// SUPABASE_SERVICE_ROLE_KEY don't exist in .env.local yet, so uploads fall
// back to storing the bytes directly in Postgres (Receipt.data, bytea) —
// works today at $0, no new account needed. Real Supabase Storage is a
// drop-in swap later: same function signature, objectKey becomes a real
// Storage path instead of "local:<uuid>", Receipt.data stays null.

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024; // 5MB, matches v2
export const ALLOWED_RECEIPT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

export interface StoredReceipt {
  objectKey: string;
  data: Buffer | null;
}

function getStorageMode(): "local" | "supabase" {
  return process.env.SUPABASE_STORAGE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "local";
}

/** Validates and stores a receipt upload. Throws on size/MIME violations —
 * always re-validate server-side, never trust the client's own checks. */
export async function storeReceipt(bytes: Buffer, mimeType: string): Promise<StoredReceipt> {
  if (bytes.length > MAX_RECEIPT_BYTES) {
    throw new Error(`Receipt file is too large — max ${MAX_RECEIPT_BYTES / 1024 / 1024}MB.`);
  }
  if (!ALLOWED_RECEIPT_MIME_TYPES.includes(mimeType)) {
    throw new Error("Receipt must be an image (JPEG/PNG/WebP/GIF) or a PDF.");
  }

  if (getStorageMode() === "supabase") {
    // Phase F: real Supabase Storage upload once credentials exist.
    throw new Error("Supabase Storage isn't configured yet — SUPABASE_STORAGE_URL/SUPABASE_SERVICE_ROLE_KEY are unset.");
  }

  return { objectKey: `local:${randomUUID()}`, data: bytes };
}

/** Reads back a stored receipt's bytes — used by the serving route handler. */
export async function readReceiptData(tx: Prisma.TransactionClient, receiptId: string): Promise<{ data: Buffer; mimeType: string } | null> {
  const row = await tx.receipt.findUnique({ where: { id: receiptId }, select: { data: true, mimeType: true, objectKey: true } });
  if (!row || !row.objectKey.startsWith("local:") || !row.data) return null;
  return { data: Buffer.from(row.data), mimeType: row.mimeType };
}
