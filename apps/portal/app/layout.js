import "./styles.css";

export const metadata = {
  metadataBase: new URL("https://superteamctf.vercel.app"),
  title: "Superteam CTF v2",
  description: "Play eleven live Solana security challenges.",
  referrer: "no-referrer",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Superteam CTF",
    title: "Superteam CTF v2",
    description: "Play eleven live Solana security challenges.",
    images: [
      {
        url: "/images/superteam-ctf-og-v1.png",
        width: 1200,
        height: 630,
        alt: "The Superteam CTF v2 challenge room",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Superteam CTF v2",
    description: "Play eleven live Solana security challenges.",
    images: ["/images/superteam-ctf-og-v1.png"],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
