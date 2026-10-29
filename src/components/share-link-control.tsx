"use client";

import { useState, useTransition, type ReactNode } from "react";
import {
  createShareLinkAction,
  resetSharePasswordAction,
  revokeShareLinkAction,
  type ShareLinkState,
} from "@/app/manage-actions";

const button =
  "rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-fig-ink hover:border-fig-plum hover:text-fig-plum disabled:cursor-not-allowed disabled:opacity-50";
const primary =
  "rounded-md border border-fig-plum bg-fig-plum px-2.5 py-1 text-xs font-medium text-white hover:bg-fig-magenta disabled:cursor-not-allowed disabled:opacity-50";

type Confirm = "replace" | "password" | "revoke";
const CONFIRM: Record<Confirm, { question: string; yes: string }> = {
  replace: { question: "Make a new link and password? The current link stops working.", yes: "Yes, replace" },
  password: { question: "Make a new password? The client has to enter it again.", yes: "Yes, new password" },
  revoke: { question: "Turn off this link? The client can't open it any more.", yes: "Yes, turn off" },
};

/**
 * A client's report link: create, copy, change the password, replace, turn off.
 * `children` describes the current link (rendered on the server).
 */
export function ShareLinkControl({
  clientId,
  path,
  baseUrl,
  disabledReason,
  children,
}: {
  clientId: string;
  /** /share/<token>, or null when there's no link. */
  path: string | null;
  /** The app's public address; this page's own when unknown. */
  baseUrl: string | null;
  disabledReason?: string;
  children?: ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ShareLinkState | null>(null);
  const [confirming, setConfirming] = useState<Confirm | null>(null);
  const [copied, setCopied] = useState<"link" | "password" | null>(null);
  const disabled = pending || Boolean(disabledReason);
  const url = path && `${(baseUrl ?? "").replace(/\/$/, "")}${path}`;

  function run(action: (id: string) => Promise<ShareLinkState>) {
    setResult(null);
    setConfirming(null);
    startTransition(async () => {
      try {
        setResult(await action(clientId));
      } catch {
        setResult({ ok: false, message: "Could not reach the server." });
      }
    });
  }

  async function copy(what: "link" | "password", text: string) {
    try {
      await navigator.clipboard.writeText(what === "link" && !baseUrl ? `${window.location.origin}${text}` : text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setResult({ ok: false, message: "Couldn't copy: select the text and copy it instead." });
    }
  }

  return (
    <div className="space-y-3 px-4 py-4 text-sm" title={disabledReason}>
      {!path ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-slate-600">
            Give the client their live report (this month so far, and the two before) at a private link with a password. No
            login needed.
          </p>
          <button type="button" disabled={disabled} onClick={() => run(createShareLinkAction)} className={primary}>
            Create link
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              aria-label="Client link"
              value={url ?? ""}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-64 flex-1 rounded-md border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-xs text-fig-ink"
            />
            <button type="button" disabled={pending} onClick={() => copy("link", baseUrl ? url! : path)} className={button}>
              {copied === "link" ? "Copied" : "Copy link"}
            </button>
            <a href={path} target="_blank" rel="noopener noreferrer" className={button}>
              Open ↗
            </a>
          </div>
          {children}
        </>
      )}

      {result?.password && (
        <div className="rounded-md border border-fig-pink-light bg-fig-plum-mist px-3 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-slate-600">Password</span>
            <code className="rounded bg-white px-2 py-1 font-mono text-base font-bold tracking-wider text-fig-plum-dark">
              {result.password}
            </code>
            <button type="button" onClick={() => copy("password", result.password!)} className={button}>
              {copied === "password" ? "Copied" : "Copy password"}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-600">
            Shown only now. Send it separately from the link (for example, the link by email and the password by text), so
            one forwarded message isn&apos;t enough to open the report.
          </p>
        </div>
      )}

      {path &&
        (confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-fig-ink">{CONFIRM[confirming].question}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                run(confirming === "replace" ? createShareLinkAction : confirming === "password" ? resetSharePasswordAction : revokeShareLinkAction)
              }
              className={primary}
            >
              {CONFIRM[confirming].yes}
            </button>
            <button type="button" onClick={() => setConfirming(null)} className={button}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={disabled} onClick={() => setConfirming("password")} className={button}>
              New password
            </button>
            <button type="button" disabled={disabled} onClick={() => setConfirming("replace")} className={button}>
              Replace link
            </button>
            <button type="button" disabled={disabled} onClick={() => setConfirming("revoke")} className={button}>
              Turn off
            </button>
          </div>
        ))}

      {result?.message && <p className={`text-xs ${result.ok ? "text-fig-teal" : "text-red-700"}`}>{result.message}</p>}
    </div>
  );
}
