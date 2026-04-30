import type { Metadata, Viewport } from "next";
import "./globals.css";
import LayoutWrapper from "../components/LayoutWrapper";
import { APP_BG_COLOR } from "../constants/theme";

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
    <html lang="en">
      <body className="min-h-screen bg-white">
        <LayoutWrapper>
          {children}
        </LayoutWrapper>
      </body>
    </html>
  );
}
