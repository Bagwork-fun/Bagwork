"use client";

import { useRef } from "react";
import { NetworkOptions } from "./NetworkOptions";
import { useDisconnect } from "wagmi";
import { ArrowLeftOnRectangleIcon, ChevronDownIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useOutsideClick } from "~~/hooks/scaffold-eth";

export const WrongNetworkDropdown = () => {
  const { disconnect } = useDisconnect();
  const dropdownRef = useRef<HTMLDetailsElement>(null);

  const closeDropdown = () => {
    dropdownRef.current?.removeAttribute("open");
  };

  useOutsideClick(dropdownRef, closeDropdown);

  return (
    <details ref={dropdownRef} className="relative z-40 mr-2 leading-none">
      <summary className="list-none flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/15 px-2.5 py-1.5 text-sm font-semibold text-destructive shadow-sm hover:bg-destructive/25 cursor-pointer [&::-webkit-details-marker]:hidden">
        <ExclamationTriangleIcon className="size-4 shrink-0" />
        <span>Wrong network</span>
        <ChevronDownIcon className="size-4 shrink-0 ml-1" />
      </summary>
      <ul className="absolute right-0 z-50 mt-2 min-w-[14rem] rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg ring-1 ring-foreground/10">
        <NetworkOptions hidden={false} />
        <li className="list-none border-t border-border mt-2 pt-2">
          <button
            type="button"
            className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10 text-left"
            onClick={() => {
              disconnect();
              closeDropdown();
            }}
          >
            <ArrowLeftOnRectangleIcon className="size-4 shrink-0" />
            Disconnect
          </button>
        </li>
      </ul>
    </details>
  );
};
