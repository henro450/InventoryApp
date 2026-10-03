import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSalePrice, lineCalc, saleTotals, splitAmountPaid, splitBreakdown } from '../src/utils/sale.js';

const rice = { name: 'Rice', unit: 'bag', quantityOnHand: 10, sellingPrice: 1500, lastPurchasePrice: 1000, allowDecimal: 0 };

test('a blank price uses the selling price, then the purchase price (flagged as at cost)', () => {
  assert.deepEqual(defaultSalePrice(rice), { price: 1500, atCost: false });
  assert.deepEqual(defaultSalePrice({ ...rice, sellingPrice: null }), { price: 1000, atCost: true });
  assert.deepEqual(defaultSalePrice({ sellingPrice: '', lastPurchasePrice: null }), { price: null, atCost: false });
});

test('a sale line checks stock, whole units and a missing price', () => {
  assert.equal(lineCalc({ item: rice, quantity: '2', unitPrice: '' }).total, 3000);
  assert.equal(lineCalc({ item: rice, quantity: '2', unitPrice: '1200' }).total, 2400);
  assert.match(lineCalc({ item: rice, quantity: '11', unitPrice: '' }).error, /Only 10/);
  assert.match(lineCalc({ item: rice, quantity: '1.5', unitPrice: '' }).error, /whole/);
  assert.match(lineCalc({ item: { ...rice, quantityOnHand: 0 }, quantity: '1', unitPrice: '' }).error, /Out of stock/);
  assert.match(lineCalc({ item: { ...rice, sellingPrice: null, lastPurchasePrice: null }, quantity: '1', unitPrice: '' }).error, /No selling price/);
  const atCost = lineCalc({ item: { ...rice, sellingPrice: null }, quantity: '1', unitPrice: '' });
  assert.equal(atCost.priceWasDefaulted, true);
});

test('a line sold in packs is saved in units at the per-unit price', () => {
  const cartons = { ...rice, unit: 'pc', quantityOnHand: 48, sellingPrice: 100, packSize: 24, packName: 'carton' };
  const line = lineCalc({ item: cartons, quantity: '2', unitPrice: '2400', inPacks: true });
  assert.equal(line.qty, 48);
  assert.equal(line.price, 100);
  assert.equal(line.total, 4800);
});

test('sale totals: paid in full, part paid and overpaid', () => {
  const lines = [{ item: rice, quantity: '2', unitPrice: '' }, { item: rice, quantity: '1', unitPrice: '500' }];
  assert.equal(saleTotals(lines, '').total, 3500);
  assert.equal(saleTotals(lines, '').owed, 0);
  const part = saleTotals(lines, '2000');
  assert.equal(part.paid, 2000);
  assert.equal(part.owed, 1500);
  assert.equal(saleTotals(lines, '4000').overpaid, true);
  assert.equal(saleTotals(lines, '0').nothingPaid, true);
});

test('splitting what was paid across lines adds up exactly, in whole kobo', () => {
  const shares = splitAmountPaid([1000, 333.33, 666.67], 1000);
  assert.equal(Math.round(shares.reduce((a, b) => a + b, 0) * 100), 100000);
  shares.forEach((s, i) => assert.ok(s <= [1000, 333.33, 666.67][i]));
  assert.deepEqual(splitAmountPaid([100, 200], 0), [0, 0]);
  assert.deepEqual(splitAmountPaid([100, 200], 999), [100, 200]); // never more than the total
});

test('a split payment fills lines from cash, then transfer, then POS', () => {
  assert.deepEqual(splitBreakdown([3000, 2000], { cash: 4000, transfer: 1000 }), [{ cash: 3000 }, { cash: 1000, transfer: 1000 }]);
});
