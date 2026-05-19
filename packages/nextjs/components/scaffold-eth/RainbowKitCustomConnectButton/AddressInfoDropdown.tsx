import { useRef, useState } from "react";
import { NetworkOptions } from "./NetworkOptions";
import { getAddress, type Address } from "viem";
import { useDisconnect } from "wagmi";
import {
  ArrowLeftOnRectangleIcon,
  ArrowTopRightOnSquareIcon,
  ArrowsRightLeftIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  DocumentDuplicateIcon,
  QrCodeIcon,
} from "@heroicons/react/24/outline";
import { BlockieAvatar, isENS } from "~~/components/scaffold-eth";
import { useCopyToClipboard, useOutsideClick } from "~~/hooks/scaffold-eth";
import { getTargetNetworks } from "~~/utils/scaffold-eth";

const allowedNetworks = getTargetNetworks();

type AddressInfoDropdownProps = {
  address: Address;
  blockExplorerAddressLink: string | undefined;
  displayName: string;
  ensAvatar?: string;
  onShowQr?: () => void;
};

export const AddressInfoDropdown = ({
  address,
  ensAvatar,
  displayName,
  blockExplorerAddressLink,
  onShowQr,
}: AddressInfoDropdownProps) => {
  const { disconnect } = useDisconnect();
  const checkSumAddress = getAddress(address);

  const { copyToClipboard: copyAddressToClipboard, isCopiedToClipboard: isAddressCopiedToClipboard } =
    useCopyToClipboard();
  const [selectingNetwork, setSelectingNetwork] = useState(false);
  const dropdownRef = useRef<HTMLDetailsElement>(null);

  const closeDropdown = () => {
    setSelectingNetwork(false);
    dropdownRef.current?.removeAttribute("open");
  };

  useOutsideClick(dropdownRef, closeDropdown);

  return (
    <details ref={dropdownRef} className="relative z-40 leading-none">
      <summary className="list-none flex items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2 py-1 text-sm font-medium cursor-pointer shadow-sm hover:bg-muted [&::-webkit-details-marker]:hidden">
        <BlockieAvatar address={checkSumAddress} size={30} ensImage={ensAvatar} />
        <span className="max-w-[7rem] truncate">
          {isENS(displayName) ? displayName : checkSumAddress.slice(0, 6) + "…" + checkSumAddress.slice(-4)}
        </span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </summary>
      <ul className="absolute right-0 z-50 mt-2 min-w-[14rem] rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg ring-1 ring-foreground/10">
        <NetworkOptions hidden={!selectingNetwork} />
        {!selectingNetwork && (
          <>
            <li className="list-none">
              <button
                type="button"
                className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted text-left"
                onClick={() => copyAddressToClipboard(checkSumAddress)}
              >
                {isAddressCopiedToClipboard ? (
                  <>
                    <CheckCircleIcon className="size-4 shrink-0" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <DocumentDuplicateIcon className="size-4 shrink-0" />
                    <span>Copy address</span>
                  </>
                )}
              </button>
            </li>
            <li className="list-none">
              <button
                type="button"
                className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted text-left"
                onClick={() => {
                  closeDropdown();
                  onShowQr?.();
                }}
              >
                <QrCodeIcon className="size-4 shrink-0" />
                View QR code
              </button>
            </li>
            <li className="list-none">
              <a
                target="_blank"
                href={blockExplorerAddressLink}
                rel="noopener noreferrer"
                className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
              >
                <ArrowTopRightOnSquareIcon className="size-4 shrink-0" />
                <span className="whitespace-nowrap">Block explorer</span>
              </a>
            </li>
            {allowedNetworks.length > 1 ? (
              <li className="list-none">
                <button
                  type="button"
                  className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted text-left"
                  onClick={() => setSelectingNetwork(true)}
                >
                  <ArrowsRightLeftIcon className="size-4 shrink-0" /> <span>Switch network</span>
                </button>
              </li>
            ) : null}
            <li className="list-none">
              <button
                type="button"
                className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-destructive/10 text-destructive text-left"
                onClick={() => disconnect()}
              >
                <ArrowLeftOnRectangleIcon className="size-4 shrink-0" /> <span>Disconnect</span>
              </button>
            </li>
          </>
        )}
      </ul>
    </details>
  );
};
