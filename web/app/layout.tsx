import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Providers } from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "arcmint.fun — Where the next winners launch",
  description: "Fair bonding curves, USDC fees, and DEX graduation on Arc Network.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="shell">
            <Nav />
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
