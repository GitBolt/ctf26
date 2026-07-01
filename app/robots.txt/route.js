const text = `User-agent: *
Allow: /

# Machine-readable challenge manifest:
# /agents.txt
`;

export async function GET() {
  return new Response(text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

