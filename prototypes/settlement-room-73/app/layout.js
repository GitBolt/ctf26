import "./styles.css";

export const metadata = {
  title: "Settlement Room 73",
  description: "A Solana devnet settlement challenge.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

