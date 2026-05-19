import { useTheme } from "next-themes";
import { useAccount, useSwitchChain } from "wagmi";
import { ArrowsRightLeftIcon } from "@heroicons/react/24/solid";
import { getNetworkColor } from "~~/hooks/scaffold-eth";
import { getTargetNetworks } from "~~/utils/scaffold-eth";

const allowedNetworks = getTargetNetworks();

type NetworkOptionsProps = {
  hidden?: boolean;
};

export const NetworkOptions = ({ hidden = false }: NetworkOptionsProps) => {
  const { switchChain } = useSwitchChain();
  const { chain } = useAccount();
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === "dark";

  return (
    <>
      {allowedNetworks
        .filter(allowedNetwork => allowedNetwork.id !== chain?.id)
        .map(allowedNetwork => (
          <li key={allowedNetwork.id} className={hidden ? "hidden" : "list-none"}>
            <button
              type="button"
              className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted text-left whitespace-nowrap"
              onClick={() => switchChain?.({ chainId: allowedNetwork.id })}
            >
              <ArrowsRightLeftIcon className="size-4 shrink-0" />
              <span>
                Switch to{" "}
                <span style={{ color: getNetworkColor(allowedNetwork, isDarkMode) }}>{allowedNetwork.name}</span>
              </span>
            </button>
          </li>
        ))}
    </>
  );
};
