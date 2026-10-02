// Registration price list by number of sub-companies. The API's list
// (GET /auth/registration-pricing) is the source of truth; this copy is only shown until it loads
// or when the phone is offline. Keep in sync with InventryAPI/src/config/registrationPricing.js.
export const FALLBACK_REGISTRATION_TIERS = [
  { key: 'standalone', label: 'No sub-companies', minSubCompanies: 0, maxSubCompanies: 0, fee: 2000 },
  { key: 'group', label: '1 to 4 sub-companies', minSubCompanies: 1, maxSubCompanies: 4, fee: 5000 },
  { key: 'large_group', label: '5 or more sub-companies', minSubCompanies: 5, maxSubCompanies: null, fee: 10000 },
];

export function tierFor(count, tiers = FALLBACK_REGISTRATION_TIERS) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return tiers.find((t) => n >= t.minSubCompanies && (t.maxSubCompanies === null || n <= t.maxSubCompanies)) || null;
}

// Fees are whole naira, so the price list reads "₦5,000" rather than "₦5,000.00".
export function formatFee(n) {
  return `₦${String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
