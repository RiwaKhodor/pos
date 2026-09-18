"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Role } from "@/lib/roles";

type NavUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

type MenuItem = {
  label: string;
  href?: string;
  action?: "logout";
  divider?: boolean;
};

type MenuGroup = {
  label: string;
  items: MenuItem[];
};

const OWNER_MENUS: MenuGroup[] = [
  {
    label: "File",
    items: [
      { label: "Preferences", href: "/settings" },
      { label: "Payment Methods", href: "/payment-methods" },
      { label: "Cashiers", href: "/employees" },
      { divider: true, label: "" },
      { label: "Switch User / Exit", action: "logout" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "List Of Items", href: "/items" },
      { label: "New Item", href: "/items/new" },
      { label: "Containers", href: "/items/containers" },
      { label: "Container Customs Duty", href: "/items/container-customs" },
      { label: "Categories", href: "/categories" },
      { label: "Stock Adjust", href: "/inventory" },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "List Of Sales", href: "/sales" },
      { label: "My Sales", href: "/my-sales" },
    ],
  },
  {
    label: "Daily Transactions",
    items: [{ label: "Expenses", href: "/expenses" }],
  },
  {
    label: "Daily Reports",
    items: [
      { label: "Profit & Loss Report", href: "/reports/profit-loss" },
      { label: "Sales Statistics", href: "/reports/sales-statistics" },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "Profit & Loss Report", href: "/reports/profit-loss" },
      { label: "Sales Statistics", href: "/reports/sales-statistics" },
    ],
  },
  {
    label: "POS",
    items: [{ label: "Open POS", href: "/pos" }],
  },
  {
    label: "Tools",
    items: [{ label: "Switch User", action: "logout" }],
  },
];

const EMPLOYEE_MENUS: MenuGroup[] = [
  {
    label: "Sales",
    items: [{ label: "My Sales", href: "/my-sales" }],
  },
  {
    label: "POS",
    items: [{ label: "Open POS", href: "/pos" }],
  },
  {
    label: "Tools",
    items: [{ label: "Switch User", action: "logout" }],
  },
];

const TAB_META: { match: (path: string) => boolean; href: string; title: string }[] =
  [
    { match: (p) => p === "/owner" || p === "/home", href: "/owner", title: "Home" },
    { match: (p) => p === "/items" || p.startsWith("/items?"), href: "/items", title: "List of Items" },
    { match: (p) => p === "/items/new", href: "/items/new", title: "New Item" },
    {
      match: (p) =>
        p === "/items/containers" || p.startsWith("/items/containers?"),
      href: "/items/containers",
      title: "Containers",
    },
    {
      match: (p) => p === "/items/containers/new",
      href: "/items/containers/new",
      title: "New Container",
    },
    {
      match: (p) =>
        p.startsWith("/items/containers/") && p !== "/items/containers/new",
      href: "/items/containers",
      title: "Edit Container",
    },
    {
      match: (p) => p.startsWith("/items/container-customs"),
      href: "/items/container-customs",
      title: "Container Customs",
    },
    {
      match: (p) =>
        p.startsWith("/items/") &&
        p !== "/items/new" &&
        !p.startsWith("/items/container-customs") &&
        !p.startsWith("/items/containers"),
      href: "/items",
      title: "Edit Item",
    },
    {
      match: (p) => p.startsWith("/reports/profit-loss"),
      href: "/reports/profit-loss",
      title: "Profit & Loss Report",
    },
    {
      match: (p) => p.startsWith("/reports/sales-statistics"),
      href: "/reports/sales-statistics",
      title: "Sales Statistics",
    },
    { match: (p) => p.startsWith("/sales"), href: "/sales", title: "List of Sales" },
    { match: (p) => p.startsWith("/my-sales"), href: "/my-sales", title: "My Sales" },
    { match: (p) => p.startsWith("/expenses"), href: "/expenses", title: "Expenses" },
    { match: (p) => p.startsWith("/categories"), href: "/categories", title: "Categories" },
    { match: (p) => p.startsWith("/inventory"), href: "/inventory", title: "Stock Adjust" },
    { match: (p) => p.startsWith("/employees"), href: "/employees", title: "Cashiers" },
    { match: (p) => p.startsWith("/payment-methods"), href: "/payment-methods", title: "Payment Methods" },
    { match: (p) => p.startsWith("/settings"), href: "/settings", title: "Preferences" },
    { match: (p) => p.startsWith("/products"), href: "/items", title: "List of Items" },
    { match: (p) => p.startsWith("/reports"), href: "/reports/profit-loss", title: "Reports" },
  ];

function tabForPath(pathname: string) {
  return TAB_META.find((t) => t.match(pathname));
}

const OWNER_PINNED_TABS = [
  { href: "/owner", title: "Home" },
  { href: "/items", title: "List of Items" },
  { href: "/reports/sales-statistics", title: "Sales Statistics" },
  { href: "/reports/profit-loss", title: "Profit & Loss Report" },
] as const;

