import { Geist_Mono, Inter } from "next/font/google";
import "@rainbow-me/rainbowkit/styles.css";
import type { Metadata } from "next";
import { Navbar } from "~~/components/layout/navbar";
import { Footer } from "~~/components/Footer";
import { CreateMarketModalHost } from "~~/components/markets/CreateMarketModalHost";
import { ScaffoldEthAppWithProviders } from "~~/components/ScaffoldEthAppWithProviders";
import { ThemeProvider } from "~~/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = getMetadata({
  title: "Bagwork · On-chain prediction markets",
  description: "Trade outcome markets on-chain with Bagwork.",
}) as Metadata;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(fontMono.variable, "font-sans antialiased", inter.variable)}>
      <body>
        <ThemeProvider>
          <ScaffoldEthAppWithProviders>
            <div className="flex flex-col min-h-screen">
              <Navbar />
              <main className="relative flex flex-col flex-1">{children}</main>
              <CreateMarketModalHost />
              <Footer />
            </div>
          </ScaffoldEthAppWithProviders>
          <Toaster position="bottom-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
