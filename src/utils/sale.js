import { formatNumber } from './format';

// Maths for a sale of several items (StockTransactionScreen, stock out). Each line keeps the
// single-item rules: quantity is checked against that item's stock on hand, and a blank price
// uses the item's last purchase price.

export function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

// line = { item, quantity: '6', unitPrice: '' } (inputs as typed)
export function lineCalc(line) {
  const { item } = line;
  const qty = Number(line.quantity) || 0;
  const priceWasDefaulted = String(line.unitPrice ?? '').trim() === '';
  const hasDefault = item.lastPurchasePrice !== null && item.lastPurchasePrice !== undefined;
  const price = priceWasDefaulted ? (hasDefault ? Number(item.lastPurchasePrice) : null) : Number(line.unitPrice);
  const total = price !== null && qty > 0 ? roundMoney(qty * price) : null;
  const onHand = Number(item.quantityOnHand) || 0;
  let error = null;
  if (onHand <= 0) error = 'Out of stock. Remove this item or record a stock-in first.';
  else if (qty > onHand) error = `Only ${formatNumber(onHand)} ${item.unit} available`;
  else if (qty <= 0) error = 'Enter a quantity';
  // The item's "Allow decimal" setting can change (e.g. by a sync) while the sale is open.
  else if (!item.allowDecimal && !Number.isInteger(qty)) error = `${item.name} is sold in whole ${item.unit}. Enter a whole number.`;
  else if (price === null) error = 'No purchase price on record. Enter a sale price.';
  return { qty, price, priceWasDefaulted, total, error };
}

// amountPaidInput: '' = paid in full. Returns the sale total, what's owed, and whether the
// amount is more than the total.
export function saleTotals(lines, amountPaidInput) {
  const calcs = lines.map(lineCalc);
  const total = roundMoney(calcs.reduce((sum, c) => sum + (c.total || 0), 0));
  const units = calcs.reduce((sum, c) => sum + c.qty, 0);
  const raw = String(amountPaidInput ?? '').trim();
  const paidEntered = raw !== '' && Number.isFinite(Number(raw));
  const paid = paidEntered ? roundMoney(raw) : total;
  const owed = paidEntered ? Math.max(0, roundMoney(total - paid)) : 0;
  return {
    calcs,
    total,
    units,
    paidEntered,
    paid,
    owed,
    overpaid: paidEntered && paid > total + 0.005,
    nothingPaid: paidEntered && paid === 0,
    errors: calcs.filter((c) => c.error).length,
  };
}

// Splits what the customer paid across the lines in proportion to each line's total, in whole
// kobo, so each share is at most its line's total and the shares add up to the amount paid
// exactly. Same algorithm as the API's src/utils/salePayment.js, so an offline sale and one
// recorded through POST /transactions/sales split identically.
export function splitAmountPaid(lineTotals, amountPaid) {
  const totals = lineTotals.map((t) => Math.round(Number(t) * 100));
  const grand = totals.reduce((sum, t) => sum + t, 0);
  const paid = Math.min(Math.round(Number(amountPaid) * 100), grand);
  if (grand <= 0 || paid <= 0) return totals.map(() => 0);

  const shares = totals.map((t, index) => {
    const exact = (t * paid) / grand;
    return { index, kobo: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = paid - shares.reduce((sum, s) => sum + s.kobo, 0);
  const byRemainder = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const share of byRemainder) {
    if (left <= 0) break;
    if (share.kobo < totals[share.index]) {
      share.kobo += 1;
      left -= 1;
    }
  }
  return shares.map((s) => s.kobo / 100);
}
