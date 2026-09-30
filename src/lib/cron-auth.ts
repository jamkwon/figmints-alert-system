import "server-only";
import { timingSafeEqual } from "node:crypto";

// Scheduled endpoints require `Authorization: Bearer <CRON_SECRET>`.
export const MIN_SECRET_LENGTH = 16;

export function isCronSecretSet(): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && secret.length >= MIN_SECRET_LENGTH;
}

export function isCronAuthorized(request: Request): boolean {
  if (!isCronSecretSet()) return false;
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
