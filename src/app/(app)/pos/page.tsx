"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Role } from "@/lib/roles";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  barcode?: string | null;
  price: number;
  wholesalePrice?: number;
  stock: number;
};

type PaymentMethod = { id: string; name: string };

type CartLine = {
  productId: string;
  name: string;
  price: number;
  wholesalePrice: number;
  stock: number;
  quantity: number;
  unit: string;
};

type SessionInfo = {
  name: string;
  role: Role;
};

type PricingMode = "REGULAR" | "WHOLESALE" | "VOLUME";

type VolumeDiscounts = {
  at100: number;
  at200: number;
  at300: number;
};

function formatAmount(amount: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function volumePercent(subtotal: number, d: VolumeDiscounts) {
  if (subtotal >= 300) return d.at300;
  if (subtotal >= 200) return d.at200;
  if (subtotal >= 100) return d.at100;
  return 0;
}

function formatClock(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
}

export default function PosPage() {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [storeName, setStoreName] = useState("Store");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [query, setQuery] = useState("");
  const [qtyInput, setQtyInput] = useState("1");
  const [products, setProducts] = useState<Product[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [pricingMode, setPricingMode] = useState<PricingMode>("REGULAR");
  const [volumeDiscounts, setVolumeDiscounts] = useState<VolumeDiscounts>({
    at100: 5,
    at200: 10,
    at300: 15,
  });
  const [status, setStatus] = useState(
    "Ready. Scan barcode or type product description. Premium POS is online."
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastReceiptId, setLastReceiptId] = useState<string | null>(null);
  const [showProducts, setShowProducts] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [stockAlert, setStockAlert] = useState<{
    name: string;
    wanted: number;
    available: number;
  } | null>(null);
  const [productFilter, setProductFilter] = useState("");
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  function showStockPopup(name: string, wanted: number, available: number) {
    setStockAlert({ name, wanted, available });
    setError(`Not enough stock for ${name}`);
    setStatus(
      `There is not this quantity in stock. ${name}: asked ${wanted}, available ${available}.`
    );
  }

  const isOwner = session?.role === Role.OWNER;

  useEffect(() => {
    async function boot() {
      const [meRes, productsRes, methodsRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/pos/products"),
        fetch("/api/payment-methods"),
      ]);
      const me = await meRes.json();
      const productsData = await productsRes.json();
      const methodsData = await methodsRes.json();

      if (me.user) {
        setSession({ name: me.user.name, role: me.user.role });
      }
      if (me.storeName) setStoreName(me.storeName);
      if (me.volumeDiscounts) setVolumeDiscounts(me.volumeDiscounts);
      setProducts(productsData.products || []);
      const list: PaymentMethod[] = methodsData.methods || [];
      setMethods(list);
      const cash =
        list.find((m) => m.name.toLowerCase() === "cash") || list[0];
      if (cash) setPaymentMethodId(cash.id);
    }
    boot();
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const res = await fetch(
        `/api/pos/products?q=${encodeURIComponent(productFilter || query)}`
      );
      const data = await res.json();
      setProducts(data.products || []);
    }, 180);
    return () => clearTimeout(timer);
  }, [query, productFilter, showProducts]);

  const pricing = useMemo(() => {
    const subtotal = cart.reduce((sum, line) => {
      const unit =
        pricingMode === "WHOLESALE" && line.wholesalePrice > 0
          ? line.wholesalePrice
          : line.price;
      return sum + unit * line.quantity;
    }, 0);
    const rounded = Number(subtotal.toFixed(2));
    let discount = 0;
    let percent = 0;
    if (pricingMode === "VOLUME") {
      percent = volumePercent(rounded, volumeDiscounts);
      discount = Number(((rounded * percent) / 100).toFixed(2));
    }
    const total = Number((rounded - discount).toFixed(2));
    return { subtotal: rounded, discount, percent, total };
  }, [cart, pricingMode, volumeDiscounts]);

  const total = pricing.total;

  const addProduct = useCallback((product: Product, qty = 1) => {
    const amount = Math.max(1, Math.floor(qty));
    setError("");
    let blocked = false;
    setCart((prev) => {
      const existing = prev.find((line) => line.productId === product.id);
      if (existing) {
        const wantedTotal = existing.quantity + amount;
        if (wantedTotal > product.stock) {
          blocked = true;
          showStockPopup(product.name, wantedTotal, product.stock);
          if (product.stock > existing.quantity) {
            return prev.map((line) =>
              line.productId === product.id
                ? { ...line, quantity: product.stock, stock: product.stock }
                : line
            );
          }
          return prev;
        }
        return prev.map((line) =>
          line.productId === product.id
            ? { ...line, quantity: wantedTotal, stock: product.stock }
            : line
        );
      }
      if (product.stock < 1) {
        blocked = true;
        showStockPopup(product.name, amount, 0);
        return prev;
      }
      if (amount > product.stock) {
        blocked = true;
        showStockPopup(product.name, amount, product.stock);
        return [
          ...prev,
          {
            productId: product.id,
            name: product.name,
            price: product.price,
            wholesalePrice: product.wholesalePrice || 0,
            stock: product.stock,
            quantity: product.stock,
            unit: "pc",
          },
        ];
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          price: product.price,
          wholesalePrice: product.wholesalePrice || 0,
          stock: product.stock,
          quantity: amount,
          unit: "pc",
        },
      ];
    });
    setSelectedId(product.id);
    if (!blocked) {
      setStatus(`Added ${product.name}.`);
    }
    setQuery("");
    setQtyInput("1");
    setShowProducts(false);
    searchRef.current?.focus();
  }, []);

  async function resolveAndAdd() {
    const term = query.trim();
    if (!term) return;

    const qty = Number(qtyInput) || 1;
    const exactCode = products.find(
      (p) =>
        (p.sku && p.sku.toLowerCase() === term.toLowerCase()) ||
        (p.barcode && p.barcode.toLowerCase() === term.toLowerCase())
    );
    if (exactCode) {
      addProduct(exactCode, qty);
      return;
    }

    const res = await fetch(`/api/pos/products?q=${encodeURIComponent(term)}`);
    const data = await res.json();
    const list: Product[] = data.products || [];
    const match =
      list.find(
        (p) =>
          (p.sku && p.sku.toLowerCase() === term.toLowerCase()) ||
          (p.barcode && p.barcode.toLowerCase() === term.toLowerCase())
      ) ||
      list.find((p) => p.name.toLowerCase() === term.toLowerCase()) ||
      list[0];

    if (!match) {
      setStatus("No product found. Use Product List to browse products.");
      setError("Product not found");
      return;
    }

    if (list.length > 1 && !exactCode) {
      setProducts(list);
      setProductFilter(term);
      setShowProducts(true);
      setStatus("Multiple matches found. Select a product.");
      return;
    }

    addProduct(match, qty);
  }

  function newSale() {
    setCart([]);
    setSelectedId(null);
    setError("");
    setStatus("New sale started. Scan barcode or type product description.");
    searchRef.current?.focus();
  }

  async function changeQty() {
    if (!selectedId) {
      setStatus("Select a line item first.");
      return;
    }
    const line = cart.find((l) => l.productId === selectedId);
    if (!line) return;

    const raw = window.prompt("Enter quantity", String(line.quantity));
    if (raw == null) return;

    const wanted = Math.floor(Number(raw));
    if (!Number.isFinite(wanted) || wanted < 1) {
      setStatus("Quantity must be at least 1.");
      setError("Invalid quantity");
      return;
    }

    // Refresh stock from server so Change Qty uses the real available amount
    let available = line.stock;
    let trackQty = true;
    try {
      const res = await fetch(
        `/api/pos/products?q=${encodeURIComponent(line.name)}`
      );
      const data = await res.json();
      const fresh = (data.products || []).find(
        (p: Product & { trackQty?: boolean }) => p.id === line.productId
      );
      if (fresh) {
        available = fresh.stock;
        trackQty = fresh.trackQty !== false;
      }
    } catch {
      // keep cart stock if refresh fails
    }

    if (trackQty && wanted > available) {
      showStockPopup(line.name, wanted, available);
      if (available >= 1 && available !== line.quantity) {
        setCart((prev) =>
          prev.map((l) =>
            l.productId === selectedId
              ? { ...l, quantity: available, stock: available }
              : l
          )
        );
      }
      return;
    }

    setError("");
    setStockAlert(null);
    setCart((prev) =>
      prev.map((l) =>
        l.productId === selectedId
          ? { ...l, quantity: wanted, stock: available }
          : l
      )
    );
    setStatus(`Quantity updated to ${wanted}.`);
  }

  function voidItem() {
    if (!selectedId) {
      setStatus("Select a line item to void. Void only works before payment.");
      return;
    }
    setCart((prev) => {
      const next = prev.filter((l) => l.productId !== selectedId);
      setSelectedId(next[next.length - 1]?.productId ?? null);
      return next;
    });
    setStatus("Item removed from this sale (before payment).");
  }

  function reprint() {
    if (!lastReceiptId) {
      setStatus("No receipt available to reprint.");
      return;
    }
    router.push(`/receipts/${lastReceiptId}?print=1`);
  }

  function openPayment() {
    if (cart.length === 0) {
      setError("Add products before payment");
      setStatus("Cart is empty.");
      return;
    }
    setError("");
    setShowPayment(true);
    setStatus("Select payment method and complete the sale.");
  }

  function exitPos() {
    if (isOwner) {
      router.push("/owner");
    } else {
      router.push("/my-sales");
    }
  }

  async function checkout(e?: FormEvent) {
    e?.preventDefault();
    if (cart.length === 0) {
      setError("Add products to the cart first");
      return;
    }
    setLoading(true);
    setError("");

    const res = await fetch("/api/pos/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cart.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
        })),
        paymentMethodId,
        pricingMode,
      }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Checkout failed");
      setStatus(data.error || "Checkout failed");
      return;
    }

    setLastReceiptId(data.sale.id);
    setShowPayment(false);
    setCart([]);
    setSelectedId(null);
    setStatus(`Sale complete. Receipt ${data.sale.receiptNumber || ""}.`);
    router.push(`/receipts/${data.sale.id}?print=1`);
    router.refresh();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing =
        tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";

      if (e.key === "Escape") {
        setShowPayment(false);
        setShowProducts(false);
        setStockAlert(null);
        setMenuOpen(null);
      } else if (e.key === "Delete" && !typing) {
        e.preventDefault();
        voidItem();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, selectedId]);

  const menuItems: Record<
    string,
    { label: string; action: () => void; disabled?: boolean }[]
  > = {
    File: [
      { label: "New Sale", action: newSale },
      { label: "Exit POS", action: exitPos },
    ],
    "Cashier Entry": [
      { label: "Focus barcode", action: () => searchRef.current?.focus() },
      { label: "Product List", action: () => setShowProducts(true) },
    ],
    Transaction: [
      { label: "Payment", action: openPayment },
      { label: "Void Item", action: voidItem },
      {
        label: "My Sales",
        action: () => router.push("/my-sales"),
      },
      {
        label: "All Sales",
        action: () => router.push("/sales"),
        disabled: !isOwner,
      },
    ],
    Report: [
      {
        label: "Reports",
        action: () => router.push("/reports"),
        disabled: !isOwner,
      },
      {
        label: "Owner Dashboard",
        action: () => router.push("/owner"),
        disabled: !isOwner,
      },
    ],
    Setup: [
      {
        label: "Settings",
        action: () => router.push("/settings"),
        disabled: !isOwner,
      },
      {
        label: "Payment Methods",
        action: () => router.push("/payment-methods"),
        disabled: !isOwner,
      },
      {
        label: "Employees",
        action: () => router.push("/employees"),
        disabled: !isOwner,
      },
    ],
    "Items": [
      {
        label: "Products",
        action: () => router.push("/items"),
        disabled: !isOwner,
      },
      {
        label: "Categories",
        action: () => router.push("/categories"),
        disabled: !isOwner,
      },
      {
        label: "Inventory",
        action: () => router.push("/inventory"),
        disabled: !isOwner,
      },
    ],
  };

  return (
    <div className="pos-shell" onClick={() => setMenuOpen(null)}>
      <div className="pos-title">
        {storeName.toUpperCase()} - POS System
      </div>

      <div className="pos-menu" onClick={(e) => e.stopPropagation()}>
        {Object.keys(menuItems).map((name) => (
          <div key={name} className="relative">
            <button
              type="button"
              data-active={menuOpen === name}
              onClick={() => setMenuOpen((m) => (m === name ? null : name))}
            >
              {name}
            </button>
            {menuOpen === name ? (
              <div className="absolute left-0 top-full z-40 min-w-[180px] border border-[#888] bg-[#f7f7f7] py-1 shadow-lg">
                {menuItems[name].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    disabled={item.disabled}
                    className="block w-full px-3 py-1.5 text-left text-xs hover:bg-[#dce8f8] disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => {
                      setMenuOpen(null);
                      item.action();
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="pos-toolbar">
        <div className="pos-field">
          <label htmlFor="pos-barcode">Barcode / Description</label>
          <input
            id="pos-barcode"
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                resolveAndAdd();
              }
            }}
            autoComplete="off"
          />
        </div>
        <div className="pos-field">
          <label htmlFor="pos-qty">Qty</label>
          <input
            id="pos-qty"
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                searchRef.current?.focus();
              }
            }}
          />
        </div>
        <button
          type="button"
          className="pos-btn"
          onClick={() => {
            setProductFilter(query);
            setShowProducts(true);
          }}
        >
          PRODUCT LIST
        </button>
        <div className="pos-field pos-hide-sm">
          <label>Cashier Name</label>
          <div className="pos-box">{session?.name || "…"}</div>
        </div>
        <div className="pos-field pos-hide-sm">
          <label>Price Type</label>
          <select
            className="pos-box"
            value={pricingMode}
            onChange={(e) => setPricingMode(e.target.value as PricingMode)}
            style={{ fontWeight: 600 }}
          >
            <option value="REGULAR">Regular</option>
            <option value="WHOLESALE">Wholesale</option>
            <option value="VOLUME">Volume % (100/200/300)</option>
          </select>
        </div>
        <div className="pos-field">
          <label>Date / Time</label>
          <div className="pos-box text-[12px]">{formatClock(now)}</div>
        </div>
      </div>

      <div className="pos-table-wrap">
        <table className="pos-table">
          <thead>
            <tr>
              <th style={{ width: "70px" }}>Qty</th>
              <th style={{ width: "70px" }}>Unit</th>
              <th>Description</th>
              <th style={{ width: "110px" }}>Price</th>
              <th style={{ width: "120px" }}>Total Price</th>
            </tr>
          </thead>
          <tbody>
            {cart.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ color: "#777", padding: "18px 8px" }}>
                  No items. Scan a barcode or open Product List.
                </td>
              </tr>
            ) : (
              cart.map((line) => {
                const unit =
                  pricingMode === "WHOLESALE" && line.wholesalePrice > 0
                    ? line.wholesalePrice
                    : line.price;
                return (
                <tr
                  key={line.productId}
                  data-selected={selectedId === line.productId}
                  onClick={() => setSelectedId(line.productId)}
                >
                  <td>{line.quantity.toFixed(2)}</td>
                  <td>{line.unit}</td>
                  <td>{line.name}</td>
                  <td>{formatAmount(unit)}</td>
                  <td>{formatAmount(unit * line.quantity)}</td>
                </tr>
              );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="pos-footer">
        <div className="pos-actions">
          <button type="button" className="pos-btn pos-btn-action" onClick={newSale}>
            NEW SALE
          </button>
          <button
            type="button"
            className="pos-btn pos-btn-action"
            onClick={changeQty}
          >
            CHANGE QTY
          </button>
          <button
            type="button"
            className="pos-btn pos-btn-action"
            onClick={voidItem}
          >
            VOID ITEM
          </button>
          <button
            type="button"
            className="pos-btn pos-btn-action"
            onClick={reprint}
            disabled={!lastReceiptId}
          >
            REPRINT
          </button>
          <button
            type="button"
            className="pos-btn pos-btn-action"
            onClick={openPayment}
          >
            PAYMENT
          </button>
          <button type="button" className="pos-btn pos-btn-action" onClick={exitPos}>
            EXIT
          </button>
        </div>
        <div className="pos-total">
          <span className="pos-total-label">
            {pricing.discount > 0
              ? `TOTAL (-${pricing.percent}%)`
              : "TOTAL"}
          </span>
          <span className="pos-total-value">{formatAmount(total)}</span>
        </div>
      </div>

      <div className="pos-status">
        {error ? <span style={{ color: "#b00020" }}>{error} — </span> : null}
        {status}
      </div>

      {showProducts ? (
        <div
          className="pos-modal-backdrop"
          onClick={() => setShowProducts(false)}
        >
          <div className="pos-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pos-modal-header">Product List</div>
            <div className="pos-modal-body">
              <div className="pos-field mb-3">
                <label htmlFor="product-filter">Search</label>
                <input
                  id="product-filter"
                  autoFocus
                  value={productFilter}
                  onChange={(e) => setProductFilter(e.target.value)}
                  placeholder="Name or SKU"
                />
              </div>
              <div className="max-h-[420px] overflow-auto border border-[#aaa] bg-white">
                <table className="pos-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Description</th>
                      <th>Price</th>
                      <th>Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product) => (
                      <tr
                        key={product.id}
                        onDoubleClick={() =>
                          addProduct(product, Number(qtyInput) || 1)
                        }
                        onClick={() =>
                          addProduct(product, Number(qtyInput) || 1)
                        }
                        style={{ cursor: "pointer" }}
                      >
                        <td>{product.sku || "—"}</td>
                        <td>{product.name}</td>
                        <td>{formatAmount(product.price)}</td>
                        <td>{product.stock}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  className="pos-btn"
                  onClick={() => setShowProducts(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showPayment ? (
        <div
          className="pos-modal-backdrop"
          onClick={() => setShowPayment(false)}
        >
          <div className="pos-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pos-modal-header">Payment</div>
            <form className="pos-modal-body space-y-3" onSubmit={checkout}>
              <div className="border border-[#888] bg-black px-3 py-2 text-[#2ee6a8]">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>{formatAmount(pricing.subtotal)}</span>
                </div>
                {pricing.discount > 0 ? (
                  <div className="flex justify-between text-sm">
                    <span>Discount ({pricing.percent}%)</span>
                    <span>-{formatAmount(pricing.discount)}</span>
                  </div>
                ) : null}
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-sm font-bold">TOTAL</span>
                  <span className="font-mono text-2xl font-bold">
                    {formatAmount(total)}
                  </span>
                </div>
              </div>
              <div className="pos-field">
                <label htmlFor="pricing-mode">Pricing</label>
                <select
                  id="pricing-mode"
                  value={pricingMode}
                  onChange={(e) =>
                    setPricingMode(e.target.value as PricingMode)
                  }
                >
                  <option value="REGULAR">Regular (normal price)</option>
                  <option value="WHOLESALE">
                    Wholesale (each item wholesale price)
                  </option>
                  <option value="VOLUME">
                    Volume % (by total 100 / 200 / 300)
                  </option>
                </select>
              </div>
              {pricingMode === "VOLUME" ? (
                <div className="border border-[#aaa] bg-white px-3 py-2 text-xs">
                  ≥100 → {volumeDiscounts.at100}% · ≥200 →{" "}
                  {volumeDiscounts.at200}% · ≥300 → {volumeDiscounts.at300}%
                  {pricing.percent > 0
                    ? ` · Applied now: ${pricing.percent}%`
                    : " · No discount yet (total under 100)"}
                </div>
              ) : null}
              <div className="pos-field">
                <label htmlFor="pay-method">Payment method</label>
                <select
                  id="pay-method"
                  value={paymentMethodId}
                  onChange={(e) => setPaymentMethodId(e.target.value)}
                  required
                >
                  {methods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
              {error ? (
                <div className="border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              ) : null}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  className="pos-btn"
                  onClick={() => setShowPayment(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="pos-btn" disabled={loading}>
                  {loading ? "Processing..." : "Complete Sale"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {stockAlert ? (
        <div
          className="pos-modal-backdrop"
          onClick={() => setStockAlert(null)}
        >
          <div
            className="pos-modal"
            style={{ width: "min(420px, 100%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pos-modal-header">Not enough stock</div>
            <div className="pos-modal-body space-y-3">
              <p className="text-sm font-semibold text-[#b00020]">
                There is not this quantity in stock.
              </p>
              <div className="border border-[#aaa] bg-white px-3 py-2 text-sm">
                <div>
                  <strong>Item:</strong> {stockAlert.name}
                </div>
                <div>
                  <strong>You asked for:</strong> {stockAlert.wanted}
                </div>
                <div>
                  <strong>Available in stock:</strong> {stockAlert.available}
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  className="pos-btn"
                  onClick={() => setStockAlert(null)}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
