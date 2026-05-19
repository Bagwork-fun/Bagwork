import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "~~/components/theme-toggle";
import { SearchMarketsCommand } from "~~/components/layout/search-markets-command";
import { NavbarMoreDropdown } from "~~/components/layout/navbar-more-dropdown";
import { NavbarStableBalances } from "~~/components/layout/navbar-usdc-balance";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";

export function Navbar() {
  return (
    <header className="border-b bg-background">
      <nav className="flex flex-col gap-2 py-3 max-w-[90rem] mx-auto px-6 lg:flex-row lg:items-center lg:gap-4 lg:h-16 lg:py-0">
        <div className="flex items-center gap-4 shrink-0">
          <Link href="/" className="flex shrink-0 items-center text-foreground">
            {/* eslint-disable-next-line @next/next/no-img-element -- brand lockup (icon + wordmark) */}
            <img
              src="/bagwork-logo.png"
              alt="Bagwork"
              width={576}
              height={154}
              className="h-32 w-auto shrink-0 object-contain object-left"
            />
          </Link>
          <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground">
            <Link href="/portfolio" className="hover:text-foreground transition-colors">
              Portfolio
            </Link>
            <span className="text-border">·</span>
            <Link href="/deposit" className="hover:text-foreground transition-colors">
              Deposit
            </Link>
            <span className="text-border">·</span>
            <NavbarMoreDropdown className="text-xs" />
          </div>
        </div>

        <div className="flex-1 flex justify-center min-w-0 order-last lg:order-none">
          <SearchMarketsCommand />
        </div>

        <div className="flex items-center gap-2.5 shrink-0 justify-between sm:justify-end">
          <ThemeToggle />

          <Separator orientation="vertical" className="!h-5" />

          <NavbarStableBalances />
          <RainbowKitCustomConnectButton />
        </div>
      </nav>
    </header>
  );
}
