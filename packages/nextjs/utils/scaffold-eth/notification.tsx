import React from "react";
import { toast } from "sonner";

type NotificationOptions = {
  duration?: number;
  icon?: string;
};

/**
 * Scaffold transaction / contract notifications backed by Sonner (starter-kit-aligned).
 */
export const notification = {
  success: (content: React.ReactNode, options?: NotificationOptions) =>
    toast.success(content, {
      duration: options?.duration ?? 3000,
    }),

  info: (content: React.ReactNode, options?: NotificationOptions) =>
    toast.info(content, {
      duration: options?.duration ?? 3000,
    }),

  warning: (content: React.ReactNode, options?: NotificationOptions) =>
    toast.warning(content, {
      duration: options?.duration ?? 4000,
    }),

  error: (content: React.ReactNode, options?: NotificationOptions) =>
    toast.error(content, {
      duration: options?.duration ?? 5000,
    }),

  loading: (content: React.ReactNode) => toast.loading(content),

  remove: (toastId?: string | number) => {
    if (toastId !== undefined && toastId !== null) {
      toast.dismiss(toastId);
    }
  },
};
