import { cookies } from "next/headers";

export const STORE_NAME_COOKIE = "pos_store_name";

export async function getStoreNameFromCookie() {
  const jar = await cookies();
  return jar.get(STORE_NAME_COOKIE)?.value?.trim() || "VANO";
}

export function setStoreNameCookie(response: {
  cookies: { set: (name: string, value: string, opts: Record<string, unknown>) => void };
}, storeName: string) {
  response.cookies.set(STORE_NAME_COOKIE, storeName || "VANO", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.VANO_DESKTOP !== "1",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}
