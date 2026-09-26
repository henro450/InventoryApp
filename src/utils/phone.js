// Customers who owe money are identified by phone number within a company, so "0803 123 4567",
// "+234 803 123 4567" and a number picked from contacts are the same person.
// Keep in sync with InventoryApi/src/utils/phone.js.
export function normalizePhone(value) {
  if (value === null || value === undefined) return '';
  let digits = String(value).replace(/\D/g, '');
  // Nigerian numbers: +234 / 234 prefix -> leading 0 (234 8031234567 -> 08031234567).
  if (digits.startsWith('234') && digits.length === 13) digits = `0${digits.slice(3)}`;
  return digits;
}

export function isValidPhone(value) {
  const digits = normalizePhone(value);
  return digits.length >= 7 && digits.length <= 15;
}

// 08031234567 -> 0803 123 4567 for display; other lengths are shown as stored.
export function formatPhone(value) {
  const d = normalizePhone(value);
  return d.length === 11 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : d;
}
