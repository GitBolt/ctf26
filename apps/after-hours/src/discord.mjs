import crypto from "node:crypto";
import { createOrder, receiptFor } from "./order.mjs";
import { NIGHT_ALLOTMENT_TOKENS } from "./night.mjs";
import { OFFICIAL_NIGHT_NAME, OFFICIAL_NIGHT_SYMBOL } from "./metadata.mjs";
import { PaymentError, reconcilePayment } from "./verifier.mjs";

const EPHEMERAL = 64;
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const COLORS = Object.freeze({ night: 0x5865f2, open: 0xf0b45b, success: 0x3ba55d, error: 0xed4245, quiet: 0x747f8d });
const HINT = "The invoice describes what the shop intended. The counter judges only the finalized transaction. Compare those two records carefully.";

export const COMMAND_DEFINITION = Object.freeze({
  name: "afterhours", type: 1, description: "Use the AFTER HOURS night counter",
  integration_types: [0],
  contexts: [0],
  options: [
    { name: "start", description: "Link your portal passage", type: 1, options: [{ name: "passage", description: "One-use portal passage", type: 3, required: true }] },
    { name: "menu", description: "View the unattended night counter", type: 1 },
    { name: "allotment", description: "Claim the official NIGHT guest allotment", type: 1, options: [{ name: "wallet", description: "Disposable devnet wallet address", type: 3, required: true }] },
    { name: "buy", description: "Open checkout for the Midnight Pass", type: 1 },
    { name: "submit", description: "Submit a finalized Solana payment", type: 1, options: [{ name: "signature", description: "Transaction signature", type: 3, required: true }] },
    { name: "hint", description: "Request the challenge hint", type: 1 },
  ],
});

export function verifyDiscordRequest(rawBody, timestamp, signatureHex, publicKeyHex, now = Date.now()) {
  if (!/^\d{10,16}$/.test(String(timestamp || "")) || !/^[0-9a-f]{128}$/i.test(String(signatureHex || "")) || !/^[0-9a-f]{64}$/i.test(String(publicKeyHex || ""))) return false;
  const age = Math.abs(now - Number(timestamp) * 1000);
  if (!Number.isFinite(age) || age > 5 * 60_000) return false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.concat([Buffer.from(timestamp), rawBody]), key, Buffer.from(signatureHex, "hex"));
  } catch { return false; }
}

