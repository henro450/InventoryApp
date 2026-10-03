import { hasPacks, toUnits, perUnitPrice, formatStock } from './pack';

// Maths for a sale of several items (StockTransactionScreen, stock out). Each line keeps the
// single-item rules: quantity is checked against that item's stock on hand, and a blank price
// uses the item's selling price, or failing that its last purchase price (flagged, since the
// sale is then recorded at cost).

export function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

const isSet = (v) => v !== null && v !== undefined && v !== '';

// The price a sale line uses when none is typed: { price, atCost } — atCost when it fell back to
// the last purchase price because the item has no selling price. Same rule as the server.
export function defaultSalePrice(item) {
  if (isSet(item.sellingPrice)) return { price: Number(item.sellingPrice), atCost: false };
  if (isSet(item.lastPurchasePrice)) return { price: Number(item.lastPurchasePrice), atCost: true };
  return { price: null, atCost: false };
}

// line = { item, quantity: '6', unitPrice: '', inPacks: false } (inputs as typed). With inPacks
// the quantity and typed price are per pack; qty and price come back per unit, as saved.
export function lineCalc(line) {
  const { item } = line;
  const inPacks = !!line.inPacks && hasPacks(item);
  const qty = toUnits(line.quantity, item, inPacks);
  const typed = String(line.unitPrice ?? '').trim() !== '';
  const fallback = defaultSalePrice(item);
  const price = typed ? perUnitPrice(line.unitPrice, item, inPacks) : fallback.price;
  // Only a fall-back to the purchase price is "defaulted" (shown as recorded at cost).
  const priceWasDefaulted = !typed && fallback.atCost;
  const total = price !== null && qty > 0 ? roundMoney(qty * price) : null;
  const onHand = Number(item.quantityOnHand) || 0;
  let error = null;
  if (onHand <= 0) error = 'Out of stock. Remove this item or record a stock-in first.';
  else if (qty > onHand) error = `Only ${formatStock(onHand, item)} available`;
  else if (qty <= 0) error = 'Enter a quantity';
  // The item's "Allow decimal" setting can change (e.g. by a sync) while the sale is open.
  else if (!item.allowDecimal && !Number.isInteger(qty)) error = `${item.name} is sold in whole ${item.unit}. Enter a whole number.`;
  else if (price === null) error = 'No selling price set for this item. Enter a sale price.';
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

// How a 'mixed' payment for the whole sale is split across its lines, given what each line was
// paid. Lines are filled in order from cash, then transfer, then POS, in whole kobo, so every
// line adds up to its own paid amount. Same algorithm as the API's splitBreakdown
// (src/utils/salePayment.js), so offline and online sales split identically.
const BREAKDOWN_METHODS = ['cash', 'transfer', 'pos'];
export function splitBreakdown(linePaid, breakdown) {
  const left = BREAKDOWN_METHODS.filter((m) => Number(breakdown[m]) > 0).map((m) => ({ method: m, kobo: Math.round(Number(breakdown[m]) * 100) }));
  let index = 0;
  return linePaid.map((paid) => {
    let need = Math.round(Number(paid) * 100);
    const line = {};
    while (need > 0 && index < left.length) {
      const take = Math.min(need, left[index].kobo);
      line[left[index].method] = ((line[left[index].method] || 0) * 100 + take) / 100;
      left[index].kobo -= take;
      need -= take;
      if (left[index].kobo === 0) index += 1;
    }
    return line;
  });
}
