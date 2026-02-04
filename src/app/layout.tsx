import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./Providers";

export const metadata: Metadata = {
  title: "Never miss the DJs you care about.",
  description: "Never miss the DJs you care about.",
  metadataBase: new URL("https://channel-app.com"),
  openGraph: {
    title: "Never miss the DJs you care about.",
    description: "Never miss the DJs you care about.",
    type: "website",
    url: "https://channel-app.com",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Never miss the DJs you care about.",
    description: "Never miss the DJs you care about.",
    images: ["/og-image.png"],
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