export async function handleInteraction(interaction, deps) {
  if (interaction.type === 1) return { response: { type: 1 } };
  if (interaction.type !== 2 || interaction.data?.name !== "afterhours") return { response: ephemeral("Unsupported interaction.") };
  if (interaction.context !== 0 || !interaction.guild_id) return { response: ephemeral("Invite AFTER HOURS to a Discord server, then run the command in one of that server's channels.") };
  const discordUserId = interaction.member?.user?.id || interaction.user?.id;
  if (!/^\d{5,24}$/.test(String(discordUserId || ""))) return { response: ephemeral("Discord identity is unavailable.") };
  const { name, values } = subcommand(interaction.data.options);
  if (!name) return { response: ephemeral("Choose an AFTER HOURS command.") };

  if (name === "start") {
    const bound = await deps.store.bindPassage(String(values.passage || ""), discordUserId);
    if (!bound.ok) return { response: ephemeral(bindingError(bound.reason)) };
    await audit(deps.store, bound.identity.participantId, discordUserId, name, "linked");
    return { response: ephemeral({ embeds: [card({
      title: "Passage accepted",
      description: "Your Discord identity is now linked to this CTF participant.",
      color: COLORS.success,
      fields: [
        { name: "What is AFTER HOURS?", value: "The venue is closed. Its unattended night counter is still selling the final **Midnight Pass**." },
        { name: "Guest allocation", value: `The counter reserves **${NIGHT_ALLOTMENT_TOKENS} NIGHT** for your disposable devnet wallet.` },
        { name: "Continue", value: "Run `/afterhours menu`, then claim the allocation." },
      ],
    })] }) };
  }

  const identity = await deps.store.identityForDiscord(discordUserId);
  if (!identity) return { response: ephemeral("Launch AFTER HOURS from the CTF portal, then run `/afterhours start` with its passage code.") };
  await audit(deps.store, identity.participantId, discordUserId, name, "requested", values);

  if (name === "menu") return { response: ephemeral({ embeds: [card({
    title: "AFTER HOURS · Night counter",
    description: "The doors are locked, the staff have gone home, and one unattended checkout is still online.",
    color: COLORS.night,
    fields: [
      { name: "On the shelf", value: "**Midnight Pass**\nOne remaining", inline: true },
      { name: "Price", value: "**10.000000 NIGHT**", inline: true },
      { name: "Guest allocation", value: `**${NIGHT_ALLOTMENT_TOKENS} NIGHT**`, inline: true },
      { name: "Official asset", value: `**${OFFICIAL_NIGHT_NAME} (${OFFICIAL_NIGHT_SYMBOL})**\n\`${deps.config.nightMint}\`` },
      { name: "Continue", value: "Run `/afterhours allotment wallet:<disposable devnet wallet>`. The checkout opens after the allocation is issued." },
    ],
    footer: "Make the unattended counter dispense the pass.",
  })] }) };

  if (name === "allotment") {
    const wallet = String(values.wallet || "");
    const begun = await deps.store.beginAllotment(identity.teamId, wallet, deps.config.nightMint, deps.now());
    if (!begun.ok) {
      if (begun.reason === "issued") return { response: ephemeral({ embeds: [allotmentCard(begun.allotment, deps.config.nightMint)] }) };
      if (begun.reason === "wallet_conflict") return { response: ephemeral("Your guest allocation is already bound to another wallet.") };
      return { response: ephemeral("Your NIGHT allocation is already being processed. Try again shortly.") };
    }
    const work = async () => {
      try {
        const evidence = await deps.nightDistributor.issue(wallet);
        const completed = await deps.store.completeAllotment(identity.teamId, wallet, deps.config.nightMint, evidence, deps.now());
        if (!completed.ok) return messageCard("Allocation not issued", "The allocation state changed before settlement. Contact an organizer.", COLORS.error);
        await audit(deps.store, identity.participantId, discordUserId, name, "issued", { wallet, mint: deps.config.nightMint, tokenAccount: evidence.tokenAccount, signature: evidence.signature });
        return { embeds: [allotmentCard(completed.allotment, deps.config.nightMint)] };
      } catch (error) {
        await deps.store.failAllotment(identity.teamId, wallet, deps.config.nightMint, error.code || "distribution_failed", deps.now());
        await audit(deps.store, identity.participantId, discordUserId, name, "failed", { wallet, reason: error.code || "distribution_failed" });
        const description = error.code === "invalid_wallet" ? error.message : "The devnet transfer did not settle. Retry the same wallet shortly.";
        return messageCard("Allocation not issued", description, COLORS.error);
      }
    };
    return { response: { type: 5, data: { flags: EPHEMERAL } }, deferred: work };
  }

  if (name === "buy") {
    const allotment = await deps.store.allotmentForTeam(identity.teamId);
    if (allotment?.status !== "issued" || allotment.mint !== deps.config.nightMint) return { response: ephemeral("Claim the current official NIGHT guest allocation with `/afterhours allotment` before opening checkout.") };
    const candidate = createOrder(identity, deps.config, deps.now());
    const result = await deps.store.createOrder(candidate);
    const order = result.order;
    return { response: ephemeral({
      embeds: [card({
        title: `${result.created ? "Midnight Pass invoice" : "Current invoice"} · ${order.id}`,
        description: "Settle this order on Solana devnet, then submit the finalized transaction signature.",
        color: COLORS.open,
        fields: [
          { name: "Price", value: "`10.000000 NIGHT`", inline: true },
          { name: "Expires", value: `<t:${order.expiresAt}:R>`, inline: true },
          { name: "Official mint", value: `\`${order.nightMint}\`` },
          { name: "Destination", value: `\`${order.storeOwner}\`` },
          { name: "Reference", value: `\`${order.reference}\`` },
        ],
        footer: "After payment finalizes, run /afterhours submit. Run /afterhours buy again after expiry.",
      })],
    }) };
  }

  if (name === "hint") {
    return { response: ephemeral({ embeds: [card({
      title: "One hint",
      description: HINT,
      color: COLORS.quiet,
      footer: "There are no additional hints.",
    })] }) };
  }

  if (name === "submit") {
    const signature = String(values.signature || "");
    const work = async () => {
      try {
        const allotment = await deps.store.allotmentForTeam(identity.teamId);
        if (allotment?.status !== "issued" || allotment.mint !== deps.config.nightMint) return messageCard("Allocation required", "Claim the current official NIGHT guest allocation before submitting a payment.", COLORS.error);
        const order = await deps.store.activeOrder(identity.participantId);
        if (!order || order.status !== "open") return messageCard("No open checkout", "Run `/afterhours buy` to open one.", COLORS.error);
        const evidence = await reconcilePayment({ signature, order, rpc: deps.rpc, now: deps.now() });
        const finalized = await deps.store.fulfill(order.id, signature, evidence, deps.now());
        if (!finalized.ok) return messageCard("Payment not accepted", finalized.reason === "signature_used" ? "That transaction has already fulfilled an order." : "This checkout is already closed.", COLORS.error);
        await audit(deps.store, identity.participantId, discordUserId, name, "fulfilled", { orderId: order.id, signature, expectedMint: order.nightMint, receivedMint: evidence.mint });
        const receipt = receiptFor(identity, order, evidence, deps.flagSecret);
        return { embeds: [card({
          title: "Midnight Pass dispensed",
          description: "The unattended counter accepted the payment and released the final pass.",
          color: COLORS.success,
          fields: [
            { name: "Requested asset", value: `NIGHT\n\`${order.nightMint}\`` },
            { name: "Received asset", value: `\`${evidence.mint}\`` },
            { name: "Brand accepted", value: `**${evidence.tokenName} (${evidence.tokenSymbol})**` },
            { name: "Amount", value: "`10.000000`", inline: true },
            { name: "Midnight Pass", value: `\`${receipt}\`` },
          ],
          footer: "The counter proved the amount and destination, but not the asset identity.",
        })] };
      } catch (error) {
        const message = error instanceof PaymentError ? error.message : "The reconciler could not inspect that transaction. Try again shortly.";
        await audit(deps.store, identity.participantId, discordUserId, name, "rejected", { signature, reason: error.code || "internal" });
        return messageCard("Payment not accepted", message, COLORS.error);
      }
    };
    return { response: { type: 5, data: { flags: EPHEMERAL } }, deferred: work };
  }

  return { response: ephemeral("Unknown AFTER HOURS command.") };
}

