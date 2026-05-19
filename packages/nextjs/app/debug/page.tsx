import { DebugContracts } from "./_components/DebugContracts";
import type { NextPage } from "next";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

export const metadata = getMetadata({
  title: "Debug Contracts",
  description: "Debug your deployed 🏗 Scaffold-ETH 2 contracts in an easy way",
});

const Debug: NextPage = () => {
  return (
    <>
      <DebugContracts />
      <div className="text-center mt-8 rounded-2xl border border-border bg-muted/40 px-10 py-10">
        <h1 className="text-4xl my-0">Debug Contracts</h1>
        <p className="text-muted-foreground">
          You can debug & interact with your deployed contracts here.
          <br /> Check{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono font-bold [word-spacing:-0.35rem]">
            packages / nextjs / app / debug / page.tsx
          </code>{" "}
        </p>
      </div>
    </>
  );
};

export default Debug;
