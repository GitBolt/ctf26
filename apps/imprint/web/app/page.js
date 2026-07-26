"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import {
  PROGRAM_ID,
  Transaction,
  base64UrlToBuffer,
  connection,
  getAssertion,
  passkeyPda,
  program,
} from "@/lib/imprint";

const EXPLORER_CLUSTER = "devnet";

function explorerTxUrl(sig) {
  return `https://explorer.solana.com/tx/${sig}?cluster=${EXPLORER_CLUSTER}`;
}

function short(value) {
  const text = value?.toString?.() || String(value || "");
  if (text.length < 16) return text;
  return `${text.slice(0, 6)}...${text.slice(-6)}`;
}

function passkeyStorageKey(participantId) {
  return `imprint-passkey:${participantId}`;
}

function loadStoredPasskey(participantId) {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(passkeyStorageKey(participantId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.credentialId !== "string" ||
      !/^[0-9a-f]{66}$/i.test(String(parsed.publicKey || ""))
    ) {
      throw new Error("stored passkey is invalid");
    }
    return {
      credentialId: parsed.credentialId,
      publicKey: Buffer.from(parsed.publicKey, "hex"),
    };
  } catch {
    window.localStorage.removeItem(passkeyStorageKey(participantId));
    return null;
  }
}

function storePasskey(participantId, passkey) {
  window.localStorage.setItem(
    passkeyStorageKey(participantId),
    JSON.stringify({
      credentialId: passkey.credentialId,
      publicKey: Buffer.from(passkey.publicKey).toString("hex"),
    })
  );
}

function walletLabel(provider, fallback) {
  if (provider?.isPhantom) return "Phantom";
  if (provider?.isSolflare) return "Solflare";
  if (provider?.isBackpack) return "Backpack";
  if (provider?.isGlow) return "Glow";
  return provider?.name || fallback;
}

function addWallet(candidates, seen, provider, fallback) {
  if (!provider || seen.has(provider)) return;
  if (
    typeof provider.connect !== "function" ||
    typeof provider.signTransaction !== "function"
  )
    return;
  seen.add(provider);
  candidates.push({
    id: `${walletLabel(provider, fallback).toLowerCase()}-${candidates.length}`,
    name: walletLabel(provider, fallback),
    provider,
  });
}

function discoverSolanaWallets() {
  if (typeof window === "undefined") return [];
  const candidates = [];
  const seen = new Set();

  if (Array.isArray(window.solana?.providers)) {
    window.solana.providers.forEach((provider, index) =>
      addWallet(candidates, seen, provider, `wallet ${index + 1}`)
    );
  }

  addWallet(candidates, seen, window.solana, "solana wallet");
  addWallet(candidates, seen, window.phantom?.solana, "Phantom");
  addWallet(candidates, seen, window.solflare, "Solflare");
  addWallet(
    candidates,
    seen,
    window.backpack?.solana || window.backpack,
    "Backpack"
  );
  addWallet(candidates, seen, window.glowSolana, "Glow");

  return candidates;
}

function anchorWallet(provider, publicKey) {
  const normalizedPublicKey = new PublicKey(publicKey.toString());
  return {
    publicKey: normalizedPublicKey,
    signTransaction: provider.signTransaction.bind(provider),
    signAllTransactions: provider.signAllTransactions
      ? provider.signAllTransactions.bind(provider)
      : async (transactions) =>
          Promise.all(transactions.map((tx) => provider.signTransaction(tx))),
  };
}

function Toast({ toast, onDismiss }) {
  return (
    <div className="toast" data-kind={toast.kind} role="status">
      <div className="toast-head">
        <span className="toast-dot" aria-hidden="true" />
        <span>
          {toast.kind === "error"
            ? "error"
            : toast.kind === "success"
            ? "confirmed"
            : "notice"}
        </span>
      </div>
      <div className="toast-message">{toast.message}</div>
      {toast.sig ? (
        <a
          className="toast-link"
          href={explorerTxUrl(toast.sig)}
          target="_blank"
          rel="noreferrer"
        >
          view transaction on explorer &rarr;
        </a>
      ) : null}
      <button
        type="button"
        className="secondary"
        style={{ padding: "3px 8px", fontSize: 10, justifySelf: "start" }}
        onClick={() => onDismiss(toast.id)}
      >
        dismiss
      </button>
    </div>
  );
}

