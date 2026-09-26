import { Alert, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { api } from '../api/client';
import { getCached, setCached } from '../db/localDb';
import { formatDate } from '../utils/format';

// Subscription expiry reminders for company admins. The server says when the subscription ends
// and how the SuperAdmin configured reminders (N days before, M times a day). Two channels:
// - phone notifications scheduled on the device for those days (they arrive even when the app
//   is closed and need no internet once scheduled);
// - an in-app pop-up when the app is opened, at most M times a day.
// Reminders continue for a few days after expiry.

const CHANNEL_ID = 'subscription';
const SCHEDULED_KEY = 'subscriptionReminderIds';
const LAST_POPUP_KEY = 'subscriptionReminderLastPopup';
const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_AFTER_EXPIRY = 3;
const FIRST_HOUR = 9; // reminders are spread between 09:00 and 18:00
const LAST_HOUR = 18;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

function cacheKey(user) {
  return `subscription:${user.companyId}`;
}

// Latest subscription info: from the server when reachable (and saved), otherwise the saved copy.
export async function loadSubscription(user) {
  try {
    const data = await api.getSubscription();
    setCached(cacheKey(user), data);
    return { data, savedAt: null };
  } catch {
    const saved = getCached(cacheKey(user));
    return saved ? { data: saved.data, savedAt: saved.savedAt } : { data: null, savedAt: null };
  }
}

// Hours of the day for M reminders, spread evenly between FIRST_HOUR and LAST_HOUR.
export function reminderHours(perDay) {
  const n = Math.max(1, Math.min(6, Number(perDay) || 2));
  if (n === 1) return [FIRST_HOUR];
  return Array.from({ length: n }, (_, i) => FIRST_HOUR + (i * (LAST_HOUR - FIRST_HOUR)) / (n - 1));
}

// When to remind: every reminder time from N days before the end until a few days after it.
export function reminderTimes({ endsAt, daysBefore, perDay, now = new Date() }) {
  if (!endsAt) return [];
  const end = new Date(endsAt);
  const start = new Date(end.getTime() - daysBefore * DAY_MS);
  const stop = new Date(end.getTime() + DAYS_AFTER_EXPIRY * DAY_MS);
  const times = [];
  const day = new Date(Math.max(start.getTime(), now.getTime()));
  day.setHours(0, 0, 0, 0);
  for (; day <= stop; day.setDate(day.getDate() + 1)) {
    for (const hour of reminderHours(perDay)) {
      const t = new Date(day);
      t.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
      if (t > now && t >= start && t <= stop) times.push(t);
    }
  }
  return times;
}

export function reminderMessage(companyName, endsAt, at = new Date(), isTrial = false) {
  const what = isTrial ? 'free trial' : 'subscription';
  const What = isTrial ? 'Free trial' : 'Subscription';
  const msLeft = new Date(endsAt) - at;
  if (msLeft <= 0) {
    return {
      title: `${What} ended`,
      body: `${companyName}'s ${what} ended on ${formatDate(endsAt)}. Stock in and sales are paused — pay and upload proof of payment to continue.`,
    };
  }
  const days = Math.ceil(msLeft / DAY_MS);
  return {
    title: days <= 1 ? `${What} ends today` : `${What} ends in ${days} days`,
    body: `${companyName}'s ${what} ends on ${formatDate(endsAt)}. Pay and upload proof of payment so stock in and sales aren't paused.`,
  };
}

function isTrialEnd(sub) {
  return !sub.currentPeriodEnd || new Date(sub.trialEndsAt || 0) > new Date(sub.currentPeriodEnd);
}

// Whether the subscription is in its reminder window (or expired) right now.
export function needsReminder(data, now = new Date()) {
  const end = data?.subscription?.endsAt;
  if (!end || data.managedByParent || data.subscription.free) return false;
  return new Date(end).getTime() - data.reminders.daysBefore * DAY_MS <= now.getTime();
}

async function cancelScheduled() {
  const saved = await SecureStore.getItemAsync(SCHEDULED_KEY);
  const ids = saved ? JSON.parse(saved) : [];
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
  await SecureStore.deleteItemAsync(SCHEDULED_KEY);
}

async function ensurePermission() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Subscription reminders',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

// Replaces this device's scheduled reminders with ones for the current subscription.
async function scheduleReminders(data) {
  await cancelScheduled();
  if (!data || data.managedByParent || data.subscription?.free || !data.subscription?.endsAt) return;
  const times = reminderTimes({
    endsAt: data.subscription.endsAt,
    daysBefore: data.reminders.daysBefore,
    perDay: data.reminders.perDay,
  }).slice(0, 60); // platform limits on pending notifications
  if (times.length === 0) return;
  if (!(await ensurePermission())) return;

  const ids = [];
  for (const date of times) {
    const content = reminderMessage(data.company.name, data.subscription.endsAt, date, isTrialEnd(data.subscription));
    ids.push(
      await Notifications.scheduleNotificationAsync({
        content: { ...content, data: { screen: 'Subscription' } },
        trigger: { date, channelId: CHANNEL_ID },
      })
    );
  }
  await SecureStore.setItemAsync(SCHEDULED_KEY, JSON.stringify(ids));
}

// In-app pop-up, at most `perDay` times a day.
async function maybeShowPopup(data, user, onOpen) {
  if (!needsReminder(data)) return;
  const key = `${LAST_POPUP_KEY}:${user.id}`;
  const last = Number(await SecureStore.getItemAsync(key)) || 0;
  const minGap = DAY_MS / Math.max(1, data.reminders.perDay);
  if (Date.now() - last < minGap) return;
  await SecureStore.setItemAsync(key, String(Date.now()));
  const { title, body } = reminderMessage(data.company.name, data.subscription.endsAt, new Date(), isTrialEnd(data.subscription));
  Alert.alert(title, body, [
    { text: 'Later', style: 'cancel' },
    { text: 'View subscription', onPress: onOpen },
  ]);
}

// Called on login, when the app comes to the foreground, and after a subscription change.
// Only company admins of the paying company get reminders; everyone else has theirs cleared.
export async function refreshSubscriptionReminders(user, { isCompanyAdmin, isSuperAdmin, onOpen } = {}) {
  try {
    if (!user || isSuperAdmin || !isCompanyAdmin) {
      await cancelScheduled();
      return;
    }
    const { data } = await loadSubscription(user);
    if (!data) return;
    await scheduleReminders(data);
    await maybeShowPopup(data, user, onOpen);
  } catch {
    // Reminders are best-effort; never break the app over them.
  }
}

export async function clearSubscriptionReminders() {
  await cancelScheduled().catch(() => {});
}
