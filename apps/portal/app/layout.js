import "./styles.css";

export const metadata = {
  title: "CTF26 — Challenge room",
  description: "The live challenge board for the Superteam Solana Security CTF.",
  referrer: "no-referrer",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
