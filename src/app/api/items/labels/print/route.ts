import { NextResponse } from "next/server";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import { printLabelsWindows } from "@/lib/label-print";
import { formatUsd } from "@/lib/fx";

type Incoming = {
  name?: unknown;
  price?: unknown;
  barcode?: unknown;
};

export async function POST(request: Request) {
  try {
    await requireAuth();
    const body = await request.json();
    const incoming = Array.isArray(body?.labels) ? (body.labels as Incoming[]) : [];
    if (incoming.length < 1 || incoming.length > 200) {
      return NextResponse.json(
        { error: "Choose at least one label." },
        { status: 400 }
      );
    }

    const labels = incoming.map((label) => {
      const name = String(label.name || "").trim();
      const barcode = String(label.barcode || "").trim();
      const price =
        typeof label.price === "number" || typeof label.price === "string"
          ? formatUsd(label.price)
          : String(label.price || "").trim();
      return { name, price, barcode };
    });

    if (labels.some((label) => !label.name || !label.barcode)) {
      return NextResponse.json(
        { error: "Each label needs a name and a barcode." },
        { status: 400 }
      );
    }

    const result = await printLabelsWindows(labels);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Print failed";
    if (message.includes("Unauthorized") || message.includes("Forbidden")) {
      return authErrorResponse(error);
    }
    console.error(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
