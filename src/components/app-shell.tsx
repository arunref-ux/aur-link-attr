import { Link } from "@tanstack/react-router";
import {
  Activity,
  GitBranch,
  LayoutDashboard,
  Link2,
  Settings2,
  Target,
} from "lucide-react";
import type { ReactNode } from "react";
import { ThemeSwitcher } from "@/components/theme-switcher";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/campaigns", label: "Campaigns", icon: Target },
  { to: "/links", label: "Links", icon: Link2 },
  { to: "/conversions", label: "Conversions", icon: Activity },
  { to: "/trace", label: "Trace", icon: GitBranch },
  { to: "/configuration", label: "Configuration", icon: Settings2 },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="border-b border-sidebar-border bg-sidebar lg:w-64 lg:shrink-0 lg:border-r lg:border-b-0">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="grid size-9 place-items-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
            AU
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-semibold text-sidebar-foreground">
              Link &amp; Attribution
            </p>
            <p className="label-eyebrow">Aurumi Internal</p>
          </div>
          <ThemeSwitcher />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-6">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              activeProps={{
                className:
                  "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-[inset_2px_0_0_0_var(--color-sidebar-primary)]",
              }}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="hidden px-5 pb-6 lg:block">
          <div className="rounded-md border border-sidebar-border bg-sidebar-accent/40 p-3">
            <p className="label-eyebrow">Environment</p>
            <p className="mt-1.5 text-xs text-sidebar-foreground/80">
              Simulated providers active. Partner, demo and pricing data is referenced from external
              systems.
            </p>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-5 py-6 sm:px-8 sm:py-8">{children}</main>
    </div>
  );
}
