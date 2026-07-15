import fs from "node:fs";
import anchor from "@coral-xyz/anchor";
import { address, required, walletKeypair } from "./config.mjs";

const TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const amountText = process.argv[2];
if (!amountText || !/^[0-9]+$/.test(amountText) || BigInt(amountText) <= 0n) {
  throw new Error("usage: npm run execute -- <raw-token-amount>");
}

const connection = new anchor.web3.Connection(required("SOLANA_RPC_URL"), "confirmed");
const signer = walletKeypair();
const wallet = new anchor.Wallet(signer);
const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
const idl = JSON.parse(fs.readFileSync(new URL("../idl/quarry_vault.json", import.meta.url), "utf8"));
idl.address = address("VAULT_PROGRAM_ID").toBase58();
const program = new anchor.Program(idl, provider);

const signature = await program.methods
  .executeStrategy(new anchor.BN(amountText))
  .accounts({
    vault: address("VAULT_ACCOUNT"),
    vaultAuthority: address("VAULT_AUTHORITY"),
    reserve: address("RESERVE_ACCOUNT"),
    destination: address("TEAM_ESCROW"),
    strategyProgram: address("STRATEGY_PROGRAM_ID"),
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();

console.log(signature);
