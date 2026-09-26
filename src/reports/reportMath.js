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
// for every 'in' and a sale price point for every 'out', at the transaction's occurredAt.

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
  return tx.paymentMethod === 'transfer' ? 'transfer' : 'cash';
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
    if (tx.type !== 'in' || tx.companyId !== companyId || tx.unitPrice === null || tx.unitPrice === undefined) continue;
    if (!byItem.has(tx.itemLocalId)) byItem.set(tx.itemLocalId, []);
    byItem.get(tx.itemLocalId).push({ amount: num(tx.unitPrice), effectiveDate: tx.occurredAt, t: time(tx.occurredAt) });
  }
  for (const points of byItem.values()) points.sort((a, b) => a.t - b.t);
  return byItem;
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
  const salesByPaymentMethod = { cash: { revenue: 0, count: 0 }, transfer: { revenue: 0, count: 0 }, credit: { revenue: 0, count: 0 } };
  for (const tx of transactions) {
    if (tx.companyId !== companyId || !inRange(tx, range)) continue;
    if (tx.type === 'in') {
      totalPurchaseCost += num(tx.quantity) * num(tx.unitPrice);
      purchaseCount += 1;
    } else if (tx.type === 'out') {
      totalSalesRevenue += saleTotal(tx);
      saleCount += 1;
      const paid = salePaid(tx);
      const owed = saleOwed(tx);
      if (paid > 0) {
        salesByPaymentMethod[paymentMethodOf(tx)].revenue += paid;
        salesByPaymentMethod[paymentMethodOf(tx)].count += 1;
      }
      if (owed > 0) {
        salesByPaymentMethod.credit.revenue += owed;
        salesByPaymentMethod.credit.count += 1;
      }
    }
  }
  const repayments = { cash: { amount: 0, count: 0 }, transfer: { amount: 0, count: 0 }, total: 0 };
  for (const p of payments) {
    if (p.companyId !== companyId || !inRange(p, range)) continue;
    const bucket = p.paymentMethod === 'transfer' ? repayments.transfer : repayments.cash;
    bucket.amount += num(p.amount);
    bucket.count += 1;
    repayments.total += num(p.amount);
  }
  return {
    totalPurchaseCost, totalSalesRevenue, margin: totalSalesRevenue - totalPurchaseCost, purchaseCount, saleCount,
    salesByPaymentMethod, repayments,
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
      byPhone.set(phone, { customerPhone: phone, customerName: name, totalOwed: 0, totalRepaid: 0, creditSales: 0, lastActivityAt: at });
    }
    const c = byPhone.get(phone);
    if (time(at) >= time(c.lastActivityAt)) {
      c.lastActivityAt = at;
      if (name) c.customerName = name;
    }
    return c;
  };
  const sales = transactions
    .filter((tx) => tx.type === 'out' && tx.companyId === companyId && tx.customerPhone)
    .sort((a, b) => time(a.occurredAt) - time(b.occurredAt));
  for (const tx of sales) {
    const owed = saleOwed(tx);
    if (owed <= 0) continue;
    const c = customer(tx.customerPhone, tx.customerName, tx.occurredAt);
    c.totalOwed += owed;
    c.creditSales += 1;
  }
  const received = payments.filter((p) => p.companyId === companyId).sort((a, b) => time(a.occurredAt) - time(b.occurredAt));
  for (const p of received) {
    const c = customer(p.customerPhone, p.customerName, p.occurredAt);
    c.totalRepaid += num(p.amount);
  }
  const customers = [...byPhone.values()]
    .map((c) => ({ ...c, balance: Math.round((c.totalOwed - c.totalRepaid) * 100) / 100 }))
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

// One customer's credit sales and repayments, newest first.
export function customerLedger(items, transactions, payments, companyId, customerPhone) {
  const byLocalId = itemIndex(items);
  const sales = transactions
    .filter((tx) => tx.type === 'out' && tx.companyId === companyId && tx.customerPhone === customerPhone)
    .sort((a, b) => time(b.occurredAt) - time(a.occurredAt))
    .map((tx) => ({
      transactionId: txId(tx),
      itemName: byLocalId.get(tx.itemLocalId)?.name ?? null,
      quantity: num(tx.quantity),
      total: saleTotal(tx),
      amountPaid: salePaid(tx),
      owed: saleOwed(tx),
      paymentMethod: paymentMethodOf(tx),
      occurredAt: tx.occurredAt,
      pending: tx.syncStatus !== 'synced',
    }));
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
  return { sales, payments: repayments };
}

// RPT-03: every active item, with all-time sales costed at the item's current last purchase price.
export function marginByItem(items, transactions, companyId) {
  const salesByItem = new Map();
  for (const tx of transactions) {
    if (tx.type !== 'out') continue;
    if (!salesByItem.has(tx.itemLocalId)) salesByItem.set(tx.itemLocalId, []);
    salesByItem.get(tx.itemLocalId).push(tx);
  }
  const report = items
    .filter((i) => i.companyId === companyId && isActive(i))
    .map((item) => {
      const sales = salesByItem.get(item.localId) || [];
      const totalRevenue = sales.reduce((sum, t) => sum + num(t.quantity) * num(t.unitPrice), 0);
      const totalUnitsSold = sales.reduce((sum, t) => sum + num(t.quantity), 0);
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
    const t = time(tx.occurredAt);
    const history = points.get(tx.itemLocalId) || [];
    let price = null;
    for (const p of history) {
      if (p.t <= t) price = p;
      else break;
    }
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
    .filter((tx) => tx.companyId === companyId && tx.itemLocalId === itemId && (tx.type === 'in' || tx.type === 'out'))
    .filter((tx) => tx.unitPrice !== null && tx.unitPrice !== undefined)
    .map((tx) => ({
      id: txId(tx),
      priceType: tx.type === 'in' ? 'purchase' : 'sale',
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
    .filter((tx) => tx.type === 'in' && tx.companyId === companyId && tx.unitPrice !== null && tx.unitPrice !== undefined)
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
      outstandingDebt: acc.outstandingDebt + row.outstandingDebt,
    }),
    { itemCount: 0, lowStockCount: 0, totalPurchaseCost: 0, totalSalesRevenue: 0, margin: 0, cashSalesRevenue: 0, transferSalesRevenue: 0, outstandingDebt: 0 }
  );
  return { companies: breakdown, totals };
}
