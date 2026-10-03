// Money out: everything that leaves the business, computed on the device from stock purchases
// (stock_transactions 'in': what was paid at the time) and later payments to suppliers for stock
// bought on credit, plus the money_outflows table. Pure functions over plain arrays, like
// reportMath.js, but with no server twin yet.
//
// Savings are kept apart from spending: a deposit leaves the till but still belongs to the
// business, and 'savings_return' (money taken back out of a goal) puts it back.

const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const time = (v) => new Date(v).getTime();

// The kinds people record, in the order the Record sheet shows them. 'stock' comes from stock
// transactions and 'savings_return' from the Savings screen, so neither is offered there.
export const OUTFLOW_KINDS = ['expense', 'savings', 'withdrawal', 'loan', 'refund', 'tax'];
export const SPENDING_KINDS = ['stock', 'expense', 'withdrawal', 'loan', 'refund', 'tax'];

function inRange(row, { from, to } = {}) {
  const t = time(row.occurredAt);
  if (from && t < time(from)) return false;
  if (to && t > time(to)) return false;
  return true;
}

// One list of everything that went out, newest first: stock purchases and supplier payments
// (marked auto) and recorded outflows, including savings deposits and withdrawals from savings.
// A purchase counts what was paid when the stock came in; the rest goes out when the supplier is paid.
export function outflowEntries(transactions, outflows, companyIds, range = {}, itemsByLocalId = new Map(), supplierPayments = []) {
  const ids = new Set(companyIds);
  const entries = [];
  for (const tx of transactions) {
    if (tx.type !== 'in' || !ids.has(tx.companyId) || !inRange(tx, range)) continue;
    const total = num(tx.quantity) * num(tx.unitPrice);
    const amount = tx.amountPaid === null || tx.amountPaid === undefined ? total : num(tx.amountPaid);
    if (amount <= 0) continue;
    const item = itemsByLocalId.get(tx.itemLocalId);
    entries.push({
      key: `tx-${tx.clientTransactionId}`,
      kind: 'stock',
      auto: true,
      title: item ? `${item.name} × ${num(tx.quantity)}` : 'Stock bought',
      amount,
      owed: Math.max(0, total - amount),
      occurredAt: tx.occurredAt,
      companyId: tx.companyId,
      createdByUserId: tx.createdByUserId ?? tx.userId,
      syncStatus: tx.syncStatus,
    });
  }
  for (const p of supplierPayments) {
    if (!ids.has(p.companyId) || !inRange(p, range)) continue;
    entries.push({
      key: `sp-${p.clientPaymentId}`,
      kind: 'stock',
      auto: true,
      title: `Paid ${p.supplierName}`,
      amount: num(p.amount),
      occurredAt: p.occurredAt,
      companyId: p.companyId,
      createdByUserId: p.createdByUserId ?? p.userId,
      syncStatus: p.syncStatus,
    });
  }
  for (const o of outflows) {
    if (!ids.has(o.companyId) || !inRange(o, range)) continue;
    entries.push({
      key: `of-${o.clientOutflowId}`,
      kind: o.kind,
      auto: false,
      title: o.note || o.category || null,
      amount: num(o.amount),
      occurredAt: o.occurredAt,
      companyId: o.companyId,
      createdByUserId: o.createdByUserId ?? o.userId,
      syncStatus: o.syncStatus,
      outflow: o,
    });
  }
  entries.sort((a, b) => time(b.occurredAt) - time(a.occurredAt));
  return entries;
}

// Totals by kind. `spent` is money that left for good; `savingsNet` is deposits minus money taken
// back out of savings in the same period.
export function outflowTotals(entries) {
  const byKind = Object.fromEntries(SPENDING_KINDS.map((k) => [k, 0]));
  let savingsIn = 0;
  let savingsOut = 0;
  for (const e of entries) {
    if (e.kind === 'savings') savingsIn += e.amount;
    else if (e.kind === 'savings_return') savingsOut += e.amount;
    else if (byKind[e.kind] !== undefined) byKind[e.kind] += e.amount;
  }
  const spent = SPENDING_KINDS.reduce((sum, k) => sum + byKind[k], 0);
  return { byKind, spent, savingsIn, savingsOut, savingsNet: savingsIn - savingsOut };
}

// Each savings goal with its balance and, when it has a target and date, how much to put aside
// each week to reach it. Closed goals are left out unless they still hold money.
export function savingsGoals(goals, outflows, now = new Date()) {
  const balance = new Map();
  const added = new Map();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  for (const o of outflows) {
    if (!o.clientGoalId) continue;
    const sign = o.kind === 'savings' ? 1 : o.kind === 'savings_return' ? -1 : 0;
    balance.set(o.clientGoalId, (balance.get(o.clientGoalId) || 0) + sign * num(o.amount));
    if (sign > 0 && time(o.occurredAt) >= monthStart) added.set(o.clientGoalId, (added.get(o.clientGoalId) || 0) + num(o.amount));
  }
  const list = goals
    .map((g) => {
      const saved = balance.get(g.clientGoalId) || 0;
      const target = g.targetAmount ? num(g.targetAmount) : null;
      let perWeek = null;
      if (target && g.targetDate && saved < target) {
        const weeks = (time(`${g.targetDate}T23:59:59`) - now.getTime()) / (7 * 86400000);
        perWeek = weeks >= 1 ? Math.ceil((target - saved) / weeks / 100) * 100 : target - saved;
      }
      return {
        ...g,
        isActive: !(g.isActive === 0 || g.isActive === false),
        saved,
        addedThisMonth: added.get(g.clientGoalId) || 0,
        target,
        progress: target ? Math.max(0, Math.min(1, saved / target)) : null,
        perWeek,
      };
    })
    .filter((g) => g.isActive || g.saved > 0)
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || (a.name || '').localeCompare(b.name || ''));
  const total = list.reduce((sum, g) => sum + Math.max(0, g.saved), 0);
  const addedThisMonth = list.reduce((sum, g) => sum + g.addedThisMonth, 0);
  return { goals: list, total, addedThisMonth };
}

function addMonth(iso) {
  const d = new Date(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d;
}

// Bills that repeat every month (rent, salaries, a loan) and are due within `withinDays`, or
// overdue. The latest entry of the same kind and category decides: if it repeats, the next one
// is due a month after it; recording that next one moves the reminder on.
export function dueRepeats(outflows, companyIds, now = new Date(), withinDays = 5) {
  const ids = new Set(companyIds);
  const latest = new Map();
  for (const o of outflows) {
    if (!ids.has(o.companyId) || o.kind === 'savings_return') continue;
    const key = [o.companyId, o.kind, (o.category || '').trim().toLowerCase(), o.clientGoalId || ''].join('|');
    const current = latest.get(key);
    if (!current || time(o.occurredAt) > time(current.occurredAt)) latest.set(key, o);
  }
  const due = [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const o of latest.values()) {
    if (!(o.repeatsMonthly === 1 || o.repeatsMonthly === true)) continue;
    const dueAt = addMonth(o.occurredAt);
    const dueDay = new Date(dueAt.getFullYear(), dueAt.getMonth(), dueAt.getDate()).getTime();
    const daysUntil = Math.round((dueDay - today) / 86400000);
    if (daysUntil <= withinDays) due.push({ outflow: o, dueAt: dueAt.toISOString(), daysUntil });
  }
  return due.sort((a, b) => a.daysUntil - b.daysUntil);
}
