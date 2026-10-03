// Report calculations run on the device, from the rows in the local SQLite database. Each
// function mirrors the server endpoint of the same name in InventoryApi/src/routes/reports.js
// (and utils/reportMath.js) — same formulas, same response shape — so the screens can show
// identical numbers online or offline. Pure functions over plain arrays: no React Native or
// database imports, so they can be checked against the server (scripts/report-parity.js).
//
// Item identity on the device is `localId` (an item created offline has no server id yet);
// responses use it wherever the server returns an itemId.
//
// Price history is derived from stock transactions: the server writes a purchase price point
// for every 'in' (and every 'transfer_in' that carries a cost: stock moved in from another branch
// takes the cost it had there) and a sale price point for every 'out', at the transaction's occurredAt.

const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const time = (v) => new Date(v).getTime();

// Matches the server's `new Date(from)` / `new Date(to)` bounds (inclusive on both ends).
function inRange(tx, { from, to } = {}) {
  const t = time(tx.occurredAt);
  if (from && t < time(from)) return false;
  if (to && t > time(to)) return false;
  return true;
}

function isActive(item) {
  return item.isActive === undefined || item.isActive === null || item.isActive === 1 || item.isActive === true;
}

// Sales recorded before payment methods existed count as cash (same rule as the server).
export function paymentMethodOf(tx) {
  return ['transfer', 'pos', 'mixed'].includes(tx.paymentMethod) ? tx.paymentMethod : 'cash';
}

// A mixed payment's split, stored as JSON text on the device ({ cash, transfer, pos }).
function breakdownOf(tx) {
  if (!tx.paymentBreakdown) return null;
  if (typeof tx.paymentBreakdown === 'object') return tx.paymentBreakdown;
  try {
    return JSON.parse(tx.paymentBreakdown);
  } catch {
    return null;
  }
}

// What one sale row took in (or one return handed back) by method: { cash, transfer, pos }.
// Mirrors paidByMethod in the server's utils/salePayment.js.
export function paidByMethod(tx, paid) {
  const method = paymentMethodOf(tx);
  const breakdown = method === 'mixed' ? breakdownOf(tx) : null;
  if (breakdown) {
    const out = {};
    for (const m of ['cash', 'transfer', 'pos']) if (num(breakdown[m]) > 0) out[m] = num(breakdown[m]);
    return out;
  }
  return paid > 0 ? { [method === 'mixed' ? 'cash' : method]: paid } : {};
}

export function saleTotal(tx) {
  return num(tx.quantity) * num(tx.unitPrice);
}

// Paid at the time of sale: amountPaid for a part-paid/credit sale, otherwise the whole total
// (every sale before part payments existed was paid in full).
export function salePaid(tx) {
  return tx.amountPaid === null || tx.amountPaid === undefined ? saleTotal(tx) : num(tx.amountPaid);
}

export function saleOwed(tx) {
  return Math.max(0, saleTotal(tx) - salePaid(tx));
}

// Returns ('return' rows: a voided sale or items brought back) are valued at the sale's price.
// amountPaid is what was handed back; the rest came off what the customer owed for that sale.
export function returnRefund(tx) {
  return salePaid(tx);
}

export function returnDebtCut(tx) {
  return saleOwed(tx);
}

// A purchase price point: a stock-in, or stock moved in from another branch with its cost.
function isPurchasePoint(tx) {
  return (tx.type === 'in' || tx.type === 'transfer_in') && tx.unitPrice !== null && tx.unitPrice !== undefined;
}

function txId(tx) {
  return tx.id ?? tx.clientTransactionId;
}

function itemIndex(items) {
  return new Map(items.map((i) => [i.localId, i]));
}

