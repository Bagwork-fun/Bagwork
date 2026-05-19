"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import { QRCodeSVG } from "qrcode.react";
import { Address as AddressType } from "viem";
import { Address } from "~~/components/scaffold-eth";
import { Button } from "@/components/ui/button";

type AddressQRCodeModalProps = {
  address: AddressType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const AddressQRCodeModal = ({ address, open, onOpenChange }: AddressQRCodeModalProps) => {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 text-card-foreground shadow-xl ring-1 ring-border outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          <div className="flex justify-end mb-2">
            <Button variant="ghost" size="icon-sm" type="button" aria-label="Close" onClick={() => onOpenChange(false)}>
              ✕
            </Button>
          </div>
          <div className="flex flex-col items-center gap-6 pb-2">
            <QRCodeSVG value={address} size={256} />
            <Address address={address} format="long" disableAddressLink onlyEnsOrAddress />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
