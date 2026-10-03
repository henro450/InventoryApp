import { Share, Linking } from 'react-native';
import { formatDateTime, formatMoney, formatNumber } from './format';
import { formatPhone, normalizePhone } from './phone';
import { SPLIT_METHODS } from './payments';
import { receiptNumber } from '../reports/salesMath';

function methodsLine(byMethod) {
  const parts = SPLIT_METHODS.filter((m) => Number(byMethod[m.key]) > 0).map((m) => `${m.label} ${formatMoney(byMethod[m.key])}`);
  return parts.length ? parts.join(' + ') : null;
}

// A plain-text receipt (fits a WhatsApp message or SMS) for one sale from salesHistory().
export function receiptText(sale, companyName) {
  const lines = [];
  if (companyName) lines.push(companyName.toUpperCase());
  lines.push(`Receipt #${receiptNumber(sale.key)}`);
  lines.push(formatDateTime(sale.occurredAt));
  lines.push('--------------------------------');
  for (const l of sale.lines) {
    lines.push(`${l.itemName}`);
    lines.push(`  ${formatNumber(l.quantity)} ${l.unit} x ${formatMoney(l.unitPrice)} = ${formatMoney(l.total)}`);
  }
  lines.push('--------------------------------');
  lines.push(`Total: ${formatMoney(sale.total)}`);
  const paidWith = methodsLine(sale.paidByMethod);
  lines.push(`Paid: ${formatMoney(sale.paid)}${paidWith ? ` (${paidWith})` : ''}`);
  if (sale.returns.length) {
    lines.push('');
    lines.push(sale.status === 'voided' ? 'This sale was cancelled.' : 'Returned:');
    for (const r of sale.returns) lines.push(`  ${r.itemName} x ${formatNumber(r.quantity)} = -${formatMoney(Number(r.quantity) * Number(r.unitPrice))}`);
    if (sale.refunded > 0) {
      const back = methodsLine(sale.refundedByMethod);
      lines.push(`Money given back: ${formatMoney(sale.refunded)}${back ? ` (${back})` : ''}`);
    }
  }
  if (sale.owed > 0) lines.push(`Balance to pay: ${formatMoney(sale.owed)}`);
  if (sale.customerName) lines.push(`Customer: ${sale.customerName}${sale.customerPhone ? `, ${formatPhone(sale.customerPhone)}` : ''}`);
  lines.push('');
  lines.push('Thank you for your patronage!');
  return lines.join('\n');
}

// Opens the phone's share sheet (WhatsApp, SMS, email, a printer app...).
export function shareReceipt(sale, companyName) {
  return Share.share({ message: receiptText(sale, companyName), title: `Receipt #${receiptNumber(sale.key)}` });
}

// Straight to a WhatsApp chat with the customer (wa.me opens the app, or the browser if it isn't
// installed). Nigerian numbers are sent as 234XXXXXXXXXX. Falls back to the share sheet.
export async function whatsappReceipt(sale, companyName) {
  const digits = normalizePhone(sale.customerPhone);
  const international = digits.startsWith('0') && digits.length === 11 ? `234${digits.slice(1)}` : digits;
  const url = `https://wa.me/${international}?text=${encodeURIComponent(receiptText(sale, companyName))}`;
  try {
    await Linking.openURL(url);
  } catch {
    await shareReceipt(sale, companyName);
  }
}