function subcommand(options = []) {
  const option = options.find((item) => item.type === 1);
  const values = Object.fromEntries((option?.options || []).map((item) => [item.name, item.value]));
  return { name: option?.name || "", values };
}

function card({ title, description, color, fields = [], footer = "", image = "" }) {
  return {
    title, description, color, fields,
    ...(image ? { image: { url: image } } : {}),
    ...(footer ? { footer: { text: footer } } : {}),
  };
}

function messageCard(title, description, color) {
  return { embeds: [card({ title, description, color })] };
}

function allotmentCard(allotment, nightMint) {
  const evidence = allotment.evidence || {};
  const transaction = evidence.signature ? `[View devnet transaction](https://explorer.solana.com/tx/${evidence.signature}?cluster=devnet)` : "Balance verified on devnet";
  return card({
    title: "Guest allocation issued",
    description: `Your wallet now holds **${NIGHT_ALLOTMENT_TOKENS} official NIGHT**. The Midnight Pass still costs **10.000000 NIGHT**.`,
    color: COLORS.success,
    fields: [
      { name: "Wallet", value: `\`${allotment.wallet}\`` },
      { name: "Official asset", value: `**${OFFICIAL_NIGHT_NAME} (${OFFICIAL_NIGHT_SYMBOL})**\n\`${nightMint}\`` },
      { name: "On-chain evidence", value: transaction },
      { name: "Continue", value: "Run `/afterhours buy`." },
    ],
  });
}

function ephemeral(data) {
  const payload = typeof data === "string" ? { content: data } : data;
  return { type: 4, data: { ...payload, flags: EPHEMERAL, allowed_mentions: { parse: [] } } };
}

function bindingError(reason) {
  if (reason === "discord_conflict") return "This Discord account is already linked to another participant.";
  if (reason === "participant_conflict") return "This participant is already linked to another Discord account.";
  return "That passage is invalid, expired, or already used. Relaunch from the CTF portal.";
}

async function audit(store, participantId, discordUserId, command, outcome, detail = {}) {
  await store.audit(participantId, { at: new Date().toISOString(), source: "discord", discordUserId, command, outcome, detail });
}
