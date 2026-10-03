import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todaySummary } from '../src/reports/todayMath.js';
import { salesHistory } from '../src/reports/salesMath.js';

const now = new Date(2026, 9, 3, 18, 0).getTime();
const today = (hour) => new Date(2026, 9, 3, hour).toISOString();
const yesterday = new Date(2026, 9, 2, 12).toISOString();
const items = [{ localId: 'a', name: 'Rice', unit: 'bag' }];
const sale = (id, extra) => ({ type: 'out', companyId: 1, clientTransactionId: id, itemLocalId: 'a', quantity: 1, unitPrice: 1000, paymentMethod: 'cash', ...extra });

test("cash in hand is today's cash in less today's cash out, for one person", () => {
  const transactions = [
    sale('mine', { occurredAt: today(9), createdByUserId: 7 }),
    sale('split', { occurredAt: today(10), userId: 7, amountPaid: 800, paymentMethod: 'mixed', paymentBreakdown: '{"cash":300,"transfer":500}' }),
    sale('other', { occurredAt: today(11), createdByUserId: 8 }),
    sale('old', { occurredAt: yesterday, createdByUserId: 7 }),
  ];
  const day = todaySummary({
    sales: salesHistory(items, transactions, 1),
    transactions,
    debtPayments: [{ amount: 250, paymentMethod: 'cash', occurredAt: today(12), createdByUserId: 7 }],
    outflows: [
      { kind: 'expense', amount: 100, paymentMethod: 'cash', occurredAt: today(13), createdByUserId: 7 },
      { kind: 'expense', amount: 999, paymentMethod: 'transfer', occurredAt: today(13), createdByUserId: 7 },
      { kind: 'savings_return', amount: 50, paymentMethod: 'cash', occurredAt: today(14), createdByUserId: 7 },
    ],
    userId: 7,
    now,
  });
  assert.equal(day.salesCount, 2);
  assert.equal(day.sold, 2000);
  assert.equal(day.received, 1800);
  assert.equal(day.owed, 200);
  assert.equal(day.cashIn, 1000 + 300 + 250 + 50);
  assert.equal(day.cashOut, 100);
  assert.equal(day.cashInHand, 1500);
  assert.equal(day.spent, 1099);
});
