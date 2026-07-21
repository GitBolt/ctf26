"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}`);
  return payload;
}

export function EligibilityControls({ proposals, frozen }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function run(action, body) {
    setBusy(true);
    setMessage("");
    try {
      await postJson("/api/admin/leaderboard/eligibility", { action, ...body });
      setMessage("Eligibility ledger updated.");
      router.refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  function propose(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    run("propose", {
      participantId: form.get("participantId"),
      status: form.get("status"),
      reason: form.get("reason"),
    });
  }

  return (
    <div className="admin-action-stack">
      {!frozen ? (
        <form className="admin-eligibility-form" onSubmit={propose}>
          <label>
            <span>Participant ID</span>
            <input name="participantId" required autoComplete="off" />
          </label>
          <label>
            <span>Decision</span>
            <select name="status" defaultValue="held">
              <option value="held">Hold for review</option>
              <option value="eligible">Keep eligible</option>
              <option value="disqualified">Disqualify</option>
            </select>
          </label>
          <label className="admin-reason-field">
            <span>Reason</span>
            <input name="reason" required minLength={8} maxLength={500} />
          </label>
          <button disabled={busy} type="submit">Propose</button>
        </form>
      ) : <p className="admin-inline-note">The eligibility ledger is frozen.</p>}

      {proposals.length > 0 ? (
        <div className="admin-proposals" aria-label="Pending eligibility proposals">
          {proposals.map((proposal) => (
            <article key={proposal.id}>
              <div>
                <strong>{proposal.participantId}</strong>
                <span>{proposal.status}: {proposal.reason}</span>
                <small>Proposed by {proposal.proposer}</small>
              </div>
              {proposal.state === "proposed" && !frozen ? (
                <div>
                  <button disabled={busy} onClick={() => run("approve", { proposalId: proposal.id })} type="button">Approve</button>
                  <button disabled={busy} onClick={() => run("reject", { proposalId: proposal.id })} type="button">Reject</button>
                </div>
              ) : <span className="admin-status-chip">{proposal.state}</span>}
            </article>
          ))}
        </div>
      ) : null}
      {message ? <p className="admin-action-message" role="status">{message}</p> : null}
    </div>
  );
}

export function FinalizeControl({ enabled }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function finalize() {
    setBusy(true);
    setMessage("");
    try {
      const result = await postJson("/api/admin/leaderboard/finalize", {});
      setMessage(`Final leaderboard sealed at ${new Date(result.finalizedAt).toLocaleString()}.`);
      router.refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-finalize-control">
      <button disabled={!enabled || busy} onClick={finalize} type="button">
        {busy ? "Finalizing…" : "Seal final leaderboard"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}

const NEXT_PHASE = Object.freeze({ staging: "live", live: "recovery", recovery: "freezing" });
const ADVANCE_LABEL = Object.freeze({
  live: "Enable live scoring",
  recovery: "Close new sessions",
  freezing: "Begin final review",
});

export function LifecycleControls({ phase, paused, canStartLive = true, startReason = "" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const target = NEXT_PHASE[phase] || null;
  const canPause = phase === "staging" || phase === "live";
  const canAdvance = Boolean(target) && (target !== "live" || canStartLive);

  async function run(body) {
    setBusy(true);
    setMessage("");
    try {
      await postJson("/api/admin/leaderboard/lifecycle", body);
      setMessage("Event lifecycle updated.");
      router.refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  function advance() {
    if (!target) return;
    const prompt = target === "live"
      ? "Enable live scoring for the configured event window?"
      : target === "recovery"
        ? "Close new challenge sessions and enter score recovery?"
        : "Close score recovery and begin final review?";
    if (window.confirm(prompt)) run({ action: "advance", phase: target });
  }

  return (
    <div className="admin-lifecycle-control">
      <div>
        {target ? <button disabled={busy || !canAdvance} onClick={advance} type="button">{ADVANCE_LABEL[target]}</button> : null}
        {canPause ? <button disabled={busy} onClick={() => run({ action: paused ? "resume" : "pause" })} type="button">{paused ? "Resume launches" : "Pause launches"}</button> : null}
      </div>
      {!canStartLive && phase === "staging" ? <p>{startReason || "Complete the official event settings before starting."}</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
