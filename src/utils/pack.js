import { formatNumber } from './format';

// Items can be bought and sold in packs (a carton of 24, a bag of 50...). Stock is always kept in
// the item's own unit; a pack quantity is turned into units when it's saved, and a pack price into
// a price per unit (to 4 decimal places, which the server stores, so 24 pieces at ₦5,000 a carton
// still add back to ₦5,000).

export function hasPacks(item) {
  return Number(item?.packSize) > 1;
}

export function packLabel(item, count = 1) {
  const name = item?.packName || 'pack';
  return count === 1 || /s$/i.test(name) ? name : `${name}s`;
}

export function toUnits(quantity, item, inPacks) {
  const qty = Number(quantity) || 0;
  return inPacks && hasPacks(item) ? Math.round(qty * Number(item.packSize) * 100) / 100 : qty;
}

export function perUnitPrice(price, item, inPacks) {
  if (price === null || price === undefined || price === '') return null;
  const value = Number(price);
  return inPacks && hasPacks(item) ? Math.round((value / Number(item.packSize)) * 10000) / 10000 : value;
}

// The price of one pack at a per-unit price (shown as the default pack price).
export function packPrice(unitPrice, item) {
  if (unitPrice === null || unitPrice === undefined || unitPrice === '') return null;
  return Math.round(Number(unitPrice) * Number(item.packSize) * 100) / 100;
}

// "3 cartons + 4 pcs" for an item sold in packs, else "76 pcs".
export function formatStock(quantity, item) {
  const qty = Number(quantity) || 0;
  if (!hasPacks(item) || qty < Number(item.packSize)) return `${formatNumber(qty)} ${item?.unit || ''}`.trim();
  const size = Number(item.packSize);
  const packs = Math.floor(qty / size);
  const rest = Math.round((qty - packs * size) * 100) / 100;
  const whole = `${formatNumber(packs)} ${packLabel(item, packs)}`;
  return rest > 0 ? `${whole} + ${formatNumber(rest)} ${item.unit}` : whole;
}

// The two units a quantity can be entered in, for a Segmented control.
export function unitOptions(item) {
  return [
    { key: 'unit', label: item.unit || 'unit' },
    { key: 'pack', label: `${packLabel(item)} of ${formatNumber(Number(item.packSize))}` },
  ];
}
