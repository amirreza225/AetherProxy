"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  MenuIcon,
  LayoutDashboard,
  Server,
  Radio,
  Users,
  BookMarked,
  GitBranch,
  BarChart2,
  Settings,
  Puzzle,
  LogOut,
} from "lucide-react";
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
  { href: "/dashboard",     key: "dashboard",     icon: LayoutDashboard },
  { href: "/nodes",         key: "nodes",         icon: Server },
  { href: "/inbounds",      key: "inbounds",      icon: Radio },
  { href: "/users",         key: "users",         icon: Users },
  { href: "/subscriptions", key: "subscriptions", icon: BookMarked },
  { href: "/routing",       key: "routing",       icon: GitBranch },
  { href: "/analytics",     key: "analytics",     icon: BarChart2 },
  { href: "/settings",      key: "settings",      icon: Settings },
  { href: "/plugins",       key: "plugins",       icon: Puzzle },
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
      {/* ── Mobile top bar ── */}
      <div className="flex items-center justify-between border-b bg-background px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-primary flex items-center justify-center">
            <Radio className="size-4 text-primary-foreground" />
          </div>
          <span className="text-base font-semibold tracking-tight">AetherProxy</span>
        </div>
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
                  {navItems.map(({ href, key, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                        isActive(href)
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {tNav(key as Parameters<typeof tNav>[0])}
                    </Link>
                  ))}
                </nav>
                <Separator className="my-3" />
                <Button variant="ghost" size="sm" className="w-full gap-2" onClick={handleLogout}>
                  <LogOut className="size-4" />
                  {tCommon("signOut")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ── Desktop sidebar ── */}
      <aside className="hidden h-full w-56 shrink-0 flex-col border-r bg-sidebar px-3 py-4 md:flex">
        {/* Logo */}
        <div className="mb-5 flex items-center gap-2.5 px-2">
          <div className="size-8 rounded-lg bg-primary flex items-center justify-center shadow-sm">
            <Radio className="size-4 text-primary-foreground" />
          </div>
          <span className="text-base font-semibold tracking-tight">AetherProxy</span>
        </div>

        <nav className="flex-1 space-y-0.5">
          {navItems.map(({ href, key, icon: Icon }) => (
            <Link key={href} href={href}>
              <span
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                  isActive(href)
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" />
                {tNav(key as Parameters<typeof tNav>[0])}
              </span>
            </Link>
          ))}
        </nav>

        <Separator className="my-3" />
        <LanguageToggleButton variant="ghost" size="sm" className="mb-1 gap-2" />
        <Button variant="ghost" size="sm" className="gap-2 justify-start" onClick={handleLogout}>
          <LogOut className="size-4" />
          {tCommon("signOut")}
        </Button>
      </aside>
    </>
  );
}
