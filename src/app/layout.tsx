import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "kimitui",
  description: "Terminal chat interface for AI models",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
