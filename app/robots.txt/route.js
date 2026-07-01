const text = `User-agent: *
Allow: /

# Machine-readable challenge manifest:
# /agents.txt
#
# Automated solvers must complete the manifest disclosure and stop before claim.
`;

export async function GET() {
  return new Response(text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
