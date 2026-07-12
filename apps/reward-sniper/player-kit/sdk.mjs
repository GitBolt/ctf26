export class RewardSniperClient {
  constructor({ baseUrl = globalThis.location?.origin, searcherToken } = {}) {
    if (!baseUrl) throw new Error("baseUrl is required outside a browser");
    this.baseUrl = new URL(baseUrl);
    this.searcherToken = searcherToken;
  }

  market() {
    return this.#request("/api/market");
  }

  scoreboard() {
    return this.#request("/api/scoreboard", { authenticated: false });
  }

  async lockTicket({ binId, liquidity, nonce = crypto.randomUUID() }) {
    const locked = await this.#request("/api/order", {
      method: "POST",
      body: { type: "ticket", binId, liquidity, nonce },
    });
    return { ...locked, nonce };
  }

  async lockSwap({ binId, nonce = crypto.randomUUID() }) {
    const locked = await this.#request("/api/order", {
      method: "POST",
      body: { type: "swap", binId, nonce },
    });
    return { ...locked, nonce };
  }

  reveal(lockedOrder) {
    if (!lockedOrder?.action || !lockedOrder?.nonce) {
      throw new Error("reveal requires the complete value returned by lockTicket or lockSwap");
    }
    return this.#request("/api/reveal", {
      method: "POST",
      body: { action: lockedOrder.action, nonce: lockedOrder.nonce },
    });
  }

  async #request(pathname, options = {}) {
    const headers = options.body ? { "content-type": "application/json" } : {};
    if (options.authenticated !== false && this.searcherToken) {
      headers.authorization = `Bearer ${this.searcherToken}`;
    }
    const response = await fetch(new URL(pathname, this.baseUrl), {
      method: options.method ?? "GET",
      headers,
      credentials: "include",
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `request failed (${response.status})`);
    return payload;
  }
}
