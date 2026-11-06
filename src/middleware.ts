import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifyToken } from "@/lib/token";
import { Role } from "@/lib/roles";

const OWNER_ONLY_PREFIXES = [
  "/owner",
  "/sales",
  "/products",
  "/items",
  "/inventory",
  "/categories",
  "/employees",
  "/reports",
  "/expenses",
  "/settings",
  "/payment-methods",
  "/my-sales",
];

const SHARED_AUTH_PREFIXES = ["/pos", "/receipts"];

function isEmployeeInventory(_pathname: string) {
  return false;
}

function isOwnerOnly(pathname: string) {
  if (isEmployeeInventory(pathname)) return false;
  return OWNER_ONLY_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

function isSharedAuth(pathname: string) {
  return (
    SHARED_AUTH_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`)
    ) || isEmployeeInventory(pathname)
  );
}

const WEB_PAGES = [
  "/owner",
  "/items",
  "/sales",
  "/receipts",
  "/reports",
  "/settings/notifications",
  "/expenses",
];

function isWebPage(pathname: string) {
  if (pathname === "/items") return true;
  if (pathname.startsWith("/items/")) return false;
  return WEB_PAGES.some(
    (page) => pathname === page || pathname.startsWith(`${page}/`)
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ownerWeb = process.env.VANO_WEB === "1";

  if (ownerWeb && pathname.startsWith("/api")) {
    const writing = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    const allowWrite =
      pathname === "/api/auth/login" ||
      pathname === "/api/auth/logout" ||
      pathname.startsWith("/api/push/");
    if (writing && !allowWrite) {
      return NextResponse.json(
        { error: "This phone app is view only. Change data on the store computer." },
        { status: 403 }
      );
    }
  }

  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/login"
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  const session = token ? await verifyToken(token) : null;

  if (pathname === "/") {
    if (!session) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    if (session.role === Role.OWNER) {
      return NextResponse.redirect(new URL("/owner", request.url));
    }
    if (ownerWeb) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.redirect(new URL("/pos", request.url));
  }

  if (ownerWeb && session && !isWebPage(pathname) && pathname !== "/login") {
    if (session.role !== Role.OWNER) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.redirect(new URL("/owner", request.url));
  }

  if (isOwnerOnly(pathname) || isSharedAuth(pathname)) {
    if (!session) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    if (isOwnerOnly(pathname) && session.role !== Role.OWNER) {
      return NextResponse.redirect(
        new URL(ownerWeb ? "/login" : "/pos", request.url)
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
