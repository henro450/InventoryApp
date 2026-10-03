// The staff "Today" view: what one person took in and paid out since midnight on this phone, and
// so how much cash they should be holding for the end-of-day handover. Pure functions over plain
// arrays, like reportMath.js.
import { paidByMethod, returnRefund } from './reportMath';

const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const round = (n) => Math.round(n * 100) / 100;

function startOfDay(now) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

// Who recorded a row: the server's createdByUserId, or this phone's user for rows not yet synced.
const recordedBy = (row) => row.createdByUserId ?? row.userId ?? null;

function add(target, methods) {
  for (const [m, amount] of Object.entries(methods)) target[m] = round((target[m] || 0) + amount);
}

// Debt repayments and money out have one method; anything else counts as cash, as on sales.
function methodOf(row) {
  return ['cash', 'transfer', 'pos'].includes(row.paymentMethod) ? row.paymentMethod : 'cash';
}

// sales: salesHistory() rows. The rest are local table rows.
// Returns { sales: [...mine today, newest first], salesCount, sold, received, receivedByMethod,
//   owed, collected, collectedByMethod, refunded, refundedByMethod, spent, spentByMethod,
//   spentByKind, cashIn, cashOut, cashInHand }
export function todaySummary({ sales, transactions = [], debtPayments = [], supplierPayments = [], outflows = [], userId, now = Date.now() }) {
  const since = startOfDay(now);
  const today = (row) => new Date(row.occurredAt).getTime() >= since;
  const mine = (row) => recordedBy(row) === userId;

  const mySales = sales.filter((s) => s.createdByUserId === userId && today(s));
  const receivedByMethod = {};
  let sold = 0;
  let received = 0;
  let owed = 0;
  for (const s of mySales) {
    sold += num(s.total) - num(s.returnedValue); // after any items brought back
    received += num(s.paid);
    owed += num(s.owed);
    add(receivedByMethod, s.paidByMethod || {});
  }

  // Money handed back on returns recorded today (any day's sale).
  const refundedByMethod = {};
  let refunded = 0;
  for (const r of transactions) {
    if (r.type !== 'return' || !mine(r) || !today(r)) continue;
    const back = returnRefund(r);
    refunded += back;
    add(refundedByMethod, paidByMethod(r, back));
  }

  const collectedByMethod = {};
  let collected = 0;
  for (const p of debtPayments) {
    if (!mine(p) || !today(p)) continue;
    collected += num(p.amount);
    add(collectedByMethod, { [methodOf(p)]: num(p.amount) });
  }

  // Expenses and other money out, plus payments to suppliers.
  const spentByMethod = {};
  const spentByKind = {};
  let spent = 0;
  let fromSavingsCash = 0;
  for (const o of outflows) {
    if (!mine(o) || !today(o)) continue;
    // Money taken back out of savings comes into the till rather than leaving it.
    if (o.kind === 'savings_return') {
      if (methodOf(o) === 'cash') fromSavingsCash += num(o.amount);
      continue;
    }
    spent += num(o.amount);
    add(spentByMethod, { [methodOf(o)]: num(o.amount) });
    add(spentByKind, { [o.kind]: num(o.amount) });
  }
  for (const p of supplierPayments) {
    if (!mine(p) || !today(p)) continue;
    spent += num(p.amount);
    add(spentByMethod, { [methodOf(p)]: num(p.amount) });
    add(spentByKind, { supplier: num(p.amount) });
  }

  const cashIn = round((receivedByMethod.cash || 0) + (collectedByMethod.cash || 0) + fromSavingsCash);
  const cashOut = round((spentByMethod.cash || 0) + (refundedByMethod.cash || 0));
  return {
    sales: mySales,
    salesCount: mySales.length,
    sold: round(sold),
    received: round(received),
    receivedByMethod,
    owed: round(owed),
    collected: round(collected),
    collectedByMethod,
    refunded: round(refunded),
    refundedByMethod,
    spent: round(spent),
    spentByMethod,
    spentByKind,
    cashIn,
    cashOut,
    cashInHand: round(cashIn - cashOut),
  };
}
