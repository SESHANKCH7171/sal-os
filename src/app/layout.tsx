import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import NavigationHeader from "@/components/NavigationHeader";

export const metadata: Metadata = {
  title: "Seshank AI Labs OS — Executive Dispatch Center",
  description: "Private single-user growth, content & AI employee operating system for Seshank Chinnapotula",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#090A0F] text-slate-100 antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
        <div className="flex min-h-screen flex-col">
          <NavigationHeader />
          <main className="flex-1 px-4 py-6 md:px-8 max-w-7xl mx-auto w-full">
            {children}
          </main>
          <footer className="border-t border-[#1F2433] py-4 px-6 text-center text-xs text-slate-500 bg-[#0B0D14]/80">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
              <span>Seshank AI Labs OS &bull; Internal Dispatch Center</span>
              <span className="font-mono text-[11px] text-emerald-500/80 flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Single-User Lock Active (seshank@seshankailabs.com)
              </span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
