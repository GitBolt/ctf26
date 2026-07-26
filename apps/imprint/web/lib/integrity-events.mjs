import { forwardIntegrityEvent } from "@ctf26/agent-integrity";

export async function recordImprintIntegrity(
  identity,
  action,
  category,
  request,
  source = "direct-http"
) {
  await forwardIntegrityEvent({
    identity: { ...identity, eventId: identity.eventId },
    challenge: "imprint",
    label: "IMPRINT",
    action,
    category,
    source,
    request,
  }).catch((error) =>
    console.warn("IMPRINT integrity event deferred", error.message)
  );
}
