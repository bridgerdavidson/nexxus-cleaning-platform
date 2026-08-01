import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import LayoutWrapper from "../components/LayoutWrapper";
import { APP_BG_COLOR } from "../constants/theme";
import { BRAND_BOOTSTRAP_SCRIPT } from "../lib/branding/bootstrapScript";

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

// Fallback metadata for every page that does not set its own, which means the
// homeowner, cleaner and operator dashboards as well as auth. So the title is
// the bare brand: those pages have a mixed audience, and a homeowner's tab
// should not read "Run your cleaning company". The landing page overrides this
// with the B2B line, because that is the one place the audience is known.
export const metadata: Metadata = {
  title: "Nexxus",
  description:
    "Bookings, crews, and payments in one place. The software cleaning companies run on.",
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
        {/* Replays the cached org brand ramp before anything below parses or
            paints, so returning users never flash the default Nexxus blue.
            Body-first-child rather than a hand-written <head>: the App Router
            owns <head> via the metadata API, and a synchronous script here
            still runs pre-paint. suppressHydrationWarning on <html> covers the
            mutated inline style. */}
        <script dangerouslySetInnerHTML={{ __html: BRAND_BOOTSTRAP_SCRIPT }} />
        <LayoutWrapper>
          {children}
        </LayoutWrapper>
      </body>
    </html>
  );
}