const PINNED_HREFS = new Set<string>(OWNER_PINNED_TABS.map((t) => t.href));

export function AppShell({
  user,
  storeName,
  children,
}: {
  user: NavUser;
  storeName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [tabs, setTabs] = useState<{ href: string; title: string }[]>(() =>
    user.role === Role.OWNER
      ? [...OWNER_PINNED_TABS]
      : [{ href: "/my-sales", title: "My Sales" }]
  );

  const menus = user.role === Role.OWNER ? OWNER_MENUS : EMPLOYEE_MENUS;

  useEffect(() => {
    if (user.role === Role.OWNER) {
      setTabs((prev) => {
        const extras = prev.filter((t) => !PINNED_HREFS.has(t.href));
        return [...OWNER_PINNED_TABS, ...extras];
      });
    }
  }, [user.role]);

  useEffect(() => {
    const meta = tabForPath(pathname);
    if (!meta || pathname === "/pos") return;

    // Keep pinned tabs in place; only add extra tabs for other screens
    if (PINNED_HREFS.has(meta.href) && user.role === Role.OWNER) {
      return;
    }

    setTabs((prev) => {
      if (prev.some((t) => t.href === meta.href || t.title === meta.title)) {
        return prev.map((t) =>
          t.href === meta.href || t.title === meta.title
            ? {
                href:
                  meta.title === "Edit Item" &&
                  pathname.startsWith("/items/") &&
                  pathname !== "/items/new"
                    ? pathname
                    : meta.href,
                title: meta.title,
              }
            : t
        );
      }
      const href =
        pathname.startsWith("/items/") && pathname !== "/items/new"
          ? pathname
          : meta.href;
      return [...prev, { href, title: meta.title }];
    });
  }, [pathname, user.role]);

  const activeTabHref = useMemo(() => {
    const exact = tabs.find((t) => t.href === pathname);
    if (exact) return exact.href;
    const meta = tabForPath(pathname);
    return meta?.href || pathname;
  }, [pathname, tabs]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function onMenuItem(item: MenuItem) {
    setOpenMenu(null);
    if (item.action === "logout") {
      logout();
      return;
    }
    if (item.href) router.push(item.href);
  }

  function closeTab(href: string) {
    if (user.role === Role.OWNER && PINNED_HREFS.has(href)) return;

    const next = tabs.filter((t) => t.href !== href);
    const fallbackTabs =
      next.length > 0
        ? next
        : user.role === Role.OWNER
          ? [...OWNER_PINNED_TABS]
          : [{ href: "/my-sales", title: "My Sales" }];

    setTabs(fallbackTabs);

    if (pathname === href || pathname.startsWith(`${href}/`)) {
      router.push(fallbackTabs[0]?.href || "/owner");
    }
  }

  if (pathname === "/pos") {
    return <div className="h-dvh overflow-hidden bg-[#d8d8d8]">{children}</div>;
  }

  return (
    <div
      className="desktop-shell"
      onClick={() => setOpenMenu(null)}
    >
      <div className="desktop-titlebar print:hidden">
        POS System — {storeName}
        <span className="desktop-user">
          {user.name} ({user.role === Role.OWNER ? "Owner" : "Cashier"})
        </span>
      </div>

      <div
        className="desktop-menubar print:hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="desktop-home-btn"
          onClick={() => router.push(user.role === Role.OWNER ? "/owner" : "/pos")}
          title="Home"
        >
          ⌂
        </button>
        {menus.map((menu) => (
          <div key={menu.label} className="relative">
            <button
              type="button"
              className="desktop-menu-btn"
              data-open={openMenu === menu.label}
              onClick={() =>
                setOpenMenu((m) => (m === menu.label ? null : menu.label))
              }
            >
              {menu.label}
            </button>
            {openMenu === menu.label ? (
              <div className="desktop-dropdown">
                {menu.items.map((item, idx) =>
                  item.divider ? (
                    <div key={`d-${idx}`} className="desktop-divider" />
                  ) : (
                    <button
                      key={item.label}
                      type="button"
                      className="desktop-dropdown-item"
                      onClick={() => onMenuItem(item)}
                    >
                      {item.label}
                    </button>
                  )
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="desktop-tabs print:hidden">
        {tabs.map((tab) => {
          const active =
            pathname === tab.href ||
            activeTabHref === tab.href ||
            (tab.title === "Edit Item" && pathname.startsWith("/items/"));
          return (
            <div
              key={tab.href + tab.title}
              className={`desktop-tab ${active ? "active" : ""}`}
            >
              <Link href={tab.href}>{tab.title}</Link>
              {!PINNED_HREFS.has(tab.href) ? (
                <button
                  type="button"
                  className="desktop-tab-close"
                  onClick={(e) => {
                    e.preventDefault();
                    closeTab(tab.href);
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <main className="desktop-content">{children}</main>
    </div>
  );
}
