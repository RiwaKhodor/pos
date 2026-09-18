import { authErrorResponse, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { jsonMoney, toNum } from "@/lib/money";
import { generateReceiptNumber } from "@/lib/utils";

type CartItem = {
  productId: string;
  quantity: number;
};

function volumePercent(
  subtotal: number,
  d100: number,
  d200: number,
  d300: number
) {
  if (subtotal >= 300) return d300;
  if (subtotal >= 200) return d200;
  if (subtotal >= 100) return d100;
  return 0;
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const items = (body.items || []) as CartItem[];
    const paymentMethodId = String(body.paymentMethodId || "");
    const pricingModeRaw = String(body.pricingMode || "REGULAR").toUpperCase();
    const pricingMode =
      pricingModeRaw === "WHOLESALE" || pricingModeRaw === "VOLUME"
        ? pricingModeRaw
        : "REGULAR";

    if (!Array.isArray(items) || items.length === 0) {
      return Response.json({ error: "Cart cannot be empty" }, { status: 400 });
    }
    if (!paymentMethodId) {
      return Response.json(
        { error: "Payment method is required" },
        { status: 400 }
      );
    }

    const paymentMethod = await prisma.paymentMethod.findFirst({
      where: { id: paymentMethodId, active: true },
    });
    if (!paymentMethod) {
      return Response.json(
        { error: "Invalid payment method" },
        { status: 400 }
      );
    }

    const settings = await prisma.storeSettings.findUnique({
      where: { id: "default" },
    });
    const taxRate = toNum(settings?.taxRate);
    const d100 = toNum(settings?.volumeDisc100 ?? 5);
    const d200 = toNum(settings?.volumeDisc200 ?? 10);
    const d300 = toNum(settings?.volumeDisc300 ?? 15);

    const sale = await prisma.$transaction(async (tx) => {
      const lineItems = [];
      let subtotal = 0;

      for (const item of items) {
        const quantity = Number(item.quantity);
        if (!item.productId || !Number.isInteger(quantity) || quantity < 1) {
          throw new Error("INVALID_ITEM");
        }

        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });
        if (!product || !product.active || !product.showInPos) {
          throw new Error("PRODUCT_MISSING");
        }
        if (product.trackQty && product.stock < quantity) {
          throw new Error(`INSUFFICIENT_STOCK:${product.name}`);
        }

        const wholesale = toNum(product.wholesalePrice);
        const unitPrice =
          pricingMode === "WHOLESALE" && wholesale > 0
            ? wholesale
            : toNum(product.price);

        const lineTotal = unitPrice * quantity;
        subtotal += lineTotal;
        lineItems.push({
          productId: product.id,
          name: product.name,
          quantity,
          unitPrice,
          unitCost: toNum(product.cost) + toNum(product.customsDuty),
          lineTotal,
        });

        if (product.trackQty) {
          await tx.product.update({
            where: { id: product.id },
            data: { stock: { decrement: quantity } },
          });
        }
      }

      subtotal = Number(subtotal.toFixed(2));

      let discount = 0;
      if (pricingMode === "VOLUME") {
        const pct = volumePercent(subtotal, d100, d200, d300);
        discount = Number(((subtotal * pct) / 100).toFixed(2));
      }

      const taxable = Number((subtotal - discount).toFixed(2));
      const tax = Number(((taxable * taxRate) / 100).toFixed(2));
      const total = Number((taxable + tax).toFixed(2));

      return tx.sale.create({
        data: {
          receiptNumber: await generateReceiptNumber(),
          subtotal,
          discount,
          tax,
          total,
          pricingMode,
          cashierId: user.id,
          customerId: null,
          paymentMethodId,
          items: { create: lineItems },
        },
        include: {
          items: true,
          paymentMethod: true,
          cashier: { select: { id: true, name: true } },
        },
      });
    });

    return jsonMoney({ sale }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "INVALID_ITEM") {
        return Response.json({ error: "Invalid cart item" }, { status: 400 });
      }
      if (error.message === "PRODUCT_MISSING") {
        return Response.json(
          { error: "One or more products are unavailable" },
          { status: 400 }
        );
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
