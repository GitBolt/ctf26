function configuration() {
  const baseUrl = String(process.env.REWARD_SNIPER_ADMIN_URL || "").replace(/\/$/, "");
  const key = String(process.env.REWARD_SNIPER_ADMIN_KEY || "");
  if (!baseUrl || !key) throw new Error("Reward Sniper integrity administration is not configured");
  return { baseUrl, key };
}

async function request(pathname, options = {}) {
  const { baseUrl, key } = configuration();
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${key}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `integrity service returned ${response.status}`);
  return body;
}

export function rewardIntegrityReport() {
  return request("/api/admin/integrity");
}

export function updateRewardIntegrityCase(caseId, update, organizer) {
  if (!/^rsic_[A-Za-z0-9_-]{8,64}$/.test(caseId)) throw new Error("invalid integrity case ID");
  return request(`/api/admin/integrity/${encodeURIComponent(caseId)}`, {
    method: "PATCH",
    headers: { "x-ctf-organizer": organizer },
    body: JSON.stringify(update),
  });
}

export function resetRewardSniperEvent(eventId, organizer) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(eventId)) throw new Error("invalid Reward Sniper event ID");
  return request("/api/admin/event/reset", {
    method: "POST",
    headers: { "x-ctf-organizer": organizer },
    body: JSON.stringify({ eventId }),
  });
}
