import { cache } from "react";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Role } from "./roles";
import { isDbUnavailable } from "./db-unavailable";
import {
  AUTH_COOKIE,
  SessionUser,
  createToken,
  verifyToken,
} from "./token";

export { AUTH_COOKIE, Role, createToken, verifyToken };
export type { SessionUser };

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

/** Fast session — JWT only (no DB). Active check happens at login. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
});

export async function requireAuth(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new AuthError(401, "Unauthorized");
  }
  return user;
}

export async function requireRole(
  allowed: Role | Role[]
): Promise<SessionUser> {
  const user = await requireAuth();
  const roles = Array.isArray(allowed) ? allowed : [allowed];
  if (!roles.includes(user.role)) {
    throw new AuthError(403, "Forbidden");
  }
  return user;
}

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  if (isDbUnavailable(error)) {
    return NextResponse.json({ ok: false, offline: true }, { status: 503 });
  }

  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

function cookieSecure() {
  return process.env.NODE_ENV === "production" && process.env.VANO_DESKTOP !== "1";
}

export function setAuthCookie(response: NextResponse, token: string) {
  response.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearAuthCookie(response: NextResponse) {
  response.cookies.set(AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: 0,
  });
}

export async function getUserFromRequest(
  request: NextRequest
): Promise<SessionUser | null> {
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}
