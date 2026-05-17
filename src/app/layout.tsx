import type { Metadata } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./Providers";
import MetaPixel from "./MetaPixel";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: {
    default: "Channel — Human Radio",
    template: "%s — Channel",
  },
  description: "Left-field electronic music from underground curators. No ads. No algorithms.",
  metadataBase: new URL("https://channel-app.com"),
  openGraph: {
    title: "Channel — Human Radio",
    description: "Left-field electronic music from underground curators. No ads. No algorithms.",
    type: "website",
    url: "https://channel-app.com",
    siteName: "Channel",
    images: [{ url: "/og-image.png", width: 600, height: 600, alt: "Channel" }],
  },
  twitter: {
    card: "summary",
    title: "Channel — Human Radio",
    description: "Left-field electronic music from underground curators. No ads. No algorithms.",
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
            gtag('config', 'AW-18093488515');
          `}
        </Script>
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <MetaPixel />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
