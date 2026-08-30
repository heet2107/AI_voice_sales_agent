import type { Metadata } from "next";
import { Manrope, Newsreader } from "next/font/google";
import { loadBusinessProfile } from "@/lib/business-config";
import "./globals.css";

const sans = Manrope({ subsets: ["latin"], variable: "--font-sans" });
const serif = Newsreader({ subsets: ["latin"], variable: "--font-serif" });

const profile = loadBusinessProfile();

export const metadata: Metadata = {
  title: profile.branding.appName,
  description: `Private campaign operations and transcript intelligence dashboard for ${profile.company.name}.`,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${sans.variable} ${serif.variable}`}>{children}</body></html>;
}
