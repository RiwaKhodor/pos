import { authErrorResponse, requireAuth } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { bustCache } from "@/lib/data-cache";
import { jsonMoney } from "@/lib/money";
import { completeSaleLocally } from "@/lib/offline-sale";
import { showPriceOnDisplay } from "@/lib/price-display";
import { syncPendingSales } from "@/lib/sync-sales";
import { formatUsd, parsePayCurrency } from "@/lib/fx";
import { notifyOwners } from "@/lib/push";
import { normalizePricingMode } from "@/lib/price-tiers";

type CartItem = {
  productId: string;
  quantity: number;
  useFixedWholesale?: boolean;
};

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const items = (body.items || []) as CartItem[];
    const paymentMethodId = String(body.paymentMethodId || "");
    const pricingMode = normalizePricingMode(body.pricingMode);
    const payCurrency = parsePayCurrency(body.payCurrency);
    const changeCurrency = parsePayCurrency(body.changeCurrency, payCurrency);
    const amountTendered = Number(body.amountTendered);
    const tenderedUsd =
      body.tenderedUsd == null ? undefined : Number(body.tenderedUsd);
    const tenderedLbp =
      body.tenderedLbp == null ? undefined : Number(body.tenderedLbp);
    const givenChangeUsd =
      body.changeUsd == null ? null : Number(body.changeUsd);
    const givenChangeLbp =
      body.changeLbp == null ? null : Number(body.changeLbp);

    if (!Array.isArray(items) || items.length === 0) {
      return Response.json({ error: "Cart cannot be empty" }, { status: 400 });
    }
    if (!paymentMethodId) {
      return Response.json(
        { error: "Payment method is required" },
        { status: 400 }
      );
    }

    const sale = completeSaleLocally({
      items,
      paymentMethodId,
      pricingMode,
      payCurrency,
      changeCurrency,
      amountTendered,
      tenderedUsd,
      tenderedLbp,
      givenChangeUsd,
      givenChangeLbp,
      discount: Number(body.discount ?? 0),
      cashierId: user.id,
      cashierName: user.name,
      ownerDiscount: user.role === Role.OWNER,
    });

    showPriceOnDisplay(sale.total);
    const itemText = sale.items
      .slice(0, 8)
      .map((item) => `${item.name} × ${item.quantity}`)
      .join(", ");
    const extra = sale.items.length > 8 ? ` +${sale.items.length - 8} more` : "";
    notifyOwners({
      title: "New sale",
      body: `Receipt ${sale.receiptNumber} · ${formatUsd(sale.total)}${itemText ? ` · ${itemText}${extra}` : ""}`,
      url: `/receipts/${sale.id}`,
      tag: `sale:${sale.id}`,
    });
    void syncPendingSales()
      .then((sync) => {
        if (sync.online) bustCache("products", "owner-stats");
      })
      .catch(() => undefined);
    return jsonMoney(
      { sale, savedLocally: true, synced: false },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "NO_CATALOG") {
        return Response.json(
          {
            error:
              "This computer has no saved product list yet. Connect to the internet once, then sales can continue if the connection drops.",
          },
          { status: 503 }
        );
      }
      if (error.message === "BAD_METHOD") {
        return Response.json(
          { error: "Invalid payment method" },
          { status: 400 }
        );
      }
      if (error.message === "INVALID_ITEM") {
        return Response.json({ error: "Invalid cart item" }, { status: 400 });
      }
      if (error.message === "PRODUCT_MISSING") {
        return Response.json(
          { error: "One or more products are unavailable" },
          { status: 400 }
        );
      }
      if (error.message === "INSUFFICIENT_TENDER") {
        return Response.json(
          { error: "Amount received is less than the total" },
          { status: 400 }
        );
      }
      if (error.message === "INVALID_TENDER") {
        return Response.json(
          { error: "Enter the amount the customer paid" },
          { status: 400 }
        );
      }
      if (error.message.startsWith("WHOLESALE_QTY:")) {
        const parts = error.message.split(":");
        const msg = parts.slice(2).join(":") || "Invalid wholesale quantity";
        return Response.json({ error: msg }, { status: 400 });
      }
      if (error.message.startsWith("INSUFFICIENT_STOCK:")) {
        const name = error.message.split(":")[1];
        return Response.json(
          { error: `Not enough stock for ${name}` },
          { status: 400 }
        );
      }
    }
    return authErrorResponse(error);
  }
}
