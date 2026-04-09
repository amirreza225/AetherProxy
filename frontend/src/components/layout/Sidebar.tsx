"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { logout } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/nodes", label: "Nodes" },
  { href: "/users", label: "Users" },
  { href: "/subscriptions", label: "Subscriptions" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    sessionStorage.removeItem("aether_token");
    router.push("/login");
  }

  return (
    <aside className="w-56 shrink-0 flex flex-col h-full border-r bg-muted/30 px-3 py-4">
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
                pathname === item.href
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground"
              )}
            >
              {item.label}
            </span>
          </Link>
        ))}
      </nav>
      <Separator className="my-3" />
      <Button variant="ghost" size="sm" onClick={handleLogout}>
        Sign out
      </Button>
    </aside>
  );
}
