import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./Providers";

export const metadata: Metadata = {
  title: "channel",
  description: "Ditch the algorithms. Stay in the know with the curators who move your world forward.",
  metadataBase: new URL("https://channel-app.com"),
  openGraph: {
    title: "channel",
    description: "Ditch the algorithms. Stay in the know with the curators who move your world forward.",
    type: "website",
    url: "https://channel-app.com",
  },
  twitter: {
    card: "summary",
    title: "channel",
    description: "Ditch the algorithms. Stay in the know with the curators who move your world forward.",
  },
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
    shortcut: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-501V8HWV5H"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-501V8HWV5H');
          `}
        </Script>
      </head>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
