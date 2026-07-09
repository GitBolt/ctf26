import "./styles.css";

export const metadata = {
  title: "IMPRINT",
  description: "Passkey-gated Solana vault CTF",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
