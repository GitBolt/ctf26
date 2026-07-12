import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import anchor from "@coral-xyz/anchor";
import {
  AuthorityType,
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
} from "@solana/spl-token";

import { createInstancePlan } from "../src/provisioning.mjs";

const { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = anchor.web3;
const teamId = required("TEAM_ID");
const teamWallet = new PublicKey(required("TEAM_WALLET"));
const rpcUrl = required("SOLANA_RPC_URL");
const operatorPath = resolveKeypairPath(required("OPERATOR_KEYPAIR"));
const programId = new PublicKey(required("VAULT_PROGRAM_ID"));
const plan = createInstancePlan(teamId, required("INSTANCE_SECRET"));

if (operatorPath === path.join(os.homedir(), ".config/solana/id.json")) {
  throw new Error("Refusing the default personal Solana wallet. Use a dedicated .keys SIGNET operator keypair.");
}

const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(operatorPath, "utf8"))));
const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(operator), {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});
const idlPath = path.resolve("target/idl/quarry_vault.json");
if (!fs.existsSync(idlPath)) throw new Error("Run npm run build:onchain before provisioning targets.");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
idl.address = programId.toBase58();
const program = new anchor.Program(idl, provider);

const [vault] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), operator.publicKey.toBuffer(), plan.teamSeed],
  programId,
);
const [vaultAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault-authority"), vault.toBuffer()],
  programId,
);
const [reserve] = PublicKey.findProgramAddressSync(
  [Buffer.from("reserve"), vault.toBuffer()],
  programId,
);

const mint = await createMint(connection, operator, operator.publicKey, null, 0);
const escrow = await getOrCreateAssociatedTokenAccount(connection, operator, mint, teamWallet);
const pinnedStrategyProgram = SystemProgram.programId;

const initializeSignature = await program.methods
  .initialize([...plan.teamSeed], pinnedStrategyProgram)
  .accounts({
    authority: operator.publicKey,
    mint,
    vault,
    vaultAuthority,
    reserve,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .rpc();

await mintTo(connection, operator, mint, reserve, operator, plan.reserveRaw);
await setAuthority(connection, operator, mint, operator, AuthorityType.MintTokens, null);

const buildFingerprint = crypto
  .createHash("sha256")
  .update("quarry-vault:8d17c2e-pre-refactor")
  .digest("hex")
  .slice(0, 16);

const target = {
  instanceId: plan.instanceId,
  programId: programId.toBase58(),
  vaultAccount: vault.toBase58(),
  vaultAuthority: vaultAuthority.toBase58(),
  reserveAccount: reserve.toBase58(),
  escrowAccount: escrow.address.toBase58(),
  mint: mint.toBase58(),
  teamWallet: teamWallet.toBase58(),
  buildFingerprint,
  thresholdRaw: plan.thresholdRaw.toString(),
  initialReserveRaw: plan.reserveRaw.toString(),
  initialEscrowRaw: "0",
  decimals: 0,
  cluster: process.env.SOLANA_CLUSTER || "devnet",
  tokenSymbol: "QRY",
};

console.error(`Initialized ${plan.instanceId} in ${initializeSignature}`);
console.log(JSON.stringify({ [teamId]: target }, null, 2));

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function resolveKeypairPath(value) {
  return path.resolve(value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value);
}
