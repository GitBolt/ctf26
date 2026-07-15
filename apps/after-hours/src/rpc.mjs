export function createRpc(url, fetchImpl = fetch) {
  const endpoint = new URL(url);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error("RPC URL must use HTTP(S)");
  let id = 0;
  return {
    async call(method, params) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST", signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        });
        if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);
        const body = await response.json();
        if (body.error) throw new Error(`RPC error: ${body.error.message || body.error.code}`);
        return body.result;
      } finally { clearTimeout(timeout); }
    },
  };
}
