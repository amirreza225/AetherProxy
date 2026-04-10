"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type LanguageToggleButtonProps = {
  className?: string;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon" | "icon-sm";
};

export function LanguageToggleButton({
  className,
  variant = "ghost",
  size = "sm",
}: LanguageToggleButtonProps) {
  const locale = useLocale();
  const router = useRouter();

  const nextLocale = locale === "fa" ? "en" : "fa";
  const label = locale === "fa" ? "English" : "فارسی";

  function handleToggle() {
    document.cookie = `aether_locale=${nextLocale}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={handleToggle}
    >
      {label}
    </Button>
  );
}
