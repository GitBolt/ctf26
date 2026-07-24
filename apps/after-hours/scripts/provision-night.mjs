import {
  appendTransactionMessageInstructions,
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import {
  AuthorityType,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintToCheckedInstruction,
  getSetAuthorityInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createSignerFromKeypair, generateSigner, keypairIdentity, percentAmount } from "@metaplex-foundation/umi";
import { createFungible, mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";

const rpcUrl = required("SOLANA_RPC_URL");
const TOKEN_2022_PROGRAM_ADDRESS = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const secret = Buffer.from(required("AFTER_HOURS_NIGHT_TREASURY_KEYPAIR"), "base64");
if (secret.length !== 64) throw new Error("treasury keypair must encode 64 bytes");
const uri = required("OFFICIAL_NIGHT_URI");
const amount = BigInt(process.env.NIGHT_TOTAL_SUPPLY_BASE_UNITS || "1000000000");

const umi = createUmi(rpcUrl).use(mplTokenMetadata());
const umiTreasury = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(new Uint8Array(secret)));
const umiMint = generateSigner(umi);
umi.use(keypairIdentity(umiTreasury));
await createFungible(umi, {
  mint: umiMint,
  name: "After Hours NIGHT",
  symbol: "NIGHT",
  uri,
  sellerFeeBasisPoints: percentAmount(0),
  decimals: 6,
  isMutable: false,
}).sendAndConfirm(umi);

const rpc = createSolanaRpc(rpcUrl);
const treasury = await createKeyPairSignerFromBytes(new Uint8Array(secret));
const mint = await createKeyPairSignerFromBytes(umiMint.secretKey);
const account = await waitForMint(mint.address);
const tokenProgram = account.owner;
if (![TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS].includes(tokenProgram)) {
  throw new Error(`unsupported token program ${tokenProgram}`);
}
const [treasuryToken] = await findAssociatedTokenPda({ mint: mint.address, owner: treasury.address, tokenProgram });
await send([
  await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: treasury, ata: treasuryToken, owner: treasury.address, mint: mint.address, tokenProgram }),
  getMintToCheckedInstruction({ mint: mint.address, token: treasuryToken, mintAuthority: treasury, amount, decimals: 6 }, { programAddress: tokenProgram }),
  getSetAuthorityInstruction({ owned: mint.address, owner: treasury, authorityType: AuthorityType.MintTokens, newAuthority: null }, { programAddress: tokenProgram }),
  getSetAuthorityInstruction({ owned: mint.address, owner: treasury, authorityType: AuthorityType.FreezeAccount, newAuthority: null }, { programAddress: tokenProgram }),
]);

process.stdout.write(`${JSON.stringify({ mint: mint.address, tokenProgram, uri, amount: amount.toString() })}\n`);

async function send(instructions) {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(treasury, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
  );
  const transaction = await signTransactionMessageWithSigners(message);
  const signature = await rpc.sendTransaction(getBase64EncodedWireTransaction(transaction), { encoding: "base64", preflightCommitment: "confirmed" }).send();
  await wait(signature);
}

async function wait(signature) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const { value } = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send();
    if (value[0]?.err) throw new Error(`transaction failed: ${JSON.stringify(value[0].err)}`);
    if (["confirmed", "finalized"].includes(value[0]?.confirmationStatus)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("transaction confirmation timed out");
}

async function waitForMint(address) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const account = await rpc.getAccountInfo(address, { encoding: "base64", commitment: "confirmed" }).send();
    if (account.value?.owner) return account.value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("mint account was not visible after confirmation");
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
