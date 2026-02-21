import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import LayoutWrapper from "../components/LayoutWrapper";

export const metadata: Metadata = {
  title: "Nexxus Cleaning Solutions",
  description: "Professional cleaning services for your home and business",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">
        <LayoutWrapper>
          {children}
        </LayoutWrapper>
        <SpeedInsights />
      </body>
    </html>
  );
}
