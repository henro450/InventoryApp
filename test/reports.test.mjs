import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salesVsPurchases, debtors, businessSummary, paidByMethod } from '../src/reports/reportMath.js';
import { salesHistory } from '../src/reports/salesMath.js';

const C = 1;
const items = [{ localId: 'rice', name: 'Rice', unit: 'bag', companyId: C, quantityOnHand: 5, lowStockThreshold: 2 }];
const at = (day, hour = 9) => new Date(Date.UTC(2026, 9, day, hour)).toISOString();
const tx = [
  { type: 'in', companyId: C, itemLocalId: 'rice', quantity: 10, unitPrice: 1000, occurredAt: at(1) },
  // Paid in full by cash.
  { type: 'out', companyId: C, itemLocalId: 'rice', clientTransactionId: 's1', quantity: 2, unitPrice: 1500, paymentMethod: 'cash', occurredAt: at(2) },
  // Part paid by a split payment; 1,000 owed by Bola.
  {
    type: 'out', companyId: C, itemLocalId: 'rice', clientTransactionId: 's2', quantity: 2, unitPrice: 1500, amountPaid: 2000,
    paymentMethod: 'mixed', paymentBreakdown: JSON.stringify({ cash: 500, transfer: 1500 }), customerName: 'Bola', customerPhone: '08031234567', occurredAt: at(3),
  },
  // One bag of the credit sale brought back: 1,000 comes off the debt, 500 handed back in cash.
  { type: 'return', companyId: C, itemLocalId: 'rice', clientTransactionId: 'r1', returnOf: 's2', quantity: 1, unitPrice: 1500, amountPaid: 500, paymentMethod: 'cash', customerPhone: '08031234567', occurredAt: at(4) },
  // Another company's sale never counts.
  { type: 'out', companyId: 2, itemLocalId: 'x', clientTransactionId: 'o1', quantity: 1, unitPrice: 99999, occurredAt: at(2) },
];
const repayments = [{ companyId: C, customerName: 'Bola', customerPhone: '08031234567', amount: 0, paymentMethod: 'cash', occurredAt: at(5) }];

test('a mixed payment is counted by method; older sales count as cash', () => {
  assert.deepEqual(paidByMethod(tx[2], 2000), { cash: 500, transfer: 1500 });
  assert.deepEqual(paidByMethod({ quantity: 1, unitPrice: 10 }, 10), { cash: 10 });
});

test('sales are net of returns, by payment method and credit', () => {
  const r = salesVsPurchases(tx, C);
  assert.equal(r.totalPurchaseCost, 10000);
  assert.equal(r.totalSalesRevenue, 6000 - 1500);
  assert.equal(r.saleCount, 2);
  assert.equal(r.returnCount, 1);
  assert.equal(r.salesByPaymentMethod.cash.revenue, 3000 + 500 - 500);
  assert.equal(r.salesByPaymentMethod.transfer.revenue, 1500);
  assert.equal(r.salesByPaymentMethod.credit.revenue, 0); // 1,000 owed, then cut by the return
});

test('a return cuts what the customer owes first', () => {
  const d = debtors(tx, repayments, C);
  const bola = d.customers.find((c) => c.customerPhone === '08031234567');
  assert.equal(bola.balance, 0);
  assert.equal(d.totals.customersOwing, 0);
});

test('debtors: repayments come off the balance', () => {
  const sale = { ...tx[2], clientTransactionId: 's9' };
  const d = debtors([sale], [{ ...repayments[0], amount: 400 }], C);
  assert.equal(d.customers[0].balance, 600);
  assert.equal(d.totals.outstanding, 600);
});

test('profit uses the purchase price in effect at the time of sale', () => {
  const s = businessSummary(items, tx, C);
  // 4 bags sold at 1,500 against a cost of 1,000, then 1 returned.
  assert.equal(s.profit, 4 * 500 - 500);
  assert.equal(s.bestSeller.name, 'Rice');
});

test('sales history groups returns under their sale', () => {
  const sales = salesHistory(items, tx, C);
  assert.equal(sales.length, 2);
  const credit = sales.find((s) => s.key === 's2');
  assert.equal(credit.status, 'returned');
  assert.equal(credit.returnedValue, 1500);
  assert.equal(credit.refunded, 500);
  assert.equal(credit.owed, 0);
});
