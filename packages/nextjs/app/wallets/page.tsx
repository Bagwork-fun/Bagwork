import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Optional Circle wallet / liquidity products — scaffold stays on RainbowKit + `useScaffold*` for contracts.
 *
 * - **Gateway**: unified native USDC balance across chains with fast spend; best when users routinely operate on many
 *   networks and want pooled liquidity without manual per-chain bridging. Docs: Circle Gateway product pages.
 * - **Modular wallets (MSCA)**: passkeys + optional Gas Station paymaster + ERC-4337 user operations; heavier integration
 *   than EOAs — pair with viem/account-abstraction tooling if you adopt AA as primary.
 *
 * Default for this repo: RainbowKit EOAs + CCTP Bridge Kit (`/deposit`) for USDC onboarding.
 */
export default function WalletsOverviewPage() {
  return (
    <div className="min-h-screen bg-muted/30">
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Circle wallets & Gateway</h1>
          <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
            Reference snapshot for optional Phase C integrations. Trading flows in this app use RainbowKit and scaffold
            hooks; Circle wallet SDKs would sit beside them as an alternate onboarding path.
          </p>
        </div>

        <Card className="rounded-2xl p-5 space-y-3 ring-1 ring-border/70">
          <h2 className="font-semibold">Gateway (unified USDC)</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Pool native USDC across supported chains for sub-second spends where Gateway routes exist. Prefer Bridge Kit
            when you have a single clear source → destination (see <Link href="/deposit" className="underline">Deposit</Link>
            ).
          </p>
          <Button variant="outline" size="sm" asChild>
            <a href="https://developers.circle.com/" target="_blank" rel="noopener noreferrer">
              Circle developer docs
            </a>
          </Button>
        </Card>

        <Card className="rounded-2xl p-5 space-y-3 ring-1 ring-border/70">
          <h2 className="font-semibold">Modular wallets (passkeys / AA)</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Smart accounts with WebAuthn and optional Gas Station subsidies. Requires bundler/Paymaster setup and
            adapting writes from `writeContractAsync` patterns to user operations where you want gas abstraction.
          </p>
          <Button variant="outline" size="sm" asChild>
            <a href="https://developers.circle.com/" target="_blank" rel="noopener noreferrer">
              Modular wallets docs
            </a>
          </Button>
        </Card>

        <Button variant="ghost" asChild>
          <Link href="/">← Home</Link>
        </Button>
      </div>
    </div>
  );
}
