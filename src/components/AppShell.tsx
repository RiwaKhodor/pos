"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Role } from "@/lib/roles";
import { StoreLogo } from "@/components/StoreLogo";
import { UpdateNotice } from "@/components/UpdateNotice";

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
      { label: "Notifications", href: "/settings/notifications" },
      { label: "Payment Methods", href: "/payment-methods" },
      { label: "Cashiers", href: "/employees" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "List Of Items", href: "/items" },
      { label: "Barcode Labels", href: "/items/labels" },
      { label: "New Item", href: "/items/new" },
      { label: "New Container", href: "/items/containers/new" },
      { label: "Containers", href: "/items/containers" },
      { label: "Categories", href: "/categories" },
      { label: "Stock Track", href: "/inventory" },
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
];

const EMPLOYEE_MENUS: MenuGroup[] = [
  {
    label: "POS",
    items: [{ label: "Open POS", href: "/pos" }],
  },
];

const TAB_META: { match: (path: string) => boolean; href: string; title: string }[] =
  [
    { match: (p) => p === "/owner" || p === "/home", href: "/owner", title: "Home" },
    { match: (p) => p === "/items" || p.startsWith("/items?"), href: "/items", title: "List of Items" },
    { match: (p) => p === "/items/new", href: "/items/new", title: "New Item" },
    {
      match: (p) => p.startsWith("/items/labels"),
      href: "/items/labels",
      title: "Barcode Labels",
    },
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
      match: (p) =>
        p.startsWith("/items/") &&
        p !== "/items/new" &&
        !p.startsWith("/items/labels") &&
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
    { match: (p) => p.startsWith("/inventory"), href: "/inventory", title: "Stock Track" },
    { match: (p) => p.startsWith("/employees"), href: "/employees", title: "Cashiers" },
    { match: (p) => p.startsWith("/payment-methods"), href: "/payment-methods", title: "Payment Methods" },
    { match: (p) => p.startsWith("/settings/notifications"), href: "/settings/notifications", title: "Notifications" },
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
  ownerWeb = false,
  children,
}: {
  user: NavUser;
  storeName: string;
  ownerWeb?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [tabs, setTabs] = useState<{ href: string; title: string }[]>(() =>
    user.role === Role.OWNER
      ? [...OWNER_PINNED_TABS]
      : []
  );

  const menus = ownerWeb
    ? [
        {
          label: "Reports",
          items: [
            { label: "Profit & Loss", href: "/reports/profit-loss" },
            { label: "Sales Statistics", href: "/reports/sales-statistics" },
          ],
        },
      ]
    : user.role === Role.OWNER
      ? OWNER_MENUS
      : EMPLOYEE_MENUS;

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

    const isItemEditor =
      meta.title === "Edit Item" &&
      pathname.startsWith("/items/") &&
      pathname !== "/items/new" &&
      !pathname.startsWith("/items/labels") &&
      !pathname.startsWith("/items/containers");
    const href = isItemEditor ? pathname : meta.href;
    const title =
      isItemEditor && user.role !== Role.OWNER ? "Correct Item" : meta.title;

    setTabs((prev) => {
      const index = prev.findIndex((t) =>
        isItemEditor
          ? t.title === "Edit Item" ||
            t.title === "Correct Item" ||
            t.href === pathname
          : t.href === href || t.title === title
      );
      if (index >= 0) {
        return prev.map((t, i) => (i === index ? { href, title } : t));
      }
      return [...prev, { href, title }];
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
          : [{ href: "/pos", title: "POS" }];

    setTabs(fallbackTabs);

    if (pathname === href || pathname.startsWith(`${href}/`)) {
      router.push(fallbackTabs[0]?.href || "/owner");
    }
  }

  if (pathname === "/pos") {
    return <div className="h-dvh overflow-hidden bg-[#d8d8d8]">{children}</div>;
  }

  const webLinks = [
    { href: "/owner", label: "Home" },
    { href: "/items", label: "Items" },
    { href: "/sales", label: "Sales" },
    { href: "/expenses", label: "Expenses" },
    { href: "/settings/notifications", label: "Alerts" },
  ];

  return (
    <div
      className={ownerWeb ? "desktop-shell owner-web" : "desktop-shell"}
      onClick={() => setOpenMenu(null)}
    >
      <div className="desktop-titlebar print:hidden">
        <span className="desktop-title-brand">
          <StoreLogo size={26} />
          POS System — {storeName}
        </span>
        <div className="desktop-userbox">
          <UpdateNotice />
          <span className="desktop-user">
            {user.name} ({user.role === Role.OWNER ? "Owner" : "Cashier"})
          </span>
        </div>
      </div>

      <div
        className="desktop-menubar print:hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="desktop-home-btn"
          onClick={() =>
            router.push(user.role === Role.OWNER || ownerWeb ? "/owner" : "/pos")
          }
          title="Home"
        >
          ⌂
        </button>
        {ownerWeb
          ? webLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                prefetch={false}
                className={`desktop-menu-btn ${pathname === link.href ? "active" : ""}`}
              >
                {link.label}
              </Link>
            ))
          : null}
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
                  ) : item.href ? (
                    <Link
                      key={item.label}
                      href={item.href}
                      className="desktop-dropdown-item"
                      prefetch={false}
                      onClick={(e) => {
                        e.preventDefault();
                        onMenuItem(item);
                      }}
                    >
                      {item.label}
                    </Link>
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
        <button type="button" className="desktop-menu-btn" onClick={logout}>
          {ownerWeb ? "Sign out" : "Switch User"}
        </button>
      </div>

      {ownerWeb ? null : (
      <div className="desktop-tabs print:hidden">
        {tabs.map((tab) => {
          const active =
            pathname === tab.href ||
            activeTabHref === tab.href ||
            ((tab.title === "Edit Item" || tab.title === "Correct Item") &&
              pathname === tab.href);
          return (
            <div
              key={`${tab.href}::${tab.title}`}
              className={`desktop-tab ${active ? "active" : ""}`}
            >
              <Link href={tab.href} prefetch={false}>
                {tab.title}
              </Link>
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
      )}

      <main className="desktop-content">{children}</main>
    </div>
  );
}
