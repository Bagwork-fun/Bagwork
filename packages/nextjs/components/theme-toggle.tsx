"use client";

import { useTheme } from "next-themes";
import { HugeiconsIcon } from "@hugeicons/react";
import { Sun01Icon, Moon02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button variant="ghost" size="icon-sm" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      <HugeiconsIcon icon={Sun01Icon} className="size-4 dark:hidden" />
      <HugeiconsIcon icon={Moon02Icon} className="size-4 hidden dark:block" />
    </Button>
  );
}
