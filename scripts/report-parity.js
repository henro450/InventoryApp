#!/usr/bin/env node
// Checks that the on-device report math (src/reports/reportMath.js) produces the same numbers
// as the server's /api/reports endpoints. It records a few stock movements through the API,
// pulls the sync change feed the way the app does, runs the local math on the result, and
// compares every report.
//
// Usage (against a local API — never production, it writes test data):
//   API_URL=http://localhost:4000/api EMAIL=main@company.test PASSWORD=... node scripts/report-parity.js
// EMAIL/PASSWORD must be a main_company user.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const API = (process.env.API_URL || 'http://localhost:4000/api').replace(/\/+$/, '');
const { EMAIL, PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) {
  console.error('Set EMAIL and PASSWORD for a main_company user.');
  process.exit(2);
}

let token;
async function call(method, route, body) {
  const res = await fetch(API + route, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${data.error || ''}`);
  return data;
}

async function loadMath() {
  // reportMath.js is an ES module without a package "type"; copy it to .mjs to import it.
  const src = path.resolve(__dirname, '../src/reports/reportMath.js');
  const tmp = path.join(os.tmpdir(), `reportMath-${process.pid}.mjs`);
  fs.copyFileSync(src, tmp);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// Same shaping the app does in syncEngine/localDb.
async function pullLocalState() {
  const items = new Map();
  const transactions = new Map();
  const companies = new Map();
  const payments = new Map();
  let cursor = '0';
  let hasMore = true;
  while (hasMore) {
    const page = await call('GET', `/sync/changes?cursor=${cursor}&limit=1000`);
    for (const change of page.changes) {
      const d = change.data;
      if (!d) continue;
      if (change.entityType === 'company') {
        companies.set(d.id, { ...d, isActive: change.operation !== 'delete' && d.isActive !== false });
      } else if (change.entityType === 'item') {
        const localId = d.clientItemId || `server-${d.id}`;
        items.set(localId, {
          ...d,
          localId,
          quantityOnHand: Number(d.quantityOnHand),
          lowStockThreshold: Number(d.lowStockThreshold),
          lastPurchasePrice: d.lastPurchasePrice === null ? null : Number(d.lastPurchasePrice),
          isActive: change.operation === 'delete' ? 0 : d.isActive ? 1 : 0,
        });
      } else if (change.entityType === 'stock_transaction') {
        const item = [...items.values()].find((i) => i.id === d.itemId);
        transactions.set(d.clientTransactionId, {
          ...d,
          itemLocalId: item ? item.localId : `server-${d.itemId}`,
          quantity: Number(d.quantity),
          unitPrice: d.unitPrice === null ? null : Number(d.unitPrice),
          previousQuantity: d.previousQuantity === null ? null : Number(d.previousQuantity),
          amountPaid: d.amountPaid === null || d.amountPaid === undefined ? null : Number(d.amountPaid),
        });
      } else if (change.entityType === 'debt_payment') {
        payments.set(d.clientPaymentId, { ...d, amount: Number(d.amount) });
      }
    }
    cursor = page.cursor;
    hasMore = page.hasMore;
  }
  return { items: [...items.values()], transactions: [...transactions.values()], companies: [...companies.values()], payments: [...payments.values()] };
}

let failures = 0;
let checks = 0;
const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
function expectEqual(label, local, server) {
  checks += 1;
  const a = JSON.stringify(local);
  const b = JSON.stringify(server);
  if (a !== b) {
    failures += 1;
    console.error(`FAIL ${label}\n  local:  ${a}\n  server: ${b}`);
  }
}
function expectClose(label, local, server) {
  checks += 1;
  if (!close(local, server)) {
    failures += 1;
    console.error(`FAIL ${label}: local ${local} vs server ${server}`);
  }
}

(async () => {
  const math = await loadMath();
  const login = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  token = login.token;
  const me = login.user;
  if (me.role !== 'main_company') throw new Error('Use a main_company account');

  // --- Test data: two items, purchases with a >20% price jump, sales (one defaulted), an adjustment.
  const stamp = Date.now();
  const day = (n) => new Date(Date.UTC(2026, 0, 1 + n, 12, 0, stamp % 60)).toISOString();
  const a = (await call('POST', '/items', { sku: `PAR-A-${stamp}`, name: `Parity A ${stamp}`, category: 'Parity', lowStockThreshold: 5 })).item;
  const b = (await call('POST', '/items', { sku: `PAR-B-${stamp}`, name: `Parity B ${stamp}`, category: 'Parity', lowStockThreshold: 50 })).item;
  const tx = (itemId, type, quantity, unitPrice, n, paymentMethod, extra = {}) =>
    call('POST', '/transactions', { clientTransactionId: `par-${stamp}-${n}`, itemId, type, quantity, unitPrice, occurredAt: day(n), paymentMethod, ...extra });
  const repay = (n, customerPhone, amount, paymentMethod) =>
    call('POST', '/sync/operations', {
      operations: [{
        id: `par-pay-${stamp}-${n}`,
        type: 'debt_payment.create',
        payload: { clientPaymentId: `par-pay-${stamp}-${n}`, customerName: 'Parity Customer', customerPhone, amount, paymentMethod, occurredAt: day(n) },
      }],
    });
  const phone = `080${String(stamp).slice(-8)}`;
  await tx(a.id, 'in', 20, 100, 1);
  await tx(a.id, 'out', 5, 150, 2, 'transfer');
  await tx(a.id, 'in', 10, 130, 3); // +30% — anomaly at the default 20% threshold
  await tx(a.id, 'out', 4, undefined, 4); // defaulted to last purchase price
  await tx(a.id, 'adjustment', 19, undefined, 5);
  await tx(b.id, 'in', 8, 40, 6);
  await tx(b.id, 'out', 3, 55, 7, 'cash');
  // Part payments: part-paid by transfer, then fully on credit, then repayments by cash/transfer.
  await tx(b.id, 'out', 2, 60, 8, 'transfer', { amountPaid: 50, customerName: 'Parity Customer', customerPhone: `+234 ${phone.slice(1)}` });
  await tx(a.id, 'out', 1, 140, 9, 'cash', { amountPaid: 0, customerName: 'Parity Customer', customerPhone: phone });
  await repay(10, phone, 30, 'cash');
  await repay(11, phone, 40, 'transfer');

  const local = await pullLocalState();
  const serverIdOf = new Map(local.items.map((i) => [i.localId, i.id]));
  const own = me.companyId;
  const companyIds = [own, ...local.companies.filter((c) => c.parentCompanyId === own).map((c) => c.id)];
  const ranges = [{}, { from: day(2), to: day(6) }];

  // Stock on hand
  const soh = await call('GET', `/reports/stock-on-hand?companyId=${own}`);
  expectEqual(
    'stock-on-hand',
    math.stockOnHand(local.items, own).map((i) => [i.id, i.quantityOnHand]),
    soh.items.map((i) => [i.id, Number(i.quantityOnHand)])
  );

  // Sales vs purchases
  for (const r of ranges) {
    const qs = new URLSearchParams({ companyId: own, ...r }).toString();
    const server = await call('GET', `/reports/sales-vs-purchases?${qs}`);
    const mine = math.salesVsPurchases(local.transactions, own, r, local.payments);
    for (const k of ['totalPurchaseCost', 'totalSalesRevenue', 'margin', 'purchaseCount', 'saleCount']) {
      expectClose(`sales-vs-purchases ${JSON.stringify(r)} ${k}`, mine[k], server[k]);
    }
    for (const m of ['cash', 'transfer', 'credit']) {
      expectClose(`sales by payment ${JSON.stringify(r)} ${m} revenue`, mine.salesByPaymentMethod[m].revenue, server.salesByPaymentMethod[m].revenue);
      expectClose(`sales by payment ${JSON.stringify(r)} ${m} count`, mine.salesByPaymentMethod[m].count, server.salesByPaymentMethod[m].count);
    }
    for (const m of ['cash', 'transfer']) {
      expectClose(`repayments ${JSON.stringify(r)} ${m}`, mine.repayments[m].amount, server.repayments[m].amount);
    }
    expectClose(`repayments ${JSON.stringify(r)} total`, mine.repayments.total, server.repayments.total);
  }

  // Margin by item
  const mbi = await call('GET', `/reports/margin-by-item?companyId=${own}`);
  const mineMbi = new Map(math.marginByItem(local.items, local.transactions, own).report.map((row) => [serverIdOf.get(row.itemId), row]));
  expectEqual('margin-by-item count', mineMbi.size, mbi.report.length);
  for (const row of mbi.report) {
    const m = mineMbi.get(row.itemId);
    for (const k of ['totalUnitsSold', 'totalRevenue', 'estimatedCost', 'estimatedMargin']) {
      expectClose(`margin-by-item ${row.name} ${k}`, m ? m[k] : NaN, row[k]);
    }
  }

  // Per-transaction margins
  for (const r of ranges) {
    const qs = new URLSearchParams({ companyId: own, limit: 200, ...r }).toString();
    const server = await call('GET', `/reports/transaction-margins?${qs}`);
    const mine = math.transactionMargins(local.items, local.transactions, own, { ...r, limit: 200 });
    expectEqual(
      `transaction-margins ${JSON.stringify(r)}`,
      mine.transactions.map((t) => [t.transactionId, t.paymentMethod, t.amountPaid, t.customerName, t.costAvailable, t.estimatedCost, t.estimatedMargin]),
      server.transactions.map((t) => [t.transactionId, t.paymentMethod, t.amountPaid, t.customerName, t.costAvailable, t.estimatedCost, t.estimatedMargin])
    );
  }

  // Debtors
  const serverDebtors = await call('GET', `/reports/debtors?companyId=${own}`);
  const mineDebtors = math.debtors(local.transactions, local.payments, own);
  expectEqual(
    'debtors',
    mineDebtors.customers.map((c) => [c.customerPhone, c.customerName, c.totalOwed, c.totalRepaid, c.balance, c.creditSales]),
    serverDebtors.customers.map((c) => [c.customerPhone, c.customerName, c.totalOwed, c.totalRepaid, c.balance, c.creditSales])
  );
  for (const k of ['outstanding', 'customersOwing', 'totalRepaid']) expectClose(`debtors totals ${k}`, mineDebtors.totals[k], serverDebtors.totals[k]);
  const thisCustomer = mineDebtors.customers.find((c) => c.customerPhone === phone);
  expectClose('parity customer balance (120-50 + 140 - 70)', thisCustomer?.balance, 140);

  // Discrepancies
  const disc = await call('GET', `/reports/discrepancies?companyId=${own}`);
  expectEqual(
    'discrepancies',
    math.discrepancies(local.items, local.transactions, own).discrepancies.map((d) => [d.transactionId, d.expected, d.counted, d.discrepancy]),
    disc.discrepancies.map((d) => [d.transactionId, d.expected, d.counted, d.discrepancy])
  );

  // Price trend (ids differ: server price_history rows vs transactions — compare the points)
  for (const item of [a, b]) {
    const localId = local.items.find((i) => i.id === item.id).localId;
    const server = await call('GET', `/reports/price-trend?companyId=${own}&itemId=${item.id}`);
    expectEqual(
      `price-trend ${item.name}`,
      math.priceTrend(local.transactions, own, { itemId: localId }).history.map((h) => [h.priceType, h.amount, new Date(h.effectiveDate).toISOString()]),
      server.history.map((h) => [h.priceType, h.amount, new Date(h.effectiveDate).toISOString()])
    );
  }

  // Alerts
  const serverAlerts = await call('GET', `/reports/alerts?companyId=${own}`);
  const company = local.companies.find((c) => c.id === own);
  const mineAlerts = math.alerts(local.items, local.transactions, own, company?.priceAnomalyThresholdPercent ?? 20);
  expectClose('alerts threshold', mineAlerts.thresholdPercent, serverAlerts.thresholdPercent);
  expectEqual('alerts low stock', mineAlerts.lowStockItems.map((i) => i.id), serverAlerts.lowStockItems.map((i) => i.id));
  expectEqual(
    'alerts price anomalies',
    mineAlerts.priceAnomalies.map((p) => [serverIdOf.get(p.itemId), p.previousPrice, p.newPrice, new Date(p.effectiveDate).toISOString()]),
    serverAlerts.priceAnomalies.map((p) => [p.itemId, p.previousPrice, p.newPrice, new Date(p.effectiveDate).toISOString()])
  );

  // Oversight summary
  for (const r of ranges) {
    const qs = new URLSearchParams(r).toString();
    const server = await call('GET', `/reports/oversight-summary?${qs}`);
    const mine = math.oversightSummary(local.companies, local.items, local.transactions, { companyIds, ownCompanyId: own, ...r, payments: local.payments });
    const mineById = new Map(mine.companies.map((c) => [c.companyId, c]));
    expectEqual(`oversight ${JSON.stringify(r)} companies`, [...mineById.keys()].sort(), server.companies.map((c) => c.companyId).sort());
    for (const row of server.companies) {
      for (const k of ['itemCount', 'lowStockCount', 'totalPurchaseCost', 'totalSalesRevenue', 'margin', 'cashSalesRevenue', 'transferSalesRevenue', 'outstandingDebt']) {
        expectClose(`oversight ${JSON.stringify(r)} ${row.companyName} ${k}`, mineById.get(row.companyId)?.[k], row[k]);
      }
    }
    for (const k of Object.keys(server.totals)) expectClose(`oversight ${JSON.stringify(r)} totals ${k}`, mine.totals[k], server.totals[k]);
  }

  console.log(`${checks - failures}/${checks} report checks match the server.`);
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
