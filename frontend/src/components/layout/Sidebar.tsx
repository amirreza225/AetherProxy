"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { MenuIcon } from "lucide-react";
import { clearClientAuthToken, logout } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LanguageToggleButton } from "@/components/layout/LanguageToggleButton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const navItems = [
  { href: "/dashboard", key: "dashboard" },
  { href: "/nodes", key: "nodes" },
  { href: "/users", key: "users" },
  { href: "/subscriptions", key: "subscriptions" },
  { href: "/routing", key: "routing" },
  { href: "/analytics", key: "analytics" },
  { href: "/settings", key: "settings" },
  { href: "/plugins", key: "plugins" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const [mobileOpen, setMobileOpen] = useState(false);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      clearClientAuthToken();
    }
    setMobileOpen(false);
    router.push("/login");
  }

  return (
    <>
      <div className="flex items-center justify-between border-b bg-background px-4 py-3 md:hidden">
        <div className="text-base font-semibold tracking-tight">AetherProxy</div>
        <div className="flex items-center gap-2">
          <LanguageToggleButton variant="outline" size="sm" />
          <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
            <DialogTrigger
              render={<Button variant="outline" size="icon-sm" aria-label={tCommon("menu")} />}
            >
              <MenuIcon />
            </DialogTrigger>
            <DialogContent className="max-w-sm p-0" showCloseButton={false}>
              <DialogHeader className="border-b px-4 py-3">
                <DialogTitle>AetherProxy</DialogTitle>
              </DialogHeader>
              <div className="p-3">
                <nav className="space-y-1">
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "block rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                        isActive(item.href)
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      {tNav(item.key as Parameters<typeof tNav>[0])}
                    </Link>
                  ))}
                </nav>
                <Separator className="my-3" />
                <Button variant="ghost" size="sm" className="w-full" onClick={handleLogout}>
                  {tCommon("signOut")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <aside className="hidden h-full w-56 shrink-0 flex-col border-r bg-muted/30 px-3 py-4 md:flex">
        <div className="mb-4 px-2 text-lg font-semibold tracking-tight">
          AetherProxy
        </div>
        <Separator className="mb-3" />
        <nav className="flex-1 space-y-1">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <span
                className={cn(
                  "block rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                  isActive(item.href)
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground"
                )}
              >
                {tNav(item.key as Parameters<typeof tNav>[0])}
              </span>
            </Link>
          ))}
        </nav>
        <Separator className="my-3" />
        <LanguageToggleButton variant="ghost" size="sm" className="mb-2" />
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          {tCommon("signOut")}
        </Button>
      </aside>
    </>
  );
}
