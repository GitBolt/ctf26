import { Connection } from "@solana/web3.js";
import { address, required, walletKeypair } from "./config.mjs";

const connection = new Connection(required("SOLANA_RPC_URL"), "confirmed");
const signer = walletKeypair();
const assignedWallet = address("TEAM_WALLET");
if (!signer.publicKey.equals(assignedWallet)) {
  throw new Error(
    `ANCHOR_WALLET resolves to ${signer.publicKey.toBase58()}, but this assignment requires ${assignedWallet.toBase58()}. ` +
    "Stop and ask an organizer to correct the SIGNET wallet registration before spending SOL.",
  );
}
const [program, vault, reserve, escrow] = await Promise.all([
  connection.getAccountInfo(address("VAULT_PROGRAM_ID")),
  connection.getAccountInfo(address("VAULT_ACCOUNT")),
  connection.getParsedAccountInfo(address("RESERVE_ACCOUNT")),
  connection.getParsedAccountInfo(address("TEAM_ESCROW")),
]);

const reserveInfo = tokenInfo(reserve, "RESERVE_ACCOUNT");
const escrowInfo = tokenInfo(escrow, "TEAM_ESCROW");
if (escrowInfo.owner !== assignedWallet.toBase58()) {
  throw new Error(`TEAM_ESCROW is owned by ${escrowInfo.owner}, not the assigned wallet ${assignedWallet.toBase58()}`);
}

console.log(JSON.stringify({
  teamWallet: {
    assigned: assignedWallet.toBase58(),
    signer: signer.publicKey.toBase58(),
    matches: true,
  },
  programExecutable: program?.executable ?? false,
  vaultOwner: vault?.owner?.toBase58() ?? null,
  reserve: {
    address: address("RESERVE_ACCOUNT").toBase58(),
    owner: reserveInfo.owner,
    mint: reserveInfo.mint,
    amount: reserveInfo.tokenAmount.amount,
  },
  teamEscrow: {
    address: address("TEAM_ESCROW").toBase58(),
    owner: escrowInfo.owner,
    mint: escrowInfo.mint,
    amount: escrowInfo.tokenAmount.amount,
  },
}, null, 2));

function tokenInfo(response, name) {
  const info = response?.value?.data?.parsed?.info;
  if (!info?.mint || !info?.owner || !info?.tokenAmount?.amount) {
    throw new Error(`${name} is not a readable SPL token account`);
  }
  return info;
}
