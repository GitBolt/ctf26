import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
} from "@solana/kit";
import {
  getMetadataAccountDataSerializer,
  MPL_TOKEN_METADATA_PROGRAM_ID,
} from "@metaplex-foundation/mpl-token-metadata";

export const OFFICIAL_NIGHT_NAME = "After Hours NIGHT";
export const OFFICIAL_NIGHT_SYMBOL = "NIGHT";
export const OFFICIAL_NIGHT_URI = "https://after-hours-production-159b.up.railway.app/night.json";

const metadataProgram = address(MPL_TOKEN_METADATA_PROGRAM_ID);
const addressEncoder = getAddressEncoder();
const utf8 = getUtf8Encoder();
const serializer = getMetadataAccountDataSerializer();

export async function readMetaplexBrand(rpc, mintValue) {
  const mint = address(String(mintValue));
  const [metadataAddress] = await getProgramDerivedAddress({
    programAddress: metadataProgram,
    seeds: [
      utf8.encode("metadata"),
      addressEncoder.encode(metadataProgram),
      addressEncoder.encode(mint),
    ],
  });
  const account = await rpc.call("getAccountInfo", [metadataAddress, {
    encoding: "base64",
    commitment: "finalized",
  }]);
  if (!account?.value || account.value.owner !== metadataProgram) return null;
  const encoded = Array.isArray(account.value.data) ? account.value.data[0] : account.value.data;
  if (typeof encoded !== "string") return null;
  try {
    const [metadata] = serializer.deserialize(new Uint8Array(Buffer.from(encoded, "base64")));
    if (String(metadata.mint) !== mint) return null;
    return Object.freeze({
      address: metadataAddress,
      mint,
      name: clean(metadata.name),
      symbol: clean(metadata.symbol),
      uri: clean(metadata.uri),
      isMutable: metadata.isMutable,
      tokenStandard: metadata.tokenStandard,
    });
  } catch {
    return null;
  }
}

export function hasOfficialNightBrand(metadata) {
  return metadata?.name === OFFICIAL_NIGHT_NAME && metadata?.symbol === OFFICIAL_NIGHT_SYMBOL;
}

function clean(value) {
  return String(value || "").replace(/\0+$/u, "").trim();
}
