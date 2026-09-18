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
];

const SHARED_AUTH_PREFIXES = ["/pos", "/my-sales", "/receipts"];

function isOwnerOnly(pathname: string) {
  return OWNER_ONLY_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

function isSharedAuth(pathname: string) {
  return SHARED_AUTH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
    return NextResponse.redirect(new URL("/pos", request.url));
  }

  if (isOwnerOnly(pathname) || isSharedAuth(pathname)) {
    if (!session) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    if (isOwnerOnly(pathname) && session.role !== Role.OWNER) {
      return NextResponse.redirect(new URL("/pos", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
