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
import { StoreLogo } from "@/components/StoreLogo";
import { UpdateNotice } from "@/components/UpdateNotice";
import { wholesaleQtyError, clampWholesaleQty } from "@/lib/wholesale";
import {
  computeTenderChange,
  DEFAULT_USD_TO_LBP,
  formatLbp,
  formatRate,
  formatUsd,
  toLbp,
  type PayCurrency,
} from "@/lib/fx";
import {
  discountForLines,
  parseMaxDiscount,
  pricingModeLabel,
  suggestPriceMode,
  tierPercent,
  unitPriceFor,
  VOLUME_TIERS,
  type PricingMode,
  type TierPercents,
} from "@/lib/price-tiers";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  barcode?: string | null;
  price: number;
  wholesalePrice?: number;
  onlinePrice?: number;
  retailPrice?: number;
  maxDiscountPercent?: number | null;
  wholesaleMinQty?: number;
  wholesaleMaxQty?: number;
  stock: number;
};

type PaymentMethod = { id: string; name: string };

type CartLine = {
  productId: string;
  name: string;
  price: number;
  wholesalePrice: number;
  onlinePrice: number;
  retailPrice: number;
  maxDiscountPercent: number | null;
  wholesaleMinQty: number;
  wholesaleMaxQty: number;
  stock: number;
  quantity: number;
  unit: string;
};

type SessionInfo = {
  name: string;
  role: Role;
};

const EMPTY_TIERS: TierPercents = {
  ABOVE_500: 0,
  ABOVE_1000: 0,
  ABOVE_3000: 0,
  ABOVE_5000: 0,
  ABOVE_7000: 0,
  ABOVE_10000: 0,
};

