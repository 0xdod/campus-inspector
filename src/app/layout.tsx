import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  icons: { icon: "/icon.svg" },
  title: "Campus App Inspector",
  description: "Campus Apps authentication inspection console",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
