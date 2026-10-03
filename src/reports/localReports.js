import {
  getLocalCompany,
  getLocalSubCompanies,
  getLocalItemsForCompanies,
  getAllLocalItemsForCompanies,
  getLocalTransactions,
  getLocalDebtPayments,
  getLocalSupplierPayments,
  getLocalOutflows,
  getLocalSavingsGoals,
} from '../db/localDb';
import { ROLES } from '../constants/roles';
import * as math from './reportMath';
import * as outflowMath from './outflowMath';
import { salesHistory } from './salesMath';
import { todaySummary } from './todayMath';

// Reports computed from the device's SQLite data — synced history plus this device's unsynced
// changes — so they work offline and always include work not yet pushed. Each function returns
// the same shape as the matching api.* report call it replaces.

// Own company, plus every linked Sub Company for a Main Company (same rule as the server's
// getAllowedCompanyIds).
export function visibleCompanyIds(user) {
  if (user.role !== ROLES.MAIN) return [user.companyId];
  return [user.companyId, ...getLocalSubCompanies(user.companyId).map((c) => c.id)];
}

function load(companyIds) {
  return {
    items: getLocalItemsForCompanies(companyIds),
    // Includes deactivated items so older transactions still show their item's name.
    allItems: getAllLocalItemsForCompanies(companyIds),
    transactions: getLocalTransactions(companyIds),
    payments: getLocalDebtPayments(companyIds),
  };
}

// Everything the Reports screen shows for one company, in one read of the local database.
export function getCompanyReports(user, companyId, filters = {}) {
  const { items, allItems, transactions, payments } = load([companyId]);
  const range = { from: filters.from, to: filters.to };
  return {
    stockOnHand: math.stockOnHand(items, companyId, { category: filters.category, itemId: filters.itemId }),
    salesVsPurchases: math.salesVsPurchases(transactions, companyId, range, payments),
    summary: math.businessSummary(allItems, transactions, companyId, range, payments),
    debtors: math.debtors(transactions, payments, companyId),
    marginByItem: math.marginByItem(items, transactions, companyId).report,
    items,
    transactionMargins: math.transactionMargins(allItems, transactions, companyId, { itemId: filters.itemId, ...range, limit: 50 }).transactions,
    discrepancies: math.discrepancies(allItems, transactions, companyId, range).discrepancies,
    priceTrend: filters.itemId ? math.priceTrend(transactions, companyId, { itemId: filters.itemId }).history : [],
  };
}

export function getOversightSummary(user, range = {}) {
  const companyIds = visibleCompanyIds(user);
  const { items, transactions, payments } = load(companyIds);
  const companies = companyIds.map((id) => getLocalCompany(id)).filter(Boolean);
  // Before the first sync fills the companies table, fall back to the name cached at login.
  if (user.company?.name && !companies.some((c) => c.id === user.companyId)) {
    companies.push({ id: user.companyId, name: user.company.name });
  }
  return math.oversightSummary(companies, items, transactions, { companyIds, ownCompanyId: user.companyId, ...range, payments });
}

// Customers who owe money (debtors screen).
export function getDebtors(companyId) {
  const { transactions, payments } = load([companyId]);
  return math.debtors(transactions, payments, companyId);
}

// Every sale of one company with its returns, newest first (Sales and Sale detail screens).
// `since` (ISO time) reads only sales from then on (and their returns, which come later).
export function getSales(companyId, { since } = {}) {
  if (!since) {
    const { allItems, transactions } = load([companyId]);
    return salesHistory(allItems, transactions, companyId);
  }
  return salesHistory(getAllLocalItemsForCompanies([companyId]), getLocalTransactions([companyId], { since }), companyId);
}

// One customer's summary, credit sales and repayments (debtor detail screen).
export function getCustomerDebt(companyId, customerPhone) {
  const { allItems, transactions, payments } = load([companyId]);
  const summary = math.debtors(transactions, payments, companyId).customers.find((c) => c.customerPhone === customerPhone) || null;
  return { customer: summary, ...math.customerLedger(allItems, transactions, payments, companyId, customerPhone) };
}

