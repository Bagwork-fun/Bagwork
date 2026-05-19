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
      <nav className="flex flex-col gap-2 py-3 max-w-[90rem] mx-auto px-4 sm:px-6 lg:flex-row lg:items-center lg:gap-4 lg:h-16 lg:py-0">
        <div className="flex w-full items-center justify-between gap-3 lg:contents">
          <div className="flex min-h-10 items-center gap-4 shrink-0">
            <Link href="/" className="flex shrink-0 items-center text-foreground">
              {/* eslint-disable-next-line @next/next/no-img-element -- compact backpack icon (mobile) */}
              <img
                src="/logo3.png"
                alt="Bagwork"
                width={36}
                height={36}
                className="h-9 w-9 shrink-0 object-contain sm:hidden"
              />
              {/* eslint-disable-next-line @next/next/no-img-element -- full wordmark (tablet+) */}
              <img
                src="/bagwork-logo.png"
                alt="Bagwork"
                width={576}
                height={154}
                className="hidden h-8 w-auto max-w-[min(100%,220px)] shrink-0 object-contain object-left sm:block lg:h-9"
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

          <div className="flex items-center gap-2.5 shrink-0">
            <ThemeToggle />
            <Separator orientation="vertical" className="!h-5" />
            <NavbarStableBalances />
            <RainbowKitCustomConnectButton />
          </div>
        </div>

        <div className="flex min-w-0 flex-1 justify-center order-last lg:order-none">
          <SearchMarketsCommand />
        </div>
      </nav>
    </header>
  );
}