function Step({ number, title, hint, status, isOpen, onToggle, children }) {
  return (
    <div className="step" data-status={status} data-open={isOpen}>
      <button
        type="button"
        className="step-summary"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <span className="step-tumbler" aria-hidden="true">
          {status === "done" ? "✓" : number}
        </span>
        <span className="step-heading">
          <span className="step-title">{title}</span>
          <span className="step-hint">{hint}</span>
        </span>
        <span className="step-chevron" aria-hidden="true">
          &#9656;
        </span>
      </button>
      {isOpen ? <div className="step-body">{children}</div> : null}
    </div>
  );
}

export default function Home() {
  const [wallet, setWallet] = useState(null);
  const [participantId, setParticipantId] = useState(null);
  const [walletName, setWalletName] = useState(null);
  const [walletOptions, setWalletOptions] = useState([]);
  const [selectedWalletId, setSelectedWalletId] = useState("");
  const [passkey, setPasskey] = useState(null);
  const [target, setTarget] = useState(null);
  const [targetState, setTargetState] = useState(null);
  const [targetError, setTargetError] = useState("");
  const [passkeyState, setPasskeyState] = useState(null);
  const [challengeInput, setChallengeInput] = useState("");
  const [assertionOutput, setAssertionOutput] = useState("");
  const [withdrawalSignature, setWithdrawalSignature] = useState("");
  const [solveResult, setSolveResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [expandedStep, setExpandedStep] = useState(1);
  const [accessState, setAccessState] = useState("loading");
  const [accessError, setAccessError] = useState("");
  const toastTimers = useRef(new Map());

  const conn = useMemo(() => connection(), []);
  const challengeProgram = useMemo(() => program(wallet), [wallet]);
  const passkeyAddress = passkey?.publicKey
    ? passkeyPda(passkey.publicKey)
    : null;

  function dismissToast(id) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
  }

  function pushToast(kind, message, sig) {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, kind, message, sig }].slice(-3));
    const timer = setTimeout(() => dismissToast(id), 8000);
    toastTimers.current.set(id, timer);
  }

  function notify(kind, message, sig) {
    setLogs((current) =>
      [
        `${new Date().toLocaleTimeString()} ${message}${sig ? ` ${sig}` : ""}`,
        ...current,
      ].slice(0, 20)
    );
    pushToast(kind, message, sig);
  }

  async function refresh() {
    if (!target) return;
    const targetAddress = target;
    setTargetError("");

    try {
      let lastError;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const [account, accountInfo] = await Promise.all([
            challengeProgram.account.vault.fetch(targetAddress),
            conn.getAccountInfo(targetAddress, "confirmed"),
          ]);
          if (!accountInfo) throw new Error("assigned vault is unavailable");
          const rentExemptLamports =
            await conn.getMinimumBalanceForRentExemption(
              accountInfo.data.length,
              "confirmed"
            );
          setTargetState({
            account,
            lamports: accountInfo.lamports,
            rentExemptLamports,
            withdrawableLamports: Math.max(
              0,
              accountInfo.lamports - rentExemptLamports
            ),
          });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 700));
        }
      }
      if (lastError) throw lastError;
    } catch (error) {
      setTargetState(null);
      setTargetError(
        error?.message || "The assigned vault could not be read from devnet."
      );
    }

    if (passkeyAddress) {
      try {
        const account = await challengeProgram.account.passkey.fetch(
          passkeyAddress
        );
        setPasskeyState(account);
      } catch {
        setPasskeyState(null);
      }
    }
  }

  useEffect(() => {
    const discovered = discoverSolanaWallets();
    setWalletOptions(discovered);
    setSelectedWalletId(discovered[0]?.id || "");
  }, []);

  useEffect(() => {
    const ticket = new URLSearchParams(window.location.search).get("ticket");
    const testParticipant = new URLSearchParams(window.location.search).get(
      "test_participant"
    );
    const uiHeaders = {
      "x-imprint-ui": "vault",
      ...(navigator.webdriver ? { "x-imprint-automation": "webdriver" } : {}),
    };
    const request = testParticipant
      ? fetch("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json", ...uiHeaders },
          body: JSON.stringify({
            directTest: true,
            participantId: testParticipant,
          }),
        })
      : ticket
      ? fetch("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json", ...uiHeaders },
          body: JSON.stringify({ ticket }),
        })
      : fetch("/api/session", { headers: uiHeaders });
    request
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        const session = await response.json();
        if (typeof session.target?.vault !== "string") {
          throw new Error("this participant has no assigned IMPRINT target");
        }
        if (typeof session.participantId !== "string") {
          throw new Error("IMPRINT session identity is unavailable");
        }
        setParticipantId(session.participantId);
        setPasskey(loadStoredPasskey(session.participantId));
        setTarget(new PublicKey(session.target.vault));
        if (ticket || testParticipant)
          window.history.replaceState({}, "", window.location.pathname);
        setAccessState("ready");
      })
      .catch((error) => {
        setAccessState("denied");
        setAccessError(
          error.message ||
            "open IMPRINT from the event portal to establish a challenge session"
        );
      });
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    wallet?.publicKey?.toString(),
    passkey?.credentialId,
    target?.toString(),
  ]);

  const vaultDrained =
    targetState && targetState.withdrawableLamports === 0;
  const currentStep = !wallet?.publicKey
    ? 1
    : !passkeyState
    ? 2
    : vaultDrained
    ? 5
    : 4;

  useEffect(() => {
    setExpandedStep(currentStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  async function connectWallet() {
    const discovered = discoverSolanaWallets();
    setWalletOptions(discovered);

    const selected =
      discovered.find((option) => option.id === selectedWalletId) ||
      discovered[0];
    if (!selected) {
      throw new Error("no injected Solana wallet found");
    }

    const response = await selected.provider.connect();
    const publicKey = response?.publicKey || selected.provider.publicKey;
    if (!publicKey)
      throw new Error(`${selected.name} did not return a public key`);

    setWallet(anchorWallet(selected.provider, publicKey));
    setWalletName(selected.name);
    notify("success", `wallet connected (${selected.name})`);
  }

  async function claimEventPasskey() {
    setBusy(true);
    try {
      if (!wallet?.publicKey) throw new Error("connect a Solana wallet first");
      const optionsResponse = await fetch("/api/passkey/claim/options", {
        method: "POST",
      });
      if (!optionsResponse.ok) throw new Error(await optionsResponse.text());
      const { mode, options: optionsJSON } = await optionsResponse.json();
      notify(
        "info",
        mode === "register"
          ? "creating a platform passkey with Face ID, Touch ID, or Windows Hello"
          : "requesting a platform passkey assertion"
      );
      const assertionResponse =
        mode === "register"
          ? await startRegistration({ optionsJSON })
          : await startAuthentication({ optionsJSON });
      const response = await fetch("/api/passkey/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner: wallet.publicKey.toString(),
          response: assertionResponse,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const { transaction, credentialId, passkeyPubkey, alreadyRegistered } =
        await response.json();
      const registeredPasskey = {
        credentialId,
        publicKey: Buffer.from(passkeyPubkey, "hex"),
      };
      storePasskey(participantId, registeredPasskey);
      setPasskey(registeredPasskey);
      if (alreadyRegistered) {
        notify("success", "platform passkey restored");
        await refresh();
        return;
      }
      const tx = Transaction.from(Buffer.from(transaction, "base64"));
      const signed = await wallet.signTransaction(tx);
      const sig = await conn.sendRawTransaction(signed.serialize());
      await conn.confirmTransaction(sig, "confirmed");
      notify("success", "platform passkey claimed on-chain", sig);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function signChallenge() {
    setBusy(true);
    try {
      const challenge = base64UrlToBuffer(challengeInput.trim());
      if (challenge.length !== 32) {
        throw new Error("challenge must decode to exactly 32 bytes");
      }
      notify(
        "info",
        "requesting a passkey assertion for the supplied challenge"
      );

      const assertion = await getAssertion({
        credentialId: passkey.credentialId,
        challenge,
      });
      setAssertionOutput(
        JSON.stringify(
          {
            authenticatorDataBase64: Buffer.from(
              assertion.authenticatorData
            ).toString("base64"),
            clientDataJSONBase64: Buffer.from(
              assertion.clientDataJSON
            ).toString("base64"),
            signatureCompactBase64: Buffer.from(assertion.signature).toString(
              "base64"
            ),
          },
          null,
          2
        )
      );
      notify("success", "assertion signed — no Solana transaction was sent");
    } finally {
      setBusy(false);
    }
  }

  async function submitWithdrawal() {
    setBusy(true);
    try {
      const signature = withdrawalSignature.trim();
      const response = await fetch("/api/solve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signature }),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      setSolveResult(result);
      notify("success", "IMPRINT completion recorded", signature);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function guarded(action) {
    try {
      await action();
    } catch (error) {
      notify("error", error.message || String(error));
    }
  }

  function toggleStep(step) {
    setExpandedStep((current) => (current === step ? 0 : step));
  }

  const step1Status = wallet?.publicKey ? "done" : "current";
  const step2Status = !wallet?.publicKey
    ? "locked"
    : passkeyState
    ? "done"
    : "current";
  const step3Status = targetState
    ? "done"
    : wallet?.publicKey
    ? "current"
    : "locked";
  const step4Status = passkeyState
    ? assertionOutput
      ? "done"
      : "current"
    : "locked";
  const step5Status = solveResult
    ? "done"
    : vaultDrained
    ? "current"
    : "locked";

  return (
    <main>
      <div className="toast-region" aria-live="polite">
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>

      <header>
        <div className="brand">
          <h1>imprint</h1>
          <p className="tagline">passkey vault · superteam security ctf</p>
        </div>
        <div className="meta">
          <span>
            devnet · program <strong>{short(PROGRAM_ID.toString())}</strong>
          </span>
          <span>
            assigned target{" "}
            <strong>{target ? short(target) : "pending"}</strong>
          </span>
        </div>
      </header>

      {accessState !== "ready" ? (
        <section className="access-panel" aria-live="polite">
          <h2>
            {accessState === "loading"
              ? "verifying challenge access"
              : "challenge access required"}
          </h2>
          <p>{accessState === "loading" ? "please wait…" : accessError}</p>
        </section>
      ) : (
        <div className="dial">
          <Step
            number={1}
            title="connect wallet"
            hint={
              wallet?.publicKey
                ? `connected · ${walletName} · ${short(
                    wallet.publicKey.toString()
                  )}`
                : "connect a Solana wallet on devnet to begin"
            }
            status={step1Status}
            isOpen={expandedStep === 1}
            onToggle={() => toggleStep(1)}
          >
            {wallet?.publicKey ? (
              <dl>
                <dt>provider</dt>
                <dd>{walletName}</dd>
                <dt>connected</dt>
                <dd>{wallet.publicKey.toString()}</dd>
              </dl>
            ) : (
              <>
                <p className="note">
                  Any injected Solana wallet works. Make sure it&apos;s set to
                  devnet.
                </p>
                <div className="actions">
                  {walletOptions.length > 1 ? (
                    <select
                      value={selectedWalletId}
                      onChange={(event) =>
                        setSelectedWalletId(event.target.value)
                      }
                    >
                      {walletOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <button
                    onClick={() => guarded(connectWallet)}
                    disabled={busy}
                  >
                    connect solana wallet
                  </button>
                </div>
              </>
            )}
          </Step>

          <Step
            number={2}
            title="claim event security key"
            hint={
              passkeyState
                ? "claimed on-chain"
                : "create or verify your platform passkey"
            }
            status={step2Status}
            isOpen={expandedStep === 2}
            onToggle={() => toggleStep(2)}
          >
            <p className="note">
              First launch creates a platform passkey for this event. Returning
              launches verify the same passkey. Use Touch ID, Face ID, Windows
              Hello, or another platform authenticator.
            </p>
            {passkey ? (
              <dl>
                <dt>credential</dt>
                <dd>{short(passkey.credentialId)}</dd>
                <dt>p-256 pubkey</dt>
                <dd>
                  {passkey.publicKey
                    ? Buffer.from(passkey.publicKey).toString("hex")
                    : "claimed from roster"}
                </dd>
                <dt>passkey account</dt>
                <dd>{passkeyAddress?.toString()}</dd>
                <dt>on-chain status</dt>
                <dd className={passkeyState ? "ok" : "pending"}>
                  {passkeyState ? "registered" : "not yet registered"}
                </dd>
              </dl>
            ) : null}
            <div className="actions">
              <button
                onClick={() => guarded(claimEventPasskey)}
                disabled={
                  busy || accessState !== "ready" || !wallet || !!passkeyState
                }
              >
                claim platform passkey
              </button>
            </div>
          </Step>

          <Step
            number={3}
            title="target vault"
            hint={
              targetState
                ? `${targetState.lamports / 1e9} SOL · nonce ${
                    targetState.account.nonce
                  }`
                : targetError
                ? "vault read needs attention"
                : "reading configured vault state"
            }
            status={step3Status}
            isOpen={expandedStep === 3}
            onToggle={() => toggleStep(3)}
          >
            <p className="note">
              Inspect the configured vault and its public state.
            </p>
            <dl>
              <dt>target</dt>
              <dd>{target?.toString() || "loading assigned vault"}</dd>
              <dt>registered passkey</dt>
              <dd>
                {targetState
                  ? Buffer.from(targetState.account.registeredPasskey).toString(
                      "hex"
                    )
                  : targetError || "reading from devnet"}
              </dd>
              <dt>nonce</dt>
              <dd>
                {targetState ? targetState.account.nonce.toString() : "-"}
              </dd>
              <dt>lamports</dt>
              <dd>{targetState ? targetState.lamports.toString() : "-"}</dd>
              <dt>withdrawable deposit</dt>
              <dd>
                {targetState
                  ? targetState.withdrawableLamports.toString()
                  : "-"}
              </dd>
              <dt>rent reserve</dt>
              <dd>
                {targetState
                  ? targetState.rentExemptLamports.toString()
                  : "-"}
              </dd>
            </dl>
            {vaultDrained ? (
              <p className="note">
                The challenge deposit is fully withdrawn. The remaining
                lamports are the account&apos;s required rent reserve.
              </p>
            ) : null}
            {targetError ? <p className="error">{targetError}</p> : null}
            <div className="actions">
              <button
                className="secondary"
                onClick={() => guarded(refresh)}
                disabled={busy || !target}
              >
                refresh
              </button>
            </div>
          </Step>

          <Step
            number={4}
            title="assertion workbench"
            hint={
              assertionOutput
                ? "assertion signed"
                : "sign a supplied challenge with your passkey"
            }
            status={step4Status}
            isOpen={expandedStep === 4}
            onToggle={() => toggleStep(4)}
          >
            <p className="note">
              This workbench signs one 32-byte base64url challenge with your
              registered passkey. It does not construct or submit a Solana
              transaction.
            </p>
            <label>
              challenge (base64url, no padding)
              <input
                value={challengeInput}
                onChange={(event) => setChallengeInput(event.target.value)}
              />
            </label>
            <div className="actions">
              <button
                onClick={() => guarded(signChallenge)}
                disabled={busy || !passkeyState || !challengeInput.trim()}
              >
                sign challenge with passkey
              </button>
            </div>
            <pre>{assertionOutput || "no assertion yet"}</pre>
          </Step>

          <Step
            number={5}
            title="submit withdrawal"
            hint={
              solveResult
                ? "completion recorded"
                : vaultDrained
                ? "paste the successful withdrawal transaction"
                : "withdraw the challenge deposit first"
            }
            status={step5Status}
            isOpen={expandedStep === 5}
            onToggle={() => toggleStep(5)}
          >
            <p className="note">
              A rent-exempt reserve remains in the vault by design. Submit the
              transaction that withdrew the challenge deposit.
            </p>
            <label>
              transaction signature
              <input
                value={withdrawalSignature}
                onChange={(event) =>
                  setWithdrawalSignature(event.target.value)
                }
                placeholder="Solana transaction signature"
              />
            </label>
            <div className="actions">
              <button
                onClick={() => guarded(submitWithdrawal)}
                disabled={
                  busy ||
                  !withdrawalSignature.trim() ||
                  !!solveResult
                }
              >
                record completion
              </button>
            </div>
            {solveResult ? (
              <dl>
                <dt>status</dt>
                <dd className="ok">completed</dd>
                <dt>withdrawn</dt>
                <dd>{solveResult.transactionDrain} lamports</dd>
              </dl>
            ) : null}
          </Step>
        </div>
      )}

      <details className="log-drawer">
        <summary>activity log ({logs.length})</summary>
        <div className="log-body">
          <pre>{logs.join("\n") || "no actions yet"}</pre>
        </div>
      </details>
    </main>
  );
}
