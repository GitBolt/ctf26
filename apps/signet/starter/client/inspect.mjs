import { Connection } from "@solana/web3.js";
import { address, required } from "./config.mjs";

const connection = new Connection(required("SOLANA_RPC_URL"), "confirmed");
const [program, vault, reserve, escrow] = await Promise.all([
  connection.getAccountInfo(address("VAULT_PROGRAM_ID")),
  connection.getAccountInfo(address("VAULT_ACCOUNT")),
  connection.getParsedAccountInfo(address("RESERVE_ACCOUNT")),
  connection.getParsedAccountInfo(address("PARTICIPANT_ESCROW")),
]);

const reserveInfo = tokenInfo(reserve, "RESERVE_ACCOUNT");
const escrowInfo = tokenInfo(escrow, "PARTICIPANT_ESCROW");
console.log(JSON.stringify({
  programExecutable: program?.executable ?? false,
  vaultOwner: vault?.owner?.toBase58() ?? null,
  reserve: {
    address: address("RESERVE_ACCOUNT").toBase58(),
    owner: reserveInfo.owner,
    mint: reserveInfo.mint,
    amount: reserveInfo.tokenAmount.amount,
  },
  participantEscrow: {
    address: address("PARTICIPANT_ESCROW").toBase58(),
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
