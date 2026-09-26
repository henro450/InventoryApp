// Formatting helpers shared by every screen, so money and dates read the same everywhere.

export function formatMoney(n) {
  const value = Number(n || 0);
  const [whole, cents] = Math.abs(value).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${value < 0 ? '−' : ''}₦${grouped}.${cents}`;
}

// A company's subscription for SuperAdmin screens: price and status, e.g.
// "₦25,000.00 · Active until 26 Oct 2026" / "No price · Expired 1 Sep 2026" / "Not subscribed".
export function formatSubscription(subscription) {
  if (!subscription) return 'Not subscribed';
  if (subscription.status === 'free') return 'Free (₦0)';
  const price = subscription.price !== null && subscription.price !== undefined ? formatMoney(subscription.price) : 'No price set';
  const status =
    subscription.status === 'active'
      ? `Active until ${formatDate(subscription.endsAt || subscription.currentPeriodEnd)}`
      : subscription.status === 'trial'
        ? `Free trial until ${formatDate(subscription.endsAt)}`
        : subscription.status === 'expired'
          ? `Expired ${formatDate(subscription.endsAt || subscription.currentPeriodEnd)}`
          : 'Not subscribed';
  return `${price} · ${status}`;
}

export function formatNumber(n) {
  return String(Math.round(Number(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatPercent(n, digits = 1) {
  const value = Number(n || 0);
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}%`;
}

export function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// Calendar dates chosen in date fields are kept as 'YYYY-MM-DD' in the phone's local time.
export function dateToYmd(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function ymdToDate(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// A picked date range covers whole days on this phone: from the start of the first day to the
// end of the last day (so choosing today as "To" includes everything recorded today).
export function rangeBounds({ from, to } = {}) {
  const start = from ? ymdToDate(from) : null;
  const end = to ? ymdToDate(to) : null;
  if (end) end.setHours(23, 59, 59, 999);
  return { from: start ? start.toISOString() : '', to: end ? end.toISOString() : '' };
}

export function formatYmd(ymd) {
  return ymd ? ymdToDate(ymd).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${formatDate(iso)}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso) {
  if (!iso) return null;
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDate(iso);
}

export function lastSyncedLabel(iso) {
  return iso ? `Data last synced ${formatDateTime(iso)}` : 'Not yet synced';
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function plural(count, word, pluralWord = `${word}s`) {
  return `${count} ${count === 1 ? word : pluralWord}`;
}
