import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { getStockWarnings } from '../reports/localReports';
import { plural } from '../utils/format';

// A morning phone notification for company admins: items at or below their low-stock level and
// stock that expires within two weeks. Worked out from this phone's data and scheduled on the
// device for the next few mornings, so it arrives even if the app isn't opened. It's rescheduled
// whenever the app opens or syncs, so the message stays current. Tapping it opens Alerts.

const CHANNEL_ID = 'stock';
const SCHEDULED_KEY = 'stockWarningIds';
const HOUR = 9;
const MORNINGS = 3;

async function cancelScheduled() {
  const saved = await SecureStore.getItemAsync(SCHEDULED_KEY);
  const ids = saved ? JSON.parse(saved) : [];
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
  await SecureStore.deleteItemAsync(SCHEDULED_KEY);
}

async function ensurePermission() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Low stock and expiry',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

// The next MORNINGS 09:00s still to come.
export function nextMornings(now = new Date(), count = MORNINGS) {
  const first = new Date(now);
  first.setHours(HOUR, 0, 0, 0);
  if (first <= now) first.setDate(first.getDate() + 1);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    return d;
  });
}

const names = (rows, key) => {
  const shown = rows.slice(0, 3).map((r) => r[key]);
  return rows.length > 3 ? `${shown.join(', ')} and ${rows.length - 3} more` : shown.join(', ');
};

export function warningMessage({ lowStock, expiring }) {
  const expired = expiring.filter((e) => e.expired);
  const soon = expiring.filter((e) => !e.expired);
  const parts = [];
  if (lowStock.length) parts.push(`Low: ${names(lowStock, 'name')}.`);
  if (expired.length) parts.push(`Expired: ${names(expired, 'itemName')}.`);
  if (soon.length) parts.push(`Expiring soon: ${names(soon, 'itemName')}.`);
  if (!parts.length) return null;
  const titleParts = [];
  if (lowStock.length) titleParts.push(`${plural(lowStock.length, 'item')} low on stock`);
  if (expiring.length) titleParts.push(`${plural(expiring.length, 'batch', 'batches')} ${expired.length === expiring.length ? 'expired' : 'expiring'}`);
  return { title: titleParts.join(' · '), body: parts.join(' ') };
}

// Called on login, when the app comes to the foreground, and after each sync. Company admins
// only; for anyone else (or nothing to warn about) any scheduled warnings are cleared.
// Runs one refresh at a time, so two quick calls can't both schedule.
let queue = Promise.resolve();
export function refreshStockWarnings(user, roles = {}) {
  queue = queue.then(() => reschedule(user, roles));
  return queue;
}

async function reschedule(user, { isCompanyAdmin, isSuperAdmin }) {
  try {
    await cancelScheduled();
    if (!user || isSuperAdmin || !isCompanyAdmin) return;
    const days = getStockWarnings(user.companyId, nextMornings());
    const messages = days.map((d) => ({ date: d.now, content: warningMessage(d) })).filter((m) => m.content);
    if (!messages.length || !(await ensurePermission())) return;
    const ids = [];
    for (const { date, content } of messages) {
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content: { ...content, data: { screen: 'Alerts' } },
          trigger: { date, channelId: CHANNEL_ID },
        })
      );
    }
    await SecureStore.setItemAsync(SCHEDULED_KEY, JSON.stringify(ids));
  } catch {
    // Best-effort, like the subscription reminders.
  }
}

export function clearStockWarnings() {
  queue = queue.then(() => cancelScheduled().catch(() => {}));
  return queue;
}
