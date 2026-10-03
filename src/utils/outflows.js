// Names, icons and suggested categories for each kind of money out, shared by the Record sheet,
// the Money out list and the Overview card.
export const KIND_META = {
  stock: { label: 'Stock bought', short: 'Stock', icon: 'box' },
  expense: {
    label: 'Expenses', short: 'Expense', icon: 'receipt', noun: 'expense', categoryLabel: 'Category',
    presets: ['Rent', 'Fuel', 'Salaries', 'Electricity', 'Transport', 'Repairs', 'Data and airtime'],
  },
  savings: { label: 'Savings', short: 'Savings', icon: 'piggy', noun: 'to savings' },
  savings_return: { label: 'Taken out of savings', short: 'From savings', icon: 'upload' },
  withdrawal: {
    label: 'Owner withdrawals', short: 'Withdrawal', icon: 'user', noun: 'withdrawal', categoryLabel: 'Taken by',
    hint: 'Money the owner takes for personal use. Kept apart from business expenses.',
  },
  loan: { label: 'Loan repayments', short: 'Loan', icon: 'bank', noun: 'loan repayment', categoryLabel: 'Which loan?' },
  refund: {
    label: 'Refunds', short: 'Refund', icon: 'refund', noun: 'refund', categoryLabel: 'Refund to',
    hint: 'Money given back to a customer. To put returned items back on the shelf, record stock in as well.',
  },
  tax: {
    label: 'Tax and levies', short: 'Tax/levy', icon: 'tax', noun: 'tax or levy', categoryLabel: 'Type',
    presets: ['LGA levy', 'Market dues', 'Signage permit', 'Income tax'],
  },
};

export const PAYMENT_METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'transfer', label: 'Transfer' },
];

// What a recorded outflow is called in a list: the note, else the category, else the kind.
export function outflowTitle(entry) {
  if (entry.title) return entry.title;
  return KIND_META[entry.kind]?.short || 'Money out';
}

// "Expense · Fuel · Cash", "Savings · Generator fund · Transfer", "Stock in · from Inventory".
export function outflowSubtitle(entry, goalNames = new Map()) {
  if (entry.auto) return 'Stock in · from Inventory';
  const o = entry.outflow;
  const parts = [KIND_META[entry.kind]?.short];
  const detail = o.clientGoalId ? goalNames.get(o.clientGoalId) : o.category;
  if (detail && detail !== entry.title) parts.push(detail);
  parts.push(o.paymentMethod === 'transfer' ? 'Transfer' : 'Cash');
  if (o.repeatsMonthly === 1 || o.repeatsMonthly === true) parts.push('Monthly');
  return parts.filter(Boolean).join(' · ');
}
