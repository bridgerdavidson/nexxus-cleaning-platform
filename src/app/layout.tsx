import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import LayoutWrapper from "../components/LayoutWrapper";
import { APP_BG_COLOR } from "../constants/theme";

// Self-host Inter at build time instead of a render-blocking
// `@import url(fonts.googleapis.com...)` in globals.css. Eliminates an external
// request on the critical path and avoids the FOUT/layout-shift that blocked
// first paint. Exposed as a CSS variable consumed by globals.css.
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
  variable: "--font-inter",
});

// Redesign font. Self-hosted, exposed as --font-sans. Consumed only inside the
// .redesign scope (the /ui-kit gallery and, later, the redesign route tree),
// so legacy UI keeps Inter via --font-inter.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Nexxus Cleaning Solutions",
  description: "Professional cleaning services for your home and business",
  appleWebApp: {
    title: "Nexxus",
  },
};

export const viewport: Viewport = {
  themeColor: APP_BG_COLOR,
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // Helps prevent zooming on input focus in iOS
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-white">
        <LayoutWrapper>
          {children}
        </LayoutWrapper>
      </body>
    </html>
  );
}
