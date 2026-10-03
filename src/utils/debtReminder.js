import { Linking, Platform, Share } from 'react-native';
import { normalizePhone } from './phone';
import { formatMoney } from './format';

// The message a shop sends a customer who owes it. Plain and polite; the owner can edit it in
// WhatsApp or the SMS app before sending.
export function debtReminderText({ customerName, balance, companyName }) {
  const from = companyName ? ` from ${companyName}` : '';
  return [
    `Hello ${customerName},`,
    `This is a friendly reminder${from} that you have an outstanding balance of ${formatMoney(balance)}.`,
    'Kindly pay at your earliest convenience. Thank you!',
  ].join('\n');
}

// WhatsApp wants the number in international form without a plus: 0803... -> 234803...
export function whatsappNumber(phone) {
  const digits = normalizePhone(phone);
  return digits.startsWith('0') && digits.length === 11 ? `234${digits.slice(1)}` : digits;
}

async function openOrShare(url, message) {
  try {
    await Linking.openURL(url);
  } catch {
    await Share.share({ message });
  }
}

export function sendWhatsappReminder(phone, details) {
  const message = debtReminderText(details);
  return openOrShare(`https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(message)}`, message);
}

// iOS separates the body with "&", Android with "?".
export function sendSmsReminder(phone, details) {
  const message = debtReminderText(details);
  const separator = Platform.OS === 'ios' ? '&' : '?';
  return openOrShare(`sms:${normalizePhone(phone)}${separator}body=${encodeURIComponent(message)}`, message);
}
