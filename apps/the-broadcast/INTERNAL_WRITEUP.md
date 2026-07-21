# THE BROADCAST: organizer writeup

## Intended discovery

An accepted claim is deliberately not the completion condition. Every receipt is a Base58 protocol record that decodes to the same `video:<11-character ID>` shape. Six ordinary IDs lead to unlisted false-success videos; the distinguished ID leads to the winning video. The record deliberately does not identify YouTube, so recognizing the familiar 11-character alphabet and trying `youtu.be/<ID>` remains part of the solve.

The service verifies a Solana wallet's 64-byte Ed25519 signature with TweetNaCl, then deduplicates the raw signature bytes. TweetNaCl accepts non-canonical scalar encodings, so the same authorization has multiple accepted representations.

Split the signature into `R || S`, with two 32-byte halves. Interpret `S` as a little-endian integer and construct:

```text
R || S
R || (S + L)
R || (S + 2L)
...
```

where:

```text
L = 7237005577332262213973186563042994240857116359379907606001950938285454250989
```

For a canonical `S`, `k = 0..14` yields fifteen byte-distinct values that fit in the 32-byte scalar field and verify for the same wallet and instance message. Each claim needs a fresh body-bound PoW. The hidden participant threshold is stable in `[6,12]`, so the family always has enough variants.

## Why this version is fairer

- The signed message comes from a real Solana wallet and is bound to the portal participant instance.
- The first browser claim establishes the apparent-success trap and exposes a copyable authorization for experimentation.
- Receipt decoding yields an explicit `video:` clue without naming the platform. All six decoys and the winner share the same representation, preserving the original false-video layer.
- The editable claim workbench removes session-cookie and proof-of-work busywork without revealing which bytes to change.
- No hint text or hint endpoint exists in the participant service. Organizers deliver help manually, so unattended agents cannot poll their way to the construction.
- The portal reads authoritative participant completion from the challenge service.

## Organizer-only hint ladder

Deliver these verbally or on sealed physical cards. Do not paste them into the challenge service, portal, public repository description, or player package. A participant should request each level deliberately; event scoring may attach a time or point cost.

1. **Identity:** “What does the server appear to consider unique: the wallet, the authorization, or the submitted bytes?”
2. **Representation:** “Does one mathematical signature necessarily have only one byte representation?”
3. **Structure:** “An Ed25519 signature contains a point and a scalar. Which 32-byte half is the scalar?”
4. **Emergency construction:** “The scalar is interpreted modulo the group order. Read the last 32 bytes as little-endian `S`, keep `R` unchanged, and try `S + kL` for `k = 0..14`.”

Only level four should be accompanied by the `L` value and reference function below. The first three preserve the participant's reasoning work.

## Reference variant function

```js
function variant(signature, k) {
  const R = signature.slice(0, 32);
  let S = 0n;
  for (let i = 63; i >= 32; i--) S = (S << 8n) | BigInt(signature[i]);
  S += BigInt(k) * L;
  const out = new Uint8Array(64);
  out.set(R);
  for (let i = 32; i < 64; i++) { out[i] = Number(S & 255n); S >>= 8n; }
  return out;
}
```
