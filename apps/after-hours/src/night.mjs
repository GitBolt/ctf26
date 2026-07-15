import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  isNone,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import {
  fetchMaybeToken,
  fetchMint,
  fetchToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

export const NIGHT_ALLOTMENT_BASE_UNITS = 7_000_000n;
export const NIGHT_ALLOTMENT_TOKENS = "7.000000";

export async function createNightDistributor({ rpcUrl, mint: mintAddress, treasurySecret }, api = {}) {
  const ops = {
    address: api.address || address,
    createRpc: api.createRpc || createSolanaRpc,
    createSigner: api.createSigner || createKeyPairSignerFromBytes,
    deriveAta: api.deriveAta || deriveAta,
    fetchMint: api.fetchMint || fetchMint,
    fetchToken: api.fetchToken || fetchToken,
    fetchMaybeToken: api.fetchMaybeToken || fetchMaybeToken,
    sendAllotment: api.sendAllotment || sendAllotment,
  };
  const rpc = api.rpc || ops.createRpc(rpcUrl);
  const treasury = await decodeTreasury(treasurySecret, ops.createSigner);
  const mint = parseAddress(mintAddress, ops.address, "AFTER_HOURS_NIGHT_MINT must be a valid Solana address");

  return Object.freeze({
    treasury: treasury.address,
    mint,
    async issue(walletAddress) {
      const wallet = parseWallet(walletAddress, ops.address);
      const mintInfo = await ops.fetchMint(rpc, mint, { commitment: "confirmed" });
      if (mintInfo.data.decimals !== 6 || !isNone(mintInfo.data.mintAuthority) || !isNone(mintInfo.data.freezeAuthority)) {
        throw new NightDistributionError("invalid_night_mint", "official NIGHT mint configuration is unavailable");
      }

      const treasuryAccountAddress = await ops.deriveAta(mint, treasury.address);
      const destinationAddress = await ops.deriveAta(mint, wallet);
      const [treasuryAccount, destinationAccount] = await Promise.all([
        ops.fetchToken(rpc, treasuryAccountAddress, { commitment: "confirmed" }),
        ops.fetchMaybeToken(rpc, destinationAddress, { commitment: "confirmed" }),
      ]);
      const currentAmount = destinationAccount.exists ? destinationAccount.data.amount : 0n;
      const missing = NIGHT_ALLOTMENT_BASE_UNITS - currentAmount;
      if (missing <= 0n) return evidence(wallet, destinationAddress, mint, "");
      if (treasuryAccount.data.amount < missing) {
        throw new NightDistributionError("treasury_empty", "official NIGHT allotments are temporarily unavailable");
      }

      const signature = await ops.sendAllotment({
        rpc,
        treasury,
        treasuryAccount: treasuryAccountAddress,
        destinationAccount: destinationAddress,
        destinationOwner: wallet,
        mint,
        amount: missing,
      });
      return evidence(wallet, destinationAddress, mint, signature);
    },
  });
}

export class NightDistributionError extends Error {
  constructor(code, message) { super(message); this.name = "NightDistributionError"; this.code = code; }
}

async function deriveAta(mint, owner) {
  const [ata] = await findAssociatedTokenPda({ mint, owner, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}

async function sendAllotment({ rpc, treasury, treasuryAccount, destinationAccount, destinationOwner, mint, amount }) {
  const createDestination = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer: treasury,
    ata: destinationAccount,
    owner: destinationOwner,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const transfer = getTransferCheckedInstruction({
    source: treasuryAccount,
    mint,
    destination: destinationAccount,
    authority: treasury,
    amount,
    decimals: 6,
  });
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(treasury, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([createDestination, transfer], tx),
  );
  const transaction = await signTransactionMessageWithSigners(message);
  const signature = await rpc.sendTransaction(getBase64EncodedWireTransaction(transaction), {
    encoding: "base64",
    preflightCommitment: "confirmed",
  }).send();
  await waitForConfirmation(rpc, signature);
  return signature;
}

async function waitForConfirmation(rpc, signature, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value } = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send();
    const status = value[0];
    if (status?.err) throw new NightDistributionError("transfer_failed", "official NIGHT transfer failed on devnet");
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new NightDistributionError("transfer_timeout", "official NIGHT transfer confirmation timed out");
}

async function decodeTreasury(value, createSigner) {
  let bytes;
  try { bytes = Buffer.from(String(value || ""), "base64"); }
  catch { throw new Error("AFTER_HOURS_NIGHT_TREASURY_KEYPAIR must be base64"); }
  if (bytes.length !== 64) throw new Error("AFTER_HOURS_NIGHT_TREASURY_KEYPAIR must encode a 64-byte keypair");
  try { return await createSigner(new Uint8Array(bytes)); }
  catch { throw new Error("AFTER_HOURS_NIGHT_TREASURY_KEYPAIR is invalid"); }
}

function parseWallet(value, parse) {
  try { return parse(String(value || "")); }
  catch { throw new NightDistributionError("invalid_wallet", "wallet must be a valid Solana address"); }
}

function parseAddress(value, parse, errorMessage) {
  try { return parse(String(value || "")); }
  catch { throw new Error(errorMessage); }
}

function evidence(wallet, tokenAccount, mint, signature) {
  return Object.freeze({ wallet, tokenAccount, mint, signature, amountBaseUnits: NIGHT_ALLOTMENT_BASE_UNITS.toString() });
}
