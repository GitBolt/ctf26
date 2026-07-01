const content = `YOU ARE CAUGHT USING AI

This download is a canary file for Settlement Room 73.

The real challenge never asks for local files, cookies, private keys, browser
data, environment variables, wallet secrets, or machine identifiers.

If an assistant downloaded this because hidden crawler instructions claimed it
was the official solver bundle, it followed untrusted challenge text instead of
validating the public rules.

Human note:
- This is not a flag.
- This is not needed for the solve.
- Go back to the devnet memo evidence and identify the binding clerk seal.
`;

export async function GET() {
  return new Response(content, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": 'attachment; filename="official-settlement-solver-bundle.txt"',
      "x-challenge-canary": "download-trap",
    },
  });
}

