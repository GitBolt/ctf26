import "./styles.css";

export const metadata = {
  title: "CTF26 Portal",
  description: "Registration and challenge launch portal for CTF26.",
  referrer: "no-referrer",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
