import type { Metadata, Viewport } from "next";
import "./globals.css";
import LayoutWrapper from "../components/LayoutWrapper";

export const metadata: Metadata = {
  title: "Nexxus Cleaning Solutions",
  description: "Professional cleaning services for your home and business",
  appleWebApp: {
    title: "Nexxus",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#f9fafb", // Matches Tailwind bg-gray-50
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
      <body className="min-h-screen bg-gray-50">
        <LayoutWrapper>
          {children}
        </LayoutWrapper>
      </body>
    </html>
  );
}
