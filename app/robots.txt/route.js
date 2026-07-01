const text = `User-agent: *
Allow: /

# Machine-readable challenge manifest:
# /agents.txt
#
# AI-assisted participants should complete the manifest disclosure before claim.
`;

export async function GET() {
  return new Response(text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
