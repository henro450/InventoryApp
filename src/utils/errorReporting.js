import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { API_BASE_URL, authHeaders } from '../api/client';
import { getPref, setPref } from '../theme/scheme';

// Crash and error reporting to our own API (POST /error-reports), so problems on users' phones
// show up for the SuperAdmin without a third-party service. Reports are queued on the phone first
// and sent when there's a connection, so an error offline isn't lost. In development the red
// error screen already shows everything, so nothing is sent.

const QUEUE_KEY = 'pendingErrorReports';
const MAX_QUEUED = 20;
const enabled = !__DEV__;

let currentScreen = null;
const recent = new Map(); // message -> time last reported this session, to drop rapid repeats

export function setCurrentScreen(name) {
  currentScreen = name || null;
}

function readQueue() {
  try {
    const parsed = JSON.parse(getPref(QUEUE_KEY, '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  setPref(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUED)));
}

function baseContext() {
  return {
    appVersion: Constants.expoConfig?.version,
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    runtimeVersion: Updates.runtimeVersion || undefined,
    updateId: Updates.updateId || 'embedded',
    channel: Updates.channel || undefined,
    screen: currentScreen || undefined,
  };
}

// Records an error and tries to send it. Never throws: reporting must not cause a second failure.
export function reportError(error, extra = {}) {
  if (!enabled) return;
  try {
    const message = String(error?.message || error || 'Unknown error').slice(0, 1000);
    const last = recent.get(message);
    if (last && Date.now() - last < 60000) return;
    recent.set(message, Date.now());
    const report = {
      message: error?.name && error.name !== 'Error' ? `${error.name}: ${message}` : message,
      stack: error?.stack ? String(error.stack).slice(0, 8000) : undefined,
      context: { ...baseContext(), ...extra, at: new Date().toISOString() },
    };
    writeQueue([...readQueue(), report]);
    flushErrorReports();
  } catch {
    // Ignore.
  }
}

let flushing = false;

// Sends queued reports. Called after each report, at start-up and after every sync.
export async function flushErrorReports() {
  if (!enabled || flushing) return;
  flushing = true;
  try {
    let queue = readQueue();
    while (queue.length) {
      const res = await fetch(`${API_BASE_URL}/error-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(queue[0]),
      });
      // 429 (too many) or a server problem: keep the queue for later. A 400 will never succeed.
      if (res.status === 429 || res.status >= 500) break;
      queue = queue.slice(1);
      writeQueue(queue);
    }
  } catch {
    // Offline: try again later.
  } finally {
    flushing = false;
  }
}

// Catches errors nothing else handled: uncaught exceptions (including crashes) and, in release
// builds on Hermes, promises that failed with nobody listening.
export function installErrorReporting() {
  if (!enabled) return;
  const previous = global.ErrorUtils?.getGlobalHandler?.();
  global.ErrorUtils?.setGlobalHandler?.((error, isFatal) => {
    reportError(error, { fatal: !!isFatal });
    previous?.(error, isFatal);
  });
  global.HermesInternal?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (id, rejection) => reportError(rejection instanceof Error ? rejection : new Error(String(rejection)), { unhandledPromise: true }),
  });
  flushErrorReports();
}