export function getAlerts(companyId) {
  const { allItems, transactions } = load([companyId]);
  const company = getLocalCompany(companyId);
  return {
    ...math.alerts(allItems, transactions, companyId, company?.priceAnomalyThresholdPercent ?? 20),
    expiring: math.expiringStock(allItems, transactions, companyId),
  };
}

// Suppliers and what this company owes them (Suppliers screen).
export function getSuppliers(companyId) {
  return math.suppliers(getLocalTransactions([companyId]), getLocalSupplierPayments([companyId]), companyId);
}

// One supplier's summary, purchases and payments (supplier detail screen).
export function getSupplierLedger(companyId, supplierPhone) {
  const allItems = getAllLocalItemsForCompanies([companyId]);
  const transactions = getLocalTransactions([companyId]);
  const payments = getLocalSupplierPayments([companyId]);
  const summary = math.suppliers(transactions, payments, companyId).suppliers.find((s) => s.supplierPhone === supplierPhone) || null;
  return { supplier: summary, ...math.supplierLedger(allItems, transactions, payments, companyId, supplierPhone) };
}

// Low stock and expiring stock for the daily notification (own company only).
// `days` lists the mornings to warn about (expiry is worked out for each of them).
export function getStockWarnings(companyId, days = [new Date()]) {
  const { items, allItems, transactions } = load([companyId]);
  const lowStock = math.stockOnHand(items, companyId).filter((i) => Number(i.quantityOnHand) <= Number(i.lowStockThreshold));
  return days.map((now) => ({ now, lowStock, expiring: math.expiringStock(allItems, transactions, companyId, { now, withinDays: 14 }) }));
}

// Everything that went out of the visible companies in a period (Money out screen and the
// Overview card): stock purchases plus recorded outflows, with totals by kind.
export function getMoneyOut(user, range = {}, companyIds = visibleCompanyIds(user)) {
  const allItems = getAllLocalItemsForCompanies(companyIds);
  const transactions = getLocalTransactions(companyIds);
  const outflows = getLocalOutflows(companyIds);
  const entries = outflowMath.outflowEntries(
    transactions, outflows, companyIds, range, new Map(allItems.map((i) => [i.localId, i])), getLocalSupplierPayments(companyIds)
  );
  return { entries, totals: outflowMath.outflowTotals(entries) };
}

// Savings goals of the user's own company, with balances.
export function getSavings(companyId) {
  return outflowMath.savingsGoals(getLocalSavingsGoals([companyId]), getLocalOutflows([companyId]));
}

// Monthly bills of the user's own company that are due soon or overdue.
export function getDueRepeats(companyId) {
  return outflowMath.dueRepeats(getLocalOutflows([companyId]), [companyId]);
}

// Categories this company has used before for each kind, most recent first, offered as chips
// next to the built-in suggestions in the Record sheet.
export function getRecentCategories(companyId, perKind = 6) {
  const byKind = {};
  const rows = getLocalOutflows([companyId]).sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  for (const o of rows) {
    const category = o.category?.trim();
    if (!category) continue;
    const list = (byKind[o.kind] ||= []);
    if (list.length < perKind && !list.some((c) => c.toLowerCase() === category.toLowerCase())) list.push(category);
  }
  return byKind;
}

// One person's day so far (the staff Today tab).
export function getToday(user) {
  const companyIds = [user.companyId];
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  // Today's rows only: a sale's returns come after it, so nothing of today's sales is missed.
  const transactions = getLocalTransactions(companyIds, { since: midnight.toISOString() });
  return todaySummary({
    sales: salesHistory(getAllLocalItemsForCompanies(companyIds), transactions, user.companyId),
    transactions,
    debtPayments: getLocalDebtPayments(companyIds),
    supplierPayments: getLocalSupplierPayments(companyIds),
    outflows: getLocalOutflows(companyIds),
    userId: user.id,
  });
}
