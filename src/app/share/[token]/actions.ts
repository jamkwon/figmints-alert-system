"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findShareLink } from "@/lib/data";
import {
  LOCK_MINUTES,
  SHARE_COOKIE,
  SHARE_COOKIE_DAYS,
  afterFailedAttempt,
  sharePath,
  unlockValue,
  verifySharePassword,
} from "@/lib/share-links";
import { getSupabase } from "@/lib/supabase/server";

// The one action a client can call without a staff login: entering a report
// link's password. It only ever unlocks that link, on this device.

export interface UnlockState {
  message?: string;
}

const MAX_INPUT = 100;

export async function unlockShareAction(token: string, _prev: UnlockState, formData: FormData): Promise<UnlockState> {
  const link = await findShareLink(token);
  // Same answer for unknown, revoked and wrong: nothing to learn from trying links.
  if (!link) return { message: "That password isn’t right." };
  if (link.locked_until && Date.parse(link.locked_until) > Date.now()) {
    return { message: `Too many tries. Try again in ${LOCK_MINUTES} minutes.` };
  }
  const raw = formData.get("password");
  const password = typeof raw === "string" ? raw.slice(0, MAX_INPUT) : "";
  const db = getSupabase();
  if (!(await verifySharePassword(password, link.password_hash))) {
    const next = afterFailedAttempt(link.failed_attempts, new Date());
    await db.from("client_share_links").update(next).eq("id", link.id);
    return { message: next.locked_until ? `Too many tries. Try again in ${LOCK_MINUTES} minutes.` : "That password isn’t right." };
  }
  if (link.failed_attempts > 0) await db.from("client_share_links").update({ failed_attempts: 0 }).eq("id", link.id);
  (await cookies()).set(SHARE_COOKIE, unlockValue(token, link.password_hash), {
    path: sharePath(token),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SHARE_COOKIE_DAYS * 86_400,
  });
  redirect(sharePath(token));
}
