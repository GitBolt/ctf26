import { Connection, PublicKey } from "@solana/web3.js";

const rpc = process.env.EVIDENCE_ROOM_RPC;
const accounts = process.argv.slice(2);
if (!rpc || accounts.length === 0) {
  console.error("Usage: EVIDENCE_ROOM_RPC=https://... node observer.mjs <account> [account...]");
  process.exit(1);
}
const connection = new Connection(rpc, "confirmed");
for (const address of accounts) {
  const info = await connection.getAccountInfo(new PublicKey(address), "confirmed");
  if (!info) { console.log(`${address}  missing`); continue; }
  const state = info.data.length === 165 ? info.data[108] : null;
  console.log(JSON.stringify({ address, owner: info.owner.toBase58(), lamports: info.lamports, dataLength: info.data.length, tokenState: state }, null, 2));
}
