"use client";

import { MarketFeed } from "~~/components/markets/MarketFeed";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-[90rem] px-6 py-6 w-full flex-1">
      <MarketFeed />
    </div>
  );
}
