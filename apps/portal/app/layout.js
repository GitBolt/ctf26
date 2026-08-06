import "./styles.css";

export const metadata = {
  title: "stCTF · Public challenge archive",
  description: "Eleven open Solana security challenges from the Superteam in-person CTF.",
  referrer: "no-referrer",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
