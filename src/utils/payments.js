import { formatMoney } from './format';

// How money changed hands: on a sale, a return (money handed back) or a debt repayment. 'mixed'
// (shown as "Split") is part one way, part another, with the amounts in a breakdown like
// { cash: 2000, transfer: 3000 }. Debt repayments don't offer Split.
export const PAYMENT_METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'transfer', label: 'Transfer' },
  { key: 'pos', label: 'POS' },
  { key: 'mixed', label: 'Split' },
];

export const SPLIT_METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'transfer', label: 'Transfer' },
  { key: 'pos', label: 'POS' },
];

const LABELS = { cash: 'Cash', transfer: 'Transfer', pos: 'POS', mixed: 'Split', credit: 'Owed' };

export function methodLabel(method) {
  return LABELS[method] || 'Cash';
}

// Split inputs as typed ({ cash: '2000', transfer: '' }) -> { cash: 2000 } (amounts above zero).
export function breakdownFromInputs(inputs) {
  const out = {};
  for (const { key } of SPLIT_METHODS) {
    const value = Math.round(Number(inputs?.[key] || 0) * 100) / 100;
    if (value > 0) out[key] = value;
  }
  return out;
}

export function breakdownTotal(breakdown) {
  return Object.values(breakdown).reduce((sum, v) => sum + Math.round(Number(v) * 100), 0) / 100;
}

// Why a split can't be saved for this amount, or null when it adds up.
export function splitProblem(inputs, amount) {
  const total = breakdownTotal(breakdownFromInputs(inputs));
  if (Math.abs(total - amount) < 0.005) return null;
  return total < amount
    ? `The split adds up to ${formatMoney(total)}. ${formatMoney(amount - total)} more to go.`
    : `The split adds up to ${formatMoney(total)}, ${formatMoney(total - amount)} more than ${formatMoney(amount)}.`;
}

// "Cash ₦2,000.00 + Transfer ₦3,000.00" for a mixed payment, else the method's name.
export function describePayment(method, breakdown) {
  if (method !== 'mixed' || !breakdown) return methodLabel(method);
  const parsed = typeof breakdown === 'string' ? safeParse(breakdown) : breakdown;
  return SPLIT_METHODS.filter((m) => Number(parsed?.[m.key]) > 0)
    .map((m) => `${m.label} ${formatMoney(parsed[m.key])}`)
    .join(' + ');
}

export function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
