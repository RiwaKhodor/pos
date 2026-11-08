"use client";

import { useEffect, useState } from "react";
import type { VanoUpdateState } from "@/types/vano-update";

export function UpdateNotice() {
  const [state, setState] = useState<VanoUpdateState | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const api = window.vanoUpdate;
    if (!api) return;
    void api.getState().then((next) => {
      setState(next);
      if (next.status === "ready" || next.status === "downloading") setOpen(true);
    });
    return api.onChange((next) => {
      setState(next);
      if (next.status === "ready" || next.status === "downloading") setOpen(true);
    });
  }, []);

  if (!state) return null;

  const pending = state.status === "ready" || state.status === "downloading";
  const versionLabel = state.version ? `Version ${state.version}` : "A new version";

  return (
    <div className="update-notice" onClick={(event) => event.stopPropagation()}>
      {pending ? (
        <button
          type="button"
          className="update-notice-banner"
          onClick={() => setOpen(true)}
        >
          {state.status === "downloading"
            ? `${versionLabel} is downloading`
            : `${versionLabel} — tap Update`}
        </button>
      ) : null}
      <button
        type="button"
        className="update-notice-btn"
        title="Updates"
        aria-label="Updates"
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 3a5 5 0 0 1 5 5v2.1c0 .5.2 1 .5 1.4l1.2 1.6c.7.9.1 2.2-1 2.2H6.3c-1.1 0-1.7-1.3-1-2.2l1.2-1.6c.3-.4.5-.9.5-1.4V8a5 5 0 0 1 5-5zm0 18a2.5 2.5 0 0 0 2.4-2h-4.8A2.5 2.5 0 0 0 12 21z"
          />
        </svg>
        {pending ? <span className="update-notice-dot" /> : null}
      </button>
      {open ? (
        <div className="update-notice-panel" role="dialog" aria-label="Update">
          <div className="update-notice-title">Update</div>
          {state.status === "checking" ? <p>Looking for an update…</p> : null}
          {state.status === "downloading" ? (
            <p>{versionLabel} is downloading.</p>
          ) : null}
          {state.status === "ready" ? (
            <p>
              {versionLabel} is ready. Update closes the register, installs, and
              opens it again. Items and sales stay on this computer.
            </p>
          ) : null}
          {state.status === "none" ? <p>This register is up to date.</p> : null}
          {state.status === "error" ? (
            <p>No update could be downloaded. The register still works.</p>
          ) : null}
          <button
            type="button"
            className="update-notice-install"
            disabled={state.status !== "ready"}
            onClick={() => void window.vanoUpdate?.install()}
          >
            {state.status === "downloading" ? "Downloading…" : "Update"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
