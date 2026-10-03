// Sales history (Sales and Sale detail screens): the stock-out rows of each sale grouped
// together (rows of a multi-item sale share a saleId), with any returns or voids against them.
// Pure functions over plain arrays, like reportMath.js, so they can run anywhere.
import { paidByMethod, saleTotal, salePaid, saleOwed, returnRefund, returnDebtCut } from './reportMath';

const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const round = (n) => Math.round(n * 100) / 100;
const time = (v) => new Date(v).getTime();

// A sale's key: its saleId, or the one row's clientTransactionId for a single-item sale.
export function saleKey(tx) {
  return tx.saleId || tx.clientTransactionId;
}

// Short number printed on receipts, e.g. "4F9A2C".
export function receiptNumber(key) {
  return String(key || '').replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
}

function addMethods(target, methods, sign = 1) {
  for (const [m, amount] of Object.entries(methods)) target[m] = round((target[m] || 0) + sign * amount);
}

// Every sale of one company, newest first:
// { key, saleId, occurredAt, customerName, customerPhone, pending, createdByUserId,
//   total, paid, paidByMethod, owed, returnedValue, refunded, refundedByMethod, debtCancelled,
//   status: null | 'returned' | 'voided', lines: [...] }
// Each line: { clientTransactionId, itemLocalId, itemServerId, itemClientItemId, itemName, unit,
//   quantity, unitPrice, total, paid, owed, returnedQty, remainingQty, debtLeft, paymentMethod,
//   paymentBreakdown, customerName, customerPhone, saleId }
// owed is what's still owed from the sale after returns (repayments are per customer and live
// on the Debtors screen, so they aren't taken off here).
export function salesHistory(items, transactions, companyId) {
  const itemsById = new Map(items.map((i) => [i.localId, i]));
  const returnsByRow = new Map();
  for (const tx of transactions) {
    if (tx.type !== 'return' || tx.companyId !== companyId) continue;
    if (!returnsByRow.has(tx.returnOf)) returnsByRow.set(tx.returnOf, []);
    returnsByRow.get(tx.returnOf).push(tx);
  }

  const sales = new Map();
  const rows = transactions
    .filter((tx) => tx.type === 'out' && tx.companyId === companyId)
    .sort((a, b) => time(a.occurredAt) - time(b.occurredAt));
  for (const tx of rows) {
    const key = saleKey(tx);
    if (!sales.has(key)) {
      sales.set(key, {
        key,
        saleId: tx.saleId || null,
        occurredAt: tx.occurredAt,
        customerName: tx.customerName || null,
        customerPhone: tx.customerPhone || null,
        createdByUserId: tx.createdByUserId ?? tx.userId ?? null,
        pending: false,
        total: 0, paid: 0, paidByMethod: {}, owed: 0,
        returnedValue: 0, refunded: 0, refundedByMethod: {}, debtCancelled: 0,
        returns: [],
        lines: [],
      });
    }
    const sale = sales.get(key);
    const item = itemsById.get(tx.itemLocalId);
    const returns = returnsByRow.get(tx.clientTransactionId) || [];
    const returnedQty = round(returns.reduce((sum, r) => sum + num(r.quantity), 0));
    const debtCut = returns.reduce((sum, r) => sum + returnDebtCut(r), 0);
    const total = saleTotal(tx);
    const paid = salePaid(tx);
    const owedAtSale = saleOwed(tx);
    const line = {
      clientTransactionId: tx.clientTransactionId,
      itemLocalId: tx.itemLocalId,
      itemServerId: tx.itemServerId ?? null,
      itemClientItemId: tx.itemClientItemId ?? item?.clientItemId ?? null,
      itemName: item?.name ?? 'Item',
      unit: item?.unit ?? 'unit',
      allowDecimal: Boolean(item?.allowDecimal) || !Number.isInteger(num(tx.quantity)),
      quantity: num(tx.quantity),
      unitPrice: num(tx.unitPrice),
      total,
      paid,
      owed: owedAtSale,
      returnedQty,
      remainingQty: round(num(tx.quantity) - returnedQty),
      debtLeft: Math.max(0, round(owedAtSale - debtCut)),
      paymentMethod: tx.paymentMethod,
      paymentBreakdown: tx.paymentBreakdown,
      customerName: tx.customerName || null,
      customerPhone: tx.customerPhone || null,
      saleId: tx.saleId || null,
    };
    sale.lines.push(line);
    sale.total = round(sale.total + total);
    sale.paid = round(sale.paid + paid);
    addMethods(sale.paidByMethod, paidByMethod(tx, paid));
    sale.owed = round(sale.owed + line.debtLeft);
    sale.pending = sale.pending || tx.syncStatus !== 'synced';
    if (!sale.customerName && tx.customerName) {
      sale.customerName = tx.customerName;
      sale.customerPhone = tx.customerPhone;
    }
    for (const r of returns) {
      sale.returns.push({ ...r, itemName: line.itemName, unit: line.unit });
      sale.returnedValue = round(sale.returnedValue + saleTotal(r));
      sale.refunded = round(sale.refunded + returnRefund(r));
      sale.debtCancelled = round(sale.debtCancelled + returnDebtCut(r));
      addMethods(sale.refundedByMethod, paidByMethod(r, returnRefund(r)));
      sale.pending = sale.pending || r.syncStatus !== 'synced';
    }
  }

  return [...sales.values()]
    .map((sale) => {
      const left = sale.lines.reduce((sum, l) => sum + l.remainingQty, 0);
      const anyReturned = sale.returns.length > 0;
      const voided = sale.returns.some((r) => r.returnReason === 'void') && left <= 0;
      sale.returns.sort((a, b) => time(a.occurredAt) - time(b.occurredAt));
      return { ...sale, status: voided ? 'voided' : anyReturned ? 'returned' : null };
    })
    .sort((a, b) => time(b.occurredAt) - time(a.occurredAt));
}

// What taking back `quantity` of a sale line is worth, and how it's settled: the value first
// cancels what the customer still owes on that line; the rest is handed back. Same rule as the
// server (createReturnRow), so the return syncs as recorded.
export function returnLine(line, quantity) {
  const value = round(num(quantity) * line.unitPrice);
  const debtCut = Math.min(value, line.debtLeft);
  return { value, debtCut: round(debtCut), refund: round(value - debtCut) };
}
