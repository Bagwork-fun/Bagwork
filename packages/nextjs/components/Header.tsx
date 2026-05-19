"use client";

import React, { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { hardhat } from "viem/chains";
import { Bars3Icon, BugAntIcon } from "@heroicons/react/24/outline";
import { BanknotesIcon, EyeIcon, UserIcon, HomeIcon } from "@heroicons/react/24/outline";
import { FaucetButton, RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useOutsideClick, useTargetNetwork } from "~~/hooks/scaffold-eth";

type HeaderMenuLink = {
  label: string;
  href: string;
  icon?: React.ReactNode;
};

export const menuLinks: HeaderMenuLink[] = [
  {
    label: "Markets",
    href: "/markets",
    icon: <UserIcon className="size-4" />,
  },
  {
    label: "Provide Liquidity",
    href: "/liquidity-provider",
    icon: <BanknotesIcon className="size-4" />,
  },
  {
    label: "Oracle",
    href: "/oracle",
    icon: <EyeIcon className="size-4" />,
  },
  {
    label: "Debug",
    href: "/debug",
    icon: <BugAntIcon className="size-4" />,
  },
];

export const HeaderMenuLinks = () => {
  const pathname = usePathname();

  return (
    <>
      {menuLinks.map(({ label, href, icon }) => {
        const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));
        return (
          <li key={href}>
            <Link
              href={href}
              passHref
              className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors rounded-lg ${
                isActive 
                  ? "bg-base-200 text-base-content" 
                  : "text-base-content/60 hover:bg-base-200/50 hover:text-base-content"
              }`}
            >
              {icon}
              <span>{label}</span>
            </Link>
          </li>
        );
      })}
    </>
  );
};

export const Header = () => {
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;

  const burgerMenuRef = useRef<HTMLDetailsElement>(null);
  useOutsideClick(burgerMenuRef, () => {
    burgerMenuRef?.current?.removeAttribute("open");
  });

  return (
    <header className="sticky top-0 z-50 w-full border-b border-base-300 bg-base-100/80 backdrop-blur-md">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6 max-w-[90rem] mx-auto">
        
        {/* Left section */}
        <div className="flex items-center gap-6">
          {/* Mobile menu */}
          <details className="dropdown lg:hidden" ref={burgerMenuRef}>
            <summary className="btn btn-ghost btn-sm btn-circle">
              <Bars3Icon className="size-5" />
            </summary>
            <ul
              className="menu dropdown-content mt-3 p-2 shadow-lg bg-base-100 rounded-xl w-52 border border-base-300"
              onClick={() => {
                burgerMenuRef?.current?.removeAttribute("open");
              }}
            >
              <HeaderMenuLinks />
            </ul>
          </details>

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="flex relative size-8 items-center justify-center bg-primary text-primary-content rounded-lg font-bold text-lg group-hover:scale-105 transition-transform">
              🔮
            </div>
            <span className="font-semibold tracking-tight text-lg hidden sm:block">Predict</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:block">
            <ul className="flex items-center gap-1">
              <HeaderMenuLinks />
            </ul>
          </nav>
        </div>

        {/* Right section */}
        <div className="flex items-center gap-3">
          <RainbowKitCustomConnectButton />
          {isLocalNetwork && <FaucetButton />}
        </div>
      </div>
    </header>
  );
};