// Purchase price points for an item, oldest first.
function purchasePoints(transactions, companyId) {
  const byItem = new Map();
  for (const tx of transactions) {
    if (!isPurchasePoint(tx) || tx.companyId !== companyId) continue;
    if (!byItem.has(tx.itemLocalId)) byItem.set(tx.itemLocalId, []);
    byItem.get(tx.itemLocalId).push({ amount: num(tx.unitPrice), effectiveDate: tx.occurredAt, t: time(tx.occurredAt) });
  }
  for (const points of byItem.values()) points.sort((a, b) => a.t - b.t);
  return byItem;
}

// The purchase price in effect at time t (the latest stock-in at or before it), or null.
function purchasePriceAt(history, t) {
  let price = null;
  for (const p of history || []) {
    if (p.t <= t) price = p;
    else break;
  }
  return price;
}

// RPT-01
export function stockOnHand(items, companyId, { category, itemId } = {}) {
  return items
    .filter((i) => i.companyId === companyId && isActive(i))
    .filter((i) => !category || i.category === category)
    .filter((i) => !itemId || i.localId === itemId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// RPT-02. Sales revenue is also split by how it was paid at the time of sale — the paid part
// under its method (cash/transfer), the unpaid part under 'credit' — and debt repayments received
// in the range are totalled by method.
export function salesVsPurchases(transactions, companyId, range = {}, payments = []) {
  let totalPurchaseCost = 0;
  let totalSalesRevenue = 0;
  let purchaseCount = 0;
  let saleCount = 0;
  let returnCount = 0;
  let returnsValue = 0;
  const salesByPaymentMethod = {
    cash: { revenue: 0, count: 0 }, transfer: { revenue: 0, count: 0 }, pos: { revenue: 0, count: 0 }, credit: { revenue: 0, count: 0 },
  };
  for (const tx of transactions) {
    if (tx.companyId !== companyId || !inRange(tx, range)) continue;
    if (tx.type === 'in') {
      totalPurchaseCost += num(tx.quantity) * num(tx.unitPrice);
      purchaseCount += 1;
    } else if (tx.type === 'out') {
      totalSalesRevenue += saleTotal(tx);
      saleCount += 1;
      const owed = saleOwed(tx);
      for (const [method, amount] of Object.entries(paidByMethod(tx, salePaid(tx)))) {
        salesByPaymentMethod[method].revenue += amount;
        salesByPaymentMethod[method].count += 1;
      }
      if (owed > 0) {
        salesByPaymentMethod.credit.revenue += owed;
        salesByPaymentMethod.credit.count += 1;
      }
    } else if (tx.type === 'return') {
      // Sales money is net of returns: what was handed back comes off its method, the rest
      // (debt cancelled) off credit.
      totalSalesRevenue -= saleTotal(tx);
      returnCount += 1;
      returnsValue += saleTotal(tx);
      for (const [method, amount] of Object.entries(paidByMethod(tx, returnRefund(tx)))) {
        salesByPaymentMethod[method].revenue -= amount;
      }
      salesByPaymentMethod.credit.revenue -= returnDebtCut(tx);
    }
  }
  const repayments = { cash: { amount: 0, count: 0 }, transfer: { amount: 0, count: 0 }, pos: { amount: 0, count: 0 }, total: 0 };
  for (const p of payments) {
    if (p.companyId !== companyId || !inRange(p, range)) continue;
    const bucket = repayments[p.paymentMethod] || repayments.cash;
    bucket.amount += num(p.amount);
    bucket.count += 1;
    repayments.total += num(p.amount);
  }
  return {
    totalPurchaseCost, totalSalesRevenue, margin: totalSalesRevenue - totalPurchaseCost, purchaseCount, saleCount,
    returnCount, returnsValue, salesByPaymentMethod, repayments,
  };
}

// Everyone who owes (or owed) this company money, grouped by normalized phone: the unpaid part
// of their sales minus their repayments. Outstanding counts positive balances only (an
// overpayment is the customer's credit). Not date-filtered — a debt is owed until it's paid.
// Mirrors summarizeDebtors on the server.
export function debtors(transactions, payments, companyId) {
  const byPhone = new Map();
  const customer = (phone, name, at) => {
    if (!byPhone.has(phone)) {
      byPhone.set(phone, { customerPhone: phone, customerName: name, totalOwed: 0, totalRepaid: 0, creditSales: 0, lastActivityAt: at, saleKeys: new Set() });
    }
    const c = byPhone.get(phone);
    if (time(at) >= time(c.lastActivityAt)) {
      c.lastActivityAt = at;
      if (name) c.customerName = name;
    }
    return c;
  };
  const sales = transactions
    .filter((tx) => (tx.type === 'out' || tx.type === 'return') && tx.companyId === companyId && tx.customerPhone)
    .sort((a, b) => time(a.occurredAt) - time(b.occurredAt));
  for (const tx of sales) {
    if (tx.type === 'return') {
      // A return of a credit sale takes the returned value off what the customer owes.
      const cut = returnDebtCut(tx);
      if (cut > 0 && byPhone.has(tx.customerPhone)) byPhone.get(tx.customerPhone).totalOwed -= cut;
      continue;
    }
    const owed = saleOwed(tx);
    if (owed <= 0) continue;
    const c = customer(tx.customerPhone, tx.customerName, tx.occurredAt);
    c.totalOwed += owed;
    // The rows of one multi-item sale share a saleId and count as one sale.
    c.saleKeys.add(tx.saleId || tx);
  }
  const received = payments.filter((p) => p.companyId === companyId).sort((a, b) => time(a.occurredAt) - time(b.occurredAt));
  for (const p of received) {
    const c = customer(p.customerPhone, p.customerName, p.occurredAt);
    c.totalRepaid += num(p.amount);
  }
  const customers = [...byPhone.values()]
    .map(({ saleKeys, ...c }) => ({ ...c, creditSales: saleKeys.size, balance: Math.round((c.totalOwed - c.totalRepaid) * 100) / 100 }))
    .sort((a, b) => b.balance - a.balance || a.customerName.localeCompare(b.customerName));
  const owing = customers.filter((c) => c.balance > 0);
  return {
    customers,
    totals: {
      outstanding: owing.reduce((sum, c) => sum + c.balance, 0),
      customersOwing: owing.length,
      totalRepaid: customers.reduce((sum, c) => sum + c.totalRepaid, 0),
    },
  };
}

// Everyone this company bought from (purchases naming a supplier's phone): what was bought, what
// was left unpaid at the time, what's been paid since, and the balance still owed. Lists paid-up
// suppliers too. Not date-filtered. Mirrors summarizeSuppliers on the server.
export function suppliers(transactions, supplierPayments, companyId) {
  const byPhone = new Map();
  const supplier = (phone, name, at) => {
    if (!byPhone.has(phone)) {
      byPhone.set(phone, { supplierPhone: phone, supplierName: name, totalBought: 0, totalOwed: 0, totalPaid: 0, purchases: 0, lastActivityAt: at });
    }
    const s = byPhone.get(phone);
    if (time(at) >= time(s.lastActivityAt)) {
      s.lastActivityAt = at;
      if (name) s.supplierName = name;
    }
    return s;
  };
  const purchases = transactions
    .filter((tx) => tx.type === 'in' && tx.companyId === companyId && tx.supplierPhone)
    .sort((a, b) => time(a.occurredAt) - time(b.occurredAt));
  for (const tx of purchases) {
    const s = supplier(tx.supplierPhone, tx.supplierName, tx.occurredAt);
    s.totalBought += saleTotal(tx);
    s.totalOwed += saleOwed(tx);
    s.purchases += 1;
  }
  const paid = supplierPayments.filter((p) => p.companyId === companyId).sort((a, b) => time(a.occurredAt) - time(b.occurredAt));
  for (const p of paid) {
    const s = supplier(p.supplierPhone, p.supplierName, p.occurredAt);
    s.totalPaid += num(p.amount);
  }
  const round = (n) => Math.round(n * 100) / 100;
  const list = [...byPhone.values()]
    .map((s) => ({ ...s, totalBought: round(s.totalBought), totalOwed: round(s.totalOwed), balance: round(s.totalOwed - s.totalPaid) }))
    .sort((a, b) => b.balance - a.balance || a.supplierName.localeCompare(b.supplierName));
  const owed = list.filter((s) => s.balance > 0);
  return {
    suppliers: list,
    totals: {
      outstanding: round(owed.reduce((sum, s) => sum + s.balance, 0)),
      suppliersOwed: owed.length,
      totalPaid: round(list.reduce((sum, s) => sum + s.totalPaid, 0)),
    },
  };
}

// One supplier's purchases and the payments made to them, newest first.
export function supplierLedger(items, transactions, supplierPayments, companyId, supplierPhone) {
  const byLocalId = itemIndex(items);
  const purchases = transactions
    .filter((tx) => tx.type === 'in' && tx.companyId === companyId && tx.supplierPhone === supplierPhone)
    .sort((a, b) => time(b.occurredAt) - time(a.occurredAt))
    .map((tx) => ({
      transactionId: txId(tx),
      itemName: byLocalId.get(tx.itemLocalId)?.name ?? null,
      unit: byLocalId.get(tx.itemLocalId)?.unit ?? null,
      quantity: num(tx.quantity),
      total: saleTotal(tx),
      amountPaid: salePaid(tx),
      owed: saleOwed(tx),
      expiryDate: tx.expiryDate || null,
      occurredAt: tx.occurredAt,
      pending: tx.syncStatus !== 'synced',
    }));
  const payments = supplierPayments
    .filter((p) => p.companyId === companyId && p.supplierPhone === supplierPhone)
    .sort((a, b) => time(b.occurredAt) - time(a.occurredAt))
    .map((p) => ({ id: p.id ?? p.clientPaymentId, amount: num(p.amount), paymentMethod: p.paymentMethod, occurredAt: p.occurredAt, pending: p.syncStatus !== 'synced' }));
  return { purchases, payments };
}

// Stock that expires soon or already has, from the expiry dates recorded on stock-ins. What's on
// hand is assumed to be the most recent deliveries (older stock sells first), so a batch counts
// only for the part of it still on the shelf. Device only; no server twin.
export function expiringStock(items, transactions, companyId, { now = new Date(), withinDays = 30 } = {}) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const batchesByItem = new Map();
  for (const tx of transactions) {
    if (tx.type !== 'in' || tx.companyId !== companyId || !tx.expiryDate) continue;
    if (!batchesByItem.has(tx.itemLocalId)) batchesByItem.set(tx.itemLocalId, []);
    batchesByItem.get(tx.itemLocalId).push(tx);
  }
  // Every stock-in counts towards what's on hand, dated or not, newest first.
  const deliveriesByItem = new Map();
  for (const tx of transactions) {
    if (tx.type !== 'in' || tx.companyId !== companyId || !batchesByItem.has(tx.itemLocalId)) continue;
    if (!deliveriesByItem.has(tx.itemLocalId)) deliveriesByItem.set(tx.itemLocalId, []);
    deliveriesByItem.get(tx.itemLocalId).push(tx);
  }
  const rows = [];
  for (const item of items) {
    if (item.companyId !== companyId || !isActive(item) || !deliveriesByItem.has(item.localId)) continue;
    let left = num(item.quantityOnHand);
    const deliveries = deliveriesByItem.get(item.localId).sort((a, b) => time(b.occurredAt) - time(a.occurredAt));
    for (const tx of deliveries) {
      if (left <= 0) break;
      const onShelf = Math.min(left, num(tx.quantity));
      left -= onShelf;
      if (!tx.expiryDate) continue;
      const [y, m, d] = String(tx.expiryDate).slice(0, 10).split('-').map(Number);
      const expires = new Date(y, m - 1, d).getTime();
      const daysLeft = Math.round((expires - today) / 86400000);
      if (daysLeft > withinDays) continue;
      rows.push({
        itemId: item.localId,
        itemName: item.name,
        unit: item.unit,
        quantity: Math.round(onShelf * 100) / 100,
        expiryDate: String(tx.expiryDate).slice(0, 10),
        daysLeft,
        expired: daysLeft < 0,
        value: Math.round(onShelf * num(tx.unitPrice) * 100) / 100,
      });
    }
  }
  return rows.sort((a, b) => a.daysLeft - b.daysLeft || a.itemName.localeCompare(b.itemName));
}

// One customer's credit sales and repayments, newest first.
export function customerLedger(items, transactions, payments, companyId, customerPhone) {
  const byLocalId = itemIndex(items);
  const sales = transactions
    .filter((tx) => tx.type === 'out' && tx.companyId === companyId && tx.customerPhone === customerPhone)
    .sort((a, b) => time(b.occurredAt) - time(a.occurredAt))
    .map((tx) => ({
      transactionId: txId(tx),
      clientTransactionId: tx.clientTransactionId,
      saleId: tx.saleId || null,
      itemName: byLocalId.get(tx.itemLocalId)?.name ?? null,
      quantity: num(tx.quantity),
      total: saleTotal(tx),
      amountPaid: salePaid(tx),
      owed: saleOwed(tx),
      paymentMethod: paymentMethodOf(tx),
      occurredAt: tx.occurredAt,
      pending: tx.syncStatus !== 'synced',
    }));
  // Returns of this customer's credit sales: what came off what they owed (shown on the sale).
  const cutBySale = new Map();
  for (const tx of transactions) {
    if (tx.type !== 'return' || tx.companyId !== companyId || tx.customerPhone !== customerPhone) continue;
    cutBySale.set(tx.returnOf, (cutBySale.get(tx.returnOf) || 0) + returnDebtCut(tx));
  }
  for (const row of sales) {
    const cut = cutBySale.get(row.clientTransactionId) || 0;
    row.returned = cut;
    row.owed = Math.max(0, Math.round((row.owed - cut) * 100) / 100);
  }
  const repayments = payments
    .filter((p) => p.companyId === companyId && p.customerPhone === customerPhone)
    .sort((a, b) => time(b.occurredAt) - time(a.occurredAt))
    .map((p) => ({
      id: p.id ?? p.clientPaymentId,
      amount: num(p.amount),
      paymentMethod: p.paymentMethod,
      occurredAt: p.occurredAt,
      pending: p.syncStatus !== 'synced',
    }));
  return { sales: groupSaleLines(sales), payments: repayments };
}

// The lines of one multi-item sale (same saleId) are shown as one sale: totals added up and
// `lines` listing each item. Single-item sales pass through with lines = [themselves].
function groupSaleLines(rows) {
  const out = [];
  const bySale = new Map();
  for (const row of rows) {
    const group = row.saleId ? bySale.get(row.saleId) : null;
    if (!group) {
      const entry = { ...row, lines: [row] };
      out.push(entry);
      if (row.saleId) bySale.set(row.saleId, entry);
      continue;
    }
    group.lines.push(row);
    group.quantity += row.quantity;
    group.total = Math.round((group.total + row.total) * 100) / 100;
    group.amountPaid = Math.round((group.amountPaid + row.amountPaid) * 100) / 100;
    group.owed = Math.round((group.owed + row.owed) * 100) / 100;
    group.returned = Math.round(((group.returned || 0) + (row.returned || 0)) * 100) / 100;
    group.pending = group.pending || row.pending;
  }
  return out;
}

// RPT-03: every active item, with all-time sales costed at the item's current last purchase price.
export function marginByItem(items, transactions, companyId) {
  const salesByItem = new Map();
  for (const tx of transactions) {
    if (tx.type !== 'out' && tx.type !== 'return') continue;
    if (!salesByItem.has(tx.itemLocalId)) salesByItem.set(tx.itemLocalId, []);
    salesByItem.get(tx.itemLocalId).push(tx);
  }
  // Returned units come off what was sold.
  const sign = (t) => (t.type === 'return' ? -1 : 1);
  const report = items
    .filter((i) => i.companyId === companyId && isActive(i))
    .map((item) => {
      const sales = salesByItem.get(item.localId) || [];
      const totalRevenue = sales.reduce((sum, t) => sum + sign(t) * num(t.quantity) * num(t.unitPrice), 0);
      const totalUnitsSold = sales.reduce((sum, t) => sum + sign(t) * num(t.quantity), 0);
      const estimatedCost = totalUnitsSold * num(item.lastPurchasePrice);
      return {
        itemId: item.localId,
        name: item.name,
        category: item.category,
        totalUnitsSold,
        totalRevenue,
        estimatedCost,
        estimatedMargin: totalRevenue - estimatedCost,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { report };
}

// PRC-03: recent sales, each costed at the purchase price in effect on the sale date.
export function transactionMargins(items, transactions, companyId, { itemId, from, to, limit } = {}) {
  const max = Math.min(Number(limit) || 50, 200);
  const byLocalId = itemIndex(items);
  const points = purchasePoints(transactions, companyId);

  const sales = transactions
    .filter((tx) => tx.type === 'out' && tx.companyId === companyId && (!itemId || tx.itemLocalId === itemId) && inRange(tx, { from, to }))
    .sort((a, b) => time(b.occurredAt) - time(a.occurredAt))
    .slice(0, max);

  const rows = sales.map((tx) => {
    const price = purchasePriceAt(points.get(tx.itemLocalId), time(tx.occurredAt));
    const item = byLocalId.get(tx.itemLocalId);
    const quantity = num(tx.quantity);
    const revenue = quantity * num(tx.unitPrice);
    const costAvailable = !!price;
    const estimatedCost = costAvailable ? quantity * price.amount : null;
    return {
      transactionId: txId(tx),
      itemId: tx.itemLocalId,
      itemName: item ? item.name : null,
      sku: item ? item.sku : null,
      quantity,
      unitPrice: num(tx.unitPrice),
      paymentMethod: paymentMethodOf(tx),
      amountPaid: salePaid(tx),
      customerName: tx.customerName || null,
      revenue,
      occurredAt: tx.occurredAt,
      costAvailable,
      estimatedCost,
      estimatedMargin: costAvailable ? revenue - estimatedCost : null,
    };
  });
  return { transactions: rows, limit: max, count: rows.length };
}

// The plain-language "How your business did" summary at the top of Reports (device only; built
// from the same rules as the reports below it). For the date range:
// - sales, stockBought and how the sales were paid (same numbers as salesVsPurchases);
// - profit: every sale costed at the purchase price in effect on its date (as transactionMargins,
//   but for all sales, not just the latest 50). Sales of items with no purchase price recorded
//   before the sale can't be costed; they're counted in salesWithoutCost instead;
// - the best-selling item by sales money, and how many items are at or below their alert level.
export function businessSummary(items, transactions, companyId, range = {}, payments = []) {
  const svp = salesVsPurchases(transactions, companyId, range, payments);
  const points = purchasePoints(transactions, companyId);
  const byLocalId = itemIndex(items);
  let profit = 0;
  let salesWithoutCost = 0;
  const salesByItem = new Map();
  for (const tx of transactions) {
    if ((tx.type !== 'out' && tx.type !== 'return') || tx.companyId !== companyId || !inRange(tx, range)) continue;
    // A return undoes its share of a sale: its value and its cost (at the purchase price in
    // effect when it came back) both come off.
    const sign = tx.type === 'return' ? -1 : 1;
    const revenue = sign * saleTotal(tx);
    const price = purchasePriceAt(points.get(tx.itemLocalId), time(tx.occurredAt));
    if (price) profit += revenue - sign * num(tx.quantity) * price.amount;
    else if (sign > 0) salesWithoutCost += 1;
    salesByItem.set(tx.itemLocalId, (salesByItem.get(tx.itemLocalId) || 0) + revenue);
  }
  let bestSeller = null;
  for (const [itemLocalId, revenue] of salesByItem) {
    if (!bestSeller || revenue > bestSeller.revenue) {
      bestSeller = { itemId: itemLocalId, name: byLocalId.get(itemLocalId)?.name ?? 'Unknown item', revenue };
    }
  }
  const lowStockCount = items.filter((i) => i.companyId === companyId && isActive(i) && num(i.quantityOnHand) <= num(i.lowStockThreshold)).length;
  return {
    sales: svp.totalSalesRevenue,
    saleCount: svp.saleCount,
    stockBought: svp.totalPurchaseCost,
    profit,
    salesWithoutCost,
    cash: svp.salesByPaymentMethod.cash.revenue,
    transfer: svp.salesByPaymentMethod.transfer.revenue,
    pos: svp.salesByPaymentMethod.pos.revenue,
    returnsValue: svp.returnsValue,
    owedFromTheseSales: svp.salesByPaymentMethod.credit.revenue,
    repaid: svp.repayments.total,
    bestSeller,
    lowStockCount,
  };
}

// RPT-04: expected (system) vs counted stock for every adjustment.
export function discrepancies(items, transactions, companyId, range = {}) {
  const byLocalId = itemIndex(items);
  const rows = transactions
    .filter((tx) => tx.type === 'adjustment' && tx.companyId === companyId && inRange(tx, range))
    .sort((a, b) => time(b.occurredAt) - time(a.occurredAt))
    .map((tx) => {
      const item = byLocalId.get(tx.itemLocalId);
      const discrepancyKnown = tx.previousQuantity !== null && tx.previousQuantity !== undefined;
      const expected = discrepancyKnown ? num(tx.previousQuantity) : null;
      const counted = num(tx.quantity);
      return {
        transactionId: txId(tx),
        itemId: tx.itemLocalId,
        itemName: item ? item.name : null,
        sku: item ? item.sku : null,
        occurredAt: tx.occurredAt,
        expected,
        counted,
        discrepancyKnown,
        discrepancy: discrepancyKnown ? counted - expected : null,
      };
    });
  return { discrepancies: rows };
}

// PRC-04: purchase and sale price points for one item, oldest first.
export function priceTrend(transactions, companyId, { itemId, priceType } = {}) {
  const history = transactions
    .filter((tx) => tx.companyId === companyId && tx.itemLocalId === itemId && (isPurchasePoint(tx) || tx.type === 'out'))
    .filter((tx) => tx.unitPrice !== null && tx.unitPrice !== undefined)
    .map((tx) => ({
      id: txId(tx),
      priceType: tx.type === 'out' ? 'sale' : 'purchase',
      amount: num(tx.unitPrice),
      effectiveDate: tx.occurredAt,
    }))
    .filter((h) => !priceType || h.priceType === priceType)
    .sort((a, b) => time(a.effectiveDate) - time(b.effectiveDate));
  return { history };
}

// Low-stock items and purchase-price anomalies (a purchase more than thresholdPercent away from
// the item's previous purchase price), over the 500 most recent purchases.
export function alerts(items, transactions, companyId, thresholdPercent = 20) {
  const threshold = Number(thresholdPercent ?? 20);
  const byLocalId = itemIndex(items);

  const lowStockItems = items
    .filter((i) => i.companyId === companyId && isActive(i) && num(i.quantityOnHand) <= num(i.lowStockThreshold))
    .sort((a, b) => a.name.localeCompare(b.name));

  const recentPurchases = transactions
    .filter((tx) => isPurchasePoint(tx) && tx.companyId === companyId)
    .sort((a, b) => time(b.occurredAt) - time(a.occurredAt))
    .slice(0, 500);

  const byItem = new Map();
  for (const tx of recentPurchases) {
    if (!byItem.has(tx.itemLocalId)) byItem.set(tx.itemLocalId, []);
    byItem.get(tx.itemLocalId).push(tx);
  }

  const priceAnomalies = [];
  for (const rows of byItem.values()) {
    const chronological = [...rows].reverse();
    for (let i = 1; i < chronological.length; i++) {
      const prev = num(chronological[i - 1].unitPrice);
      const curr = chronological[i];
      const currAmount = num(curr.unitPrice);
      if (prev === 0) continue;
      const deviationPercent = (Math.abs(currAmount - prev) / prev) * 100;
      if (deviationPercent > threshold) {
        const item = byLocalId.get(curr.itemLocalId);
        priceAnomalies.push({
          itemId: curr.itemLocalId,
          itemName: item ? item.name : null,
          sku: item ? item.sku : null,
          previousPrice: prev,
          newPrice: currAmount,
          deviationPercent,
          effectiveDate: curr.occurredAt,
        });
      }
    }
  }
  priceAnomalies.sort((a, b) => time(b.effectiveDate) - time(a.effectiveDate));

  return { thresholdPercent: threshold, lowStockItems, priceAnomalies };
}

// Mirrors computeCompanySummary on the server.
export function companySummary(items, transactions, companyId, range = {}, payments = []) {
  const active = items.filter((i) => i.companyId === companyId && isActive(i));
  const { totalPurchaseCost, totalSalesRevenue, margin, salesByPaymentMethod } = salesVsPurchases(transactions, companyId, range);
  return {
    itemCount: active.length,
    lowStockCount: active.filter((i) => num(i.quantityOnHand) <= num(i.lowStockThreshold)).length,
    totalPurchaseCost,
    totalSalesRevenue,
    margin,
    cashSalesRevenue: salesByPaymentMethod.cash.revenue,
    transferSalesRevenue: salesByPaymentMethod.transfer.revenue,
    posSalesRevenue: salesByPaymentMethod.pos.revenue,
    outstandingDebt: debtors(transactions, payments, companyId).totals.outstanding,
  };
}

// RPT-06 / RPT-07: per-company breakdown across every visible company, plus totals.
export function oversightSummary(companies, items, transactions, { companyIds, ownCompanyId, from, to, payments = [] }) {
  const nameById = new Map(companies.map((c) => [c.id, c.name]));
  const breakdown = companyIds.map((companyId) => ({
    companyId,
    companyName: nameById.get(companyId) || `Company #${companyId}`,
    isMain: companyId === ownCompanyId,
    ...companySummary(items, transactions, companyId, { from, to }, payments),
  }));
  const totals = breakdown.reduce(
    (acc, row) => ({
      itemCount: acc.itemCount + row.itemCount,
      lowStockCount: acc.lowStockCount + row.lowStockCount,
      totalPurchaseCost: acc.totalPurchaseCost + row.totalPurchaseCost,
      totalSalesRevenue: acc.totalSalesRevenue + row.totalSalesRevenue,
      margin: acc.margin + row.margin,
      cashSalesRevenue: acc.cashSalesRevenue + row.cashSalesRevenue,
      transferSalesRevenue: acc.transferSalesRevenue + row.transferSalesRevenue,
      posSalesRevenue: acc.posSalesRevenue + row.posSalesRevenue,
      outstandingDebt: acc.outstandingDebt + row.outstandingDebt,
    }),
    { itemCount: 0, lowStockCount: 0, totalPurchaseCost: 0, totalSalesRevenue: 0, margin: 0, cashSalesRevenue: 0, transferSalesRevenue: 0, posSalesRevenue: 0, outstandingDebt: 0 }
  );
  return { companies: breakdown, totals };
}
