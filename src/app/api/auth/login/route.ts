import { NextResponse } from "next/server";
import {
  authErrorResponse,
  createToken,
  setAuthCookie,
  verifyPassword,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRole } from "@/lib/roles";
import { setStoreNameCookie } from "@/lib/store-cookie";
import { isDbUnavailable } from "@/lib/db-unavailable";
import {
  findKnownUser,
  readCachedSettings,
  rememberUser,
  refreshCatalogFromSupabase,
} from "@/lib/catalog-cache";
import { isOwnerWeb } from "@/lib/host";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const password = String(body.password || "");

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  try {
    const [user, settings] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.storeSettings.findUnique({
        where: { id: "default" },
        select: { storeName: true },
      }),
    ]);
    if (!user || !user.active) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    if (!isRole(user.role)) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }
    if (isOwnerWeb() && user.role !== "OWNER") {
      return NextResponse.json(
        { error: "This phone app is for the owner. Use the store computer." },
        { status: 403 }
      );
    }

    const session = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    const token = await createToken(session);
    const response = NextResponse.json({ user: session });
    setAuthCookie(response, token);
    setStoreNameCookie(response, settings?.storeName || "VANO");
    if (!isOwnerWeb()) {
      rememberUser({
        id: user.id,
        name: user.name,
        email: user.email,
        passwordHash: user.passwordHash,
        role: user.role,
        active: user.active,
      });
      void refreshCatalogFromSupabase().catch(() => undefined);
    }
    return response;
  } catch (error) {
    // Writes the real error to the Vercel logs so we can see what failed
    console.error("LOGIN ERROR:", error);

    if (!isDbUnavailable(error)) return authErrorResponse(error);

    // On the owner website there is no offline mode, so show a clear message
    if (isOwnerWeb()) {
      return NextResponse.json(
        { error: "Cannot reach the database. Please try again in a moment." },
        { status: 503 }
      );
    }

    const known = findKnownUser(email);
    if (!known || !known.active) {
      return NextResponse.json(
        {
          error:
            "No connection, and this computer has no saved login for that email. Connect once and sign in, then this register can open offline.",
        },
        { status: 503 }
      );
    }
    const valid = await verifyPassword(password, known.passwordHash);
    if (!valid || !isRole(known.role)) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }
    const session = {
      id: known.id,
      name: known.name,
      email: known.email,
      role: known.role,
    };
    const token = await createToken(session);
    const response = NextResponse.json({ user: session, offline: true });
    setAuthCookie(response, token);
    setStoreNameCookie(response, readCachedSettings()?.storeName || "VANO");
    return response;
  }
}