function formatAmount(amount: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
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
  const [storeName, setStoreName] = useState("VANO");
  const [usdToLbpRate, setUsdToLbpRate] = useState(DEFAULT_USD_TO_LBP);
  const [taxRate, setTaxRate] = useState(0);
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
  const [tierPercents, setTierPercents] = useState<TierPercents>(EMPTY_TIERS);
  const [pricingLocked, setPricingLocked] = useState(false);
  const [discountInput, setDiscountInput] = useState("");
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null);
  const [qtyDraft, setQtyDraft] = useState("");
  const [status, setStatus] = useState(
    "Ready. Scan barcode or type product description."
  );
  const [linkState, setLinkState] = useState("Checking connection…");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastReceiptId, setLastReceiptId] = useState<string | null>(null);
  const [showProducts, setShowProducts] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [payCurrency, setPayCurrency] = useState<PayCurrency>("USD");
  const [changeCurrency, setChangeCurrency] = useState<PayCurrency>("USD");
  const [tendered, setTendered] = useState("");
  const [stockAlert, setStockAlert] = useState<{
    name: string;
    wanted: number;
    available: number;
  } | null>(null);
  const [productFilter, setProductFilter] = useState("");

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
      if (me.usdToLbpRate) setUsdToLbpRate(Number(me.usdToLbpRate) || DEFAULT_USD_TO_LBP);
      setTaxRate(Number(me.taxRate) || 0);
      if (me.priceTiers) setTierPercents({ ...EMPTY_TIERS, ...me.priceTiers });
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
    let stop = false;
    async function pull() {
      try {
        const res = await fetch("/api/sync/status");
        const data = await res.json();
        if (stop) return;
        const waiting = Number(data.pending || 0);
        const base =
          data.mode === "offline"
            ? `Offline. ${waiting} sale${waiting === 1 ? "" : "s"} saved on this PC.`
            : data.mode === "syncing"
              ? `Syncing. ${waiting} sale${waiting === 1 ? "" : "s"} waiting to upload.`
              : waiting > 0
                ? `Online. ${waiting} sale${waiting === 1 ? "" : "s"} still waiting.`
                : "Online";
        const stale = data.catalogStale
          ? " Prices and stock are from the last connection."
          : "";
        const failed = Number(data.failed || 0);
        const conflict = Number(data.conflict || 0);
        setLinkState(
          base +
            stale +
            (failed > 0
              ? ` ${failed} sale${failed === 1 ? "" : "s"} need attention.`
              : "") +
            (conflict > 0
              ? ` ${conflict} uploaded with a stock difference.`
              : "")
        );
      } catch {
        if (!stop) setLinkState("Offline. Sales stay on this computer.");
      }
    }
    void pull();
    const timer = setInterval(pull, 8000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
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

  const regularSubtotal = useMemo(
    () =>
      Number(
        cart.reduce((sum, line) => sum + line.price * line.quantity, 0).toFixed(2)
      ),
    [cart]
  );
  const suggestedMode = useMemo(
    () => suggestPriceMode(regularSubtotal, tierPercents),
    [regularSubtotal, tierPercents]
  );

  useEffect(() => {
    if (pricingLocked && isOwner) return;
    setPricingMode(suggestedMode);
  }, [suggestedMode, pricingLocked, isOwner]);

  useEffect(() => {
    if (cart.length === 0) setPricingLocked(false);
  }, [cart.length]);

  const pricing = useMemo(() => {
    const subtotal = cart.reduce((sum, line) => {
      return sum + unitPriceFor(pricingMode, line) * line.quantity;
    }, 0);
    const rounded = Number(subtotal.toFixed(2));
    let discount = 0;
    let discountPercent = 0;
    let capped = false;
    const tierPct = tierPercent(pricingMode, tierPercents);
    if (tierPct > 0) {
      const lines = cart.map((line) => ({
        amount: unitPriceFor(pricingMode, line) * line.quantity,
        maxDiscountPercent: line.maxDiscountPercent,
      }));
      const priced = discountForLines(lines, tierPct);
      discountPercent = tierPct;
      discount = priced.discount;
      capped = priced.capped;
    } else if (isOwner) {
      const raw = Number(discountInput);
      if (Number.isFinite(raw) && raw > 0) {
        discountPercent = Math.min(raw, 100);
        discount = Number(((rounded * discountPercent) / 100).toFixed(2));
      }
    }
    const taxable = Number((rounded - discount).toFixed(2));
    const rate = Number.isFinite(taxRate) && taxRate > 0 ? taxRate : 0;
    const tax = Number(((taxable * rate) / 100).toFixed(2));
    const total = Number((taxable + tax).toFixed(2));
    return { subtotal: rounded, discount, discountPercent, capped, tax, taxRate: rate, total };
  }, [cart, pricingMode, discountInput, isOwner, taxRate, tierPercents]);

  const total = pricing.total;
  const holdPrice = useRef(false);

  useEffect(() => {
    if (holdPrice.current) {
      if (cart.length === 0) holdPrice.current = false;
      return;
    }
    const amount = cart.length === 0 ? 0 : total;
    const timer = setTimeout(() => {
      void fetch("/api/pos/display", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [total, cart.length]);
  const totalLbp = toLbp(total, usdToLbpRate);
  const tenderPreview = computeTenderChange({
    totalUsd: total,
    rate: usdToLbpRate,
    payCurrency,
    tendered: Number(tendered) || 0,
  });

  const addProduct = useCallback((product: Product, qty = 1) => {
    const wsPrice = product.wholesalePrice || 0;
    const wsMin = product.wholesaleMinQty || 0;
    const wsMax = product.wholesaleMaxQty || 0;
    let amount = Math.max(1, Math.floor(qty));
    if (pricingMode === "WHOLESALE" && wsPrice > 0 && wsMin > 0) {
      amount = Math.max(amount, wsMin);
    }
    const wsErr =
      pricingMode === "WHOLESALE"
        ? wholesaleQtyError(amount, {
            wholesalePrice: wsPrice,
            wholesaleMinQty: wsMin,
            wholesaleMaxQty: wsMax,
          })
        : null;
    if (wsErr) {
      setError(wsErr);
      setStatus(wsErr);
      return;
    }
    setError("");
    let blocked = false;
    setCart((prev) => {
      const existing = prev.find((line) => line.productId === product.id);
      if (existing) {
        const wantedTotal = existing.quantity + amount;
        const addErr =
          pricingMode === "WHOLESALE"
            ? wholesaleQtyError(wantedTotal, {
                wholesalePrice: wsPrice,
                wholesaleMinQty: wsMin,
                wholesaleMaxQty: wsMax,
              })
            : null;
        if (addErr) {
          blocked = true;
          setError(addErr);
          setStatus(addErr);
          return prev;
        }
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
        const qtyOnHand =
          pricingMode === "WHOLESALE" && wsPrice > 0
            ? clampWholesaleQty(product.stock, {
                wholesaleMinQty: wsMin,
                wholesaleMaxQty: wsMax,
                stock: product.stock,
              })
            : product.stock;
        if (qtyOnHand < 1) return prev;
        return [
          ...prev,
          {
            productId: product.id,
            name: product.name,
            price: product.price,
            wholesalePrice: wsPrice,
            onlinePrice: product.onlinePrice || 0,
            retailPrice: product.retailPrice || 0,
            maxDiscountPercent: parseMaxDiscount(product.maxDiscountPercent),
            wholesaleMinQty: wsMin,
            wholesaleMaxQty: wsMax,
            stock: product.stock,
            quantity: qtyOnHand,
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
          wholesalePrice: wsPrice,
          onlinePrice: product.onlinePrice || 0,
          retailPrice: product.retailPrice || 0,
          maxDiscountPercent: parseMaxDiscount(product.maxDiscountPercent),
          wholesaleMinQty: wsMin,
          wholesaleMaxQty: wsMax,
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
  }, [pricingMode]);

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
    setDiscountInput("");
    setError("");
    setStatus("New sale started. Scan barcode or type product description.");
    searchRef.current?.focus();
  }

  function beginQtyEdit(line: CartLine) {
    setSelectedId(line.productId);
    setEditingQtyId(line.productId);
    setQtyDraft(String(line.quantity));
  }

  async function applyLineQty(line: CartLine, wanted: number) {
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
            l.productId === line.productId
              ? { ...l, quantity: available, stock: available }
              : l
          )
        );
      }
      return;
    }

    if (pricingMode === "WHOLESALE") {
      const wsErr = wholesaleQtyError(wanted, {
        wholesalePrice: line.wholesalePrice,
        wholesaleMinQty: line.wholesaleMinQty,
        wholesaleMaxQty: line.wholesaleMaxQty,
      });
      if (wsErr) {
        setError(wsErr);
        setStatus(wsErr);
        return;
      }
    }

    setError("");
    setStockAlert(null);
    setCart((prev) =>
      prev.map((l) =>
        l.productId === line.productId
          ? { ...l, quantity: wanted, stock: available }
          : l
      )
    );
    setEditingQtyId(null);
    setStatus(`Quantity updated to ${wanted}.`);
  }

  function changeQty() {
    if (!selectedId) {
      setStatus("Select a line item first.");
      return;
    }
    const line = cart.find((l) => l.productId === selectedId);
    if (!line) return;
    beginQtyEdit(line);
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
    if (pricingMode === "WHOLESALE") {
      for (const line of cart) {
        const wsErr = wholesaleQtyError(line.quantity, {
          wholesalePrice: line.wholesalePrice,
          wholesaleMinQty: line.wholesaleMinQty,
          wholesaleMaxQty: line.wholesaleMaxQty,
        });
        if (wsErr) {
          setError(`${line.name}: ${wsErr}`);
          setStatus(`${line.name}: ${wsErr}`);
          return;
        }
      }
    }
    setPayCurrency("USD");
    setChangeCurrency("USD");
    setTendered(total.toFixed(2));
    setShowPayment(true);
    setStatus("Select payment currency and complete the sale.");
  }

  function choosePricing(mode: PricingMode) {
    setPricingMode(mode);
    if (isOwner) setPricingLocked(true);
  }

  function exitPos() {
    if (isOwner) {
      router.push("/owner");
      return;
    }
    void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
      router.push("/login");
      router.refresh();
    });
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
        payCurrency,
        changeCurrency,
        amountTendered: Number(tendered),
        discount: isOwner ? pricing.discount : 0,
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
    setProducts((prev) =>
      prev.map((product) => {
        const sold = cart.find((line) => line.productId === product.id);
        if (!sold) return product;
        return {
          ...product,
          stock: Math.max(0, product.stock - sold.quantity),
        };
      })
    );
    holdPrice.current = true;
    void fetch("/api/pos/display", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: data.sale.total }),
    });
    setShowPayment(false);
    setCart([]);
    setSelectedId(null);
    setDiscountInput("");
    setTendered("");
    setStatus(`Sale complete. Receipt ${data.sale.receiptNumber || ""}.`);
    router.push(`/receipts/${data.sale.id}?print=1`);
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
      } else if (e.key === "Delete" && !typing) {
        e.preventDefault();
        voidItem();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, selectedId]);

  return (
    <div className="pos-shell">
      <div className="pos-title">
        <StoreLogo size={26} />
        {storeName.toUpperCase()} - POS System
        <span className="pos-link">{linkState}</span>
        <UpdateNotice />
        <button type="button" className="pos-btn pos-exit" onClick={exitPos}>
          Exit POS
        </button>
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
            disabled={!isOwner}
            onChange={(e) => choosePricing(e.target.value as PricingMode)}
            style={{ fontWeight: 600 }}
          >
            <option value="REGULAR">Regular</option>
            <option value="WHOLESALE">Wholesale</option>
            <option value="ONLINE">Online</option>
            <option value="RETAIL">Retail</option>
            {VOLUME_TIERS.map((tier) => (
              <option key={tier.mode} value={tier.mode}>
                {pricingModeLabel(tier.mode, tierPercents)}
              </option>
            ))}
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
                const unit = unitPriceFor(pricingMode, line);
                return (
                <tr
                  key={line.productId}
                  data-selected={selectedId === line.productId}
                  onClick={() => setSelectedId(line.productId)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="pos-qty">
                      <button
                        type="button"
                        className="pos-qty-btn"
                        onClick={() => applyLineQty(line, line.quantity - 1)}
                      >
                        −
                      </button>
                      {editingQtyId === line.productId ? (
                        <input
                          className="pos-qty-input"
                          autoFocus
                          type="number"
                          min={1}
                          value={qtyDraft}
                          onChange={(e) => setQtyDraft(e.target.value)}
                          onBlur={() =>
                            applyLineQty(line, Math.floor(Number(qtyDraft)))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              (e.currentTarget as HTMLInputElement).blur();
                            }
                            if (e.key === "Escape") setEditingQtyId(null);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="pos-qty-value"
                          onClick={() => beginQtyEdit(line)}
                        >
                          {line.quantity.toFixed(2)}
                        </button>
                      )}
                      <button
                        type="button"
                        className="pos-qty-btn"
                        onClick={() => applyLineQty(line, line.quantity + 1)}
                      >
                        +
                      </button>
                    </div>
                  </td>
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
            {pricing.tax > 0
              ? `TOTAL (incl. ${pricing.taxRate}% tax)`
              : pricing.discount > 0
                ? "TOTAL (discount)"
                : "TOTAL"}
          </span>
          <div className="text-right">
            <div className="pos-total-value">{formatUsd(total)}</div>
            <div className="mt-1 text-sm font-semibold tracking-wide opacity-85">
              {formatLbp(totalLbp)}
            </div>
          </div>
          <div className="pos-rate">1 $ = {formatRate(usdToLbpRate)} L.L</div>
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
                  <span>{formatUsd(pricing.subtotal)}</span>
                </div>
                {pricing.discount > 0 ? (
                  <div className="flex justify-between text-sm">
                    <span>
                      {pricing.capped
                        ? "Discount"
                        : `Discount ${pricing.discountPercent}%`}
                    </span>
                    <span>-{formatUsd(pricing.discount)}</span>
                  </div>
                ) : null}
                {pricing.tax > 0 ? (
                  <div className="flex justify-between text-sm">
                    <span>Tax {pricing.taxRate}%</span>
                    <span>{formatUsd(pricing.tax)}</span>
                  </div>
                ) : null}
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-sm font-bold">TOTAL $</span>
                  <span className="font-mono text-2xl font-bold">
                    {formatUsd(total)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">TOTAL L.L</span>
                  <span className="font-mono text-xl font-bold">
                    {formatLbp(totalLbp)}
                  </span>
                </div>
                <div className="mt-1 text-[11px] opacity-80">
                  Rate: 1 $ = {formatRate(usdToLbpRate)} L.L
                </div>
              </div>
              {isOwner ? (
                <div className="pos-field">
                  <label htmlFor="owner-discount">Discount %</label>
                  <input
                    id="owner-discount"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={discountInput}
                    disabled={tierPercent(pricingMode, tierPercents) > 0}
                    onChange={(e) => setDiscountInput(e.target.value)}
                    placeholder="0"
                  />
                  {pricing.discount > 0 && tierPercent(pricingMode, tierPercents) === 0 ? (
                    <div className="mt-1 text-[11px] text-slate-600">
                      {pricing.discountPercent}% off = -{formatUsd(pricing.discount)}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="pos-field">
                <label htmlFor="pricing-mode">Pricing</label>
                <select
                  id="pricing-mode"
                  value={pricingMode}
                  disabled={!isOwner}
                  onChange={(e) => choosePricing(e.target.value as PricingMode)}
                >
                  <option value="REGULAR">Regular (normal price)</option>
                  <option value="WHOLESALE">Wholesale</option>
                  <option value="ONLINE">Online</option>
                  <option value="RETAIL">Retail</option>
                  {VOLUME_TIERS.map((tier) => (
                    <option key={tier.mode} value={tier.mode}>
                      {pricingModeLabel(tier.mode, tierPercents)}
                    </option>
                  ))}
                </select>
                {pricing.discount > 0 ? (
                  <div className="mt-1 text-[11px] text-slate-600">
                    {pricingModeLabel(pricingMode, tierPercents)}
                    {pricing.capped ? " (some items are capped)" : ""}:{" "}
                    {pricing.capped
                      ? `-${formatUsd(pricing.discount)}`
                      : `${pricing.discountPercent}% off = -${formatUsd(pricing.discount)}`}
                  </div>
                ) : null}
              </div>
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
              <div className="pos-field">
                <label htmlFor="pay-currency">Customer pays in</label>
                <select
                  id="pay-currency"
                  value={payCurrency}
                  onChange={(e) => {
                    const next = e.target.value as PayCurrency;
                    setPayCurrency(next);
                    setTendered(
                      next === "USD"
                        ? total.toFixed(2)
                        : String(Math.round(totalLbp))
                    );
                  }}
                >
                  <option value="USD">Dollars ($)</option>
                  <option value="LBP">Lebanese Lira (L.L)</option>
                </select>
              </div>
              <div className="pos-field">
                <label htmlFor="tendered">
                  Amount received ({payCurrency === "LBP" ? "L.L" : "$"})
                  {payCurrency === "LBP" && tendered
                    ? ` — ${formatLbp(Number(tendered) || 0)}`
                    : ""}
                </label>
                <input
                  id="tendered"
                  type="number"
                  step={payCurrency === "LBP" ? "1" : "0.01"}
                  min="0"
                  required
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value)}
                />
              </div>
              <div className="border border-[#aaa] bg-white px-3 py-2 text-sm">
                <div className="mb-1 font-bold">Change</div>
                <div className="flex justify-between">
                  <span>Dollars</span>
                  <span className="font-mono font-semibold">
                    {formatUsd(tenderPreview.changeUsd)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>L.L</span>
                  <span className="font-mono font-semibold">
                    {formatLbp(tenderPreview.changeLbp)}
                  </span>
                </div>
              </div>
              <div className="pos-field">
                <label htmlFor="change-currency">Give change in</label>
                <select
                  id="change-currency"
                  value={changeCurrency}
                  onChange={(e) =>
                    setChangeCurrency(e.target.value as PayCurrency)
                  }
                >
                  <option value="USD">Dollars ($)</option>
                  <option value="LBP">Lebanese Lira (L.L)</option>
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
                <button
                  type="submit"
                  className="pos-btn"
                  disabled={
                    loading ||
                    (payCurrency === "USD"
                      ? (Number(tendered) || 0) + 0.001 < tenderPreview.dueUsd
                      : (Number(tendered) || 0) + 0.001 < tenderPreview.dueLbp)
                  }
                >
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
