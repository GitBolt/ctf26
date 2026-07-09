"use client";

import { useEffect, useMemo, useState } from "react";
import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import {
  DEFAULT_VAULT_ID,
  PROGRAM_ID,
  Transaction,
  VICTIM_PASSKEY,
  anchor,
  base64UrlToBuffer,
  connection,
  createPasskey,
  getAssertion,
  passkeyPda,
  program,
  solToLamports,
  targetVault,
  vaultIdBytes,
} from "@/lib/imprint";

function short(value) {
  const text = value?.toString?.() || String(value || "");
  if (text.length < 16) return text;
  return `${text.slice(0, 6)}...${text.slice(-6)}`;
}

function loadStoredPasskey() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem("imprint-passkey");
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return {
    credentialId: parsed.credentialId,
    publicKey: Buffer.from(parsed.publicKey, "hex"),
  };
}

function storePasskey(passkey) {
  window.localStorage.setItem(
    "imprint-passkey",
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

export default function Home() {
  const [wallet, setWallet] = useState(null);
  const [walletName, setWalletName] = useState(null);
  const [walletOptions, setWalletOptions] = useState([]);
  const [selectedWalletId, setSelectedWalletId] = useState("");
  const [passkey, setPasskey] = useState(null);
  const [target, setTarget] = useState(null);
  const [targetState, setTargetState] = useState(null);
  const [passkeyState, setPasskeyState] = useState(null);
  const [challengeInput, setChallengeInput] = useState("");
  const [assertionOutput, setAssertionOutput] = useState("");
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(false);

  const conn = useMemo(() => connection(), []);
  const challengeProgram = useMemo(
    () => (wallet ? program(wallet) : null),
    [wallet]
  );
  const passkeyAddress = passkey?.publicKey
    ? passkeyPda(passkey.publicKey)
    : null;

  function log(line) {
    setLogs((current) =>
      [`${new Date().toLocaleTimeString()} ${line}`, ...current].slice(0, 12)
    );
  }

  async function refresh() {
    if (!wallet?.publicKey) return;
    const targetAddress = targetVault(wallet.publicKey);
    setTarget(targetAddress);

    try {
      const account = await challengeProgram.account.vault.fetch(targetAddress);
      const lamports = await conn.getBalance(targetAddress);
      setTargetState({ account, lamports });
    } catch {
      setTargetState(null);
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
    setPasskey(loadStoredPasskey());
    const discovered = discoverSolanaWallets();
    setWalletOptions(discovered);
    setSelectedWalletId(discovered[0]?.id || "");
  }, []);

  useEffect(() => {
    refresh();
  }, [wallet?.publicKey?.toString(), passkey?.credentialId]);

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
    log(`wallet connected ${publicKey.toString()} (${selected.name})`);
  }

  async function createAndStorePasskey() {
    setBusy(true);
    try {
      const next = await createPasskey();
      setPasskeyState(null);
      setPasskey(next);
      log(
        `passkey created ${short(
          next.credentialId
        )}; register it to bind the attested key on-chain`
      );
    } finally {
      setBusy(false);
    }
  }

  async function registerPasskey() {
    setBusy(true);
    try {
      if (!passkey.registrationResponse) {
        throw new Error(
          "create a fresh passkey before registering; stored credentials cannot replay registration"
        );
      }
      const response = await fetch("/api/passkey/register-tx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner: wallet.publicKey.toString(),
          registrationResponse: passkey.registrationResponse,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const { transaction, credentialId, passkeyPubkey } =
        await response.json();
      const tx = Transaction.from(Buffer.from(transaction, "base64"));
      const signed = await wallet.signTransaction(tx);
      const sig = await conn.sendRawTransaction(signed.serialize());
      await conn.confirmTransaction(sig, "confirmed");
      const registeredPasskey = {
        credentialId,
        publicKey: Buffer.from(passkeyPubkey, "hex"),
      };
      storePasskey(registeredPasskey);
      setPasskey(registeredPasskey);
      log(`registered passkey ${sig}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function initializeTarget() {
    setBusy(true);
    try {
      const vault = targetVault(wallet.publicKey);
      const tx = await challengeProgram.methods
        .initializeVault(
          Array.from(vaultIdBytes(DEFAULT_VAULT_ID)),
          Array.from(VICTIM_PASSKEY),
          new anchor.BN(solToLamports("0.5")),
          true
        )
        .accounts({
          authority: wallet.publicKey,
          vault,
        })
        .rpc();
      log(`initialized target vault ${tx}`);
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
        throw new Error("withdrawal challenge must decode to exactly 32 bytes");
      }
      log("requesting a passkey assertion for the supplied challenge");

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
      log("assertion created; no Solana transaction was constructed or sent");
    } finally {
      setBusy(false);
    }
  }

  async function guarded(action) {
    try {
      await action();
    } catch (error) {
      log(`error: ${error.message || error}`);
    }
  }

  return (
    <main>
      <header>
        <p className="kicker">superteam security ctf / imprint</p>
        <h1>passkey vault</h1>
      </header>

      <section className="grid">
        <div className="panel">
          <h2>network</h2>
          <dl>
            <dt>cluster</dt>
            <dd>devnet</dd>
            <dt>program</dt>
            <dd>{PROGRAM_ID.toString()}</dd>
            <dt>vault id</dt>
            <dd>{DEFAULT_VAULT_ID}</dd>
          </dl>
        </div>

        <div className="panel">
          <h2>wallet</h2>
          {wallet?.publicKey ? (
            <dl>
              <dt>provider</dt>
              <dd>{walletName}</dd>
              <dt>connected</dt>
              <dd>{wallet.publicKey.toString()}</dd>
            </dl>
          ) : (
            <>
              {walletOptions.length > 1 ? (
                <select
                  value={selectedWalletId}
                  onChange={(event) => setSelectedWalletId(event.target.value)}
                >
                  {walletOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <button onClick={() => guarded(connectWallet)} disabled={busy}>
                connect solana wallet
              </button>
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>passkey</h2>
        {passkey ? (
          <dl>
            <dt>credential</dt>
            <dd>{short(passkey.credentialId)}</dd>
            <dt>compressed p-256 pubkey</dt>
            <dd>
              {passkey.publicKey
                ? Buffer.from(passkey.publicKey).toString("hex")
                : "verified during registration"}
            </dd>
            <dt>passkey account</dt>
            <dd>{passkeyAddress?.toString()}</dd>
            <dt>registered on-chain</dt>
            <dd>{passkeyState ? "yes" : "no"}</dd>
          </dl>
        ) : null}
        <div className="actions">
          <button
            onClick={() => guarded(createAndStorePasskey)}
            disabled={busy}
          >
            create passkey
          </button>
          <button
            onClick={() => guarded(registerPasskey)}
            disabled={busy || !wallet || !passkey}
          >
            register on-chain
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>target vault</h2>
        <dl>
          <dt>target</dt>
          <dd>{target?.toString() || "connect wallet"}</dd>
          <dt>registered passkey</dt>
          <dd>
            {targetState
              ? Buffer.from(targetState.account.registeredPasskey).toString(
                  "hex"
                )
              : "not initialized"}
          </dd>
          <dt>nonce</dt>
          <dd>{targetState ? targetState.account.nonce.toString() : "-"}</dd>
          <dt>lamports</dt>
          <dd>{targetState ? targetState.lamports.toString() : "-"}</dd>
        </dl>
        <div className="actions">
          <button
            onClick={() => guarded(initializeTarget)}
            disabled={busy || !wallet || targetState}
          >
            initialize local target
          </button>
          <button onClick={() => guarded(refresh)} disabled={busy || !wallet}>
            refresh
          </button>
        </div>
      </section>

      <section className="panel workbench">
        <h2>assertion workbench</h2>
        <p>
          Derive the withdrawal challenge from the program and current on-chain
          state. This workbench signs one 32-byte base64url challenge; it does
          not construct or submit a Solana transaction.
        </p>
        <label>
          challenge (base64url, no padding)
          <input
            value={challengeInput}
            onChange={(event) => setChallengeInput(event.target.value)}
          />
        </label>
        <button
          onClick={() => guarded(signChallenge)}
          disabled={busy || !passkeyState || !challengeInput.trim()}
        >
          sign challenge with passkey
        </button>
        <pre>{assertionOutput || "no assertion yet"}</pre>
      </section>

      <section className="panel">
        <h2>log</h2>
        <pre>{logs.join("\n") || "no actions yet"}</pre>
      </section>
    </main>
  );
}
