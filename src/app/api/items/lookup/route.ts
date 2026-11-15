import { NextResponse } from "next/server";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { lookupProduct } from "@/lib/product-lookup";
import { Role } from "@/lib/roles";

export async function POST(request: Request) {
  try {
    await requireRole(Role.OWNER);
    const body = (await request.json().catch(() => ({}))) as {
      barcode?: string;
      name?: string;
    };
    const barcode = String(body.barcode || "").trim();
    const name = String(body.name || "").trim();
    if (!barcode && !name) {
      return NextResponse.json({ error: "Scan a barcode or type a name." }, { status: 400 });
    }
    const result = await lookupProduct({ barcode, name });
    return NextResponse.json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}
