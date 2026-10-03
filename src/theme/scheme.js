import { Appearance } from 'react-native';
import * as SQLite from 'expo-sqlite';

// Light or dark, chosen once when the app starts: styles across the app are built from the theme
// when their files load, so a change of setting takes effect the next time the app is opened.
// The setting lives in its own small table so logging out (which clears synced data) keeps it.
// 'system' follows the phone's dark mode setting.

let db = null;
function prefsDb() {
  if (!db) {
    db = SQLite.openDatabaseSync('inventory.db');
    db.execSync('CREATE TABLE IF NOT EXISTS app_prefs (key TEXT PRIMARY KEY, value TEXT)');
  }
  return db;
}

// Small settings that belong to this phone rather than the account (also used for list sorting).
export function getPref(key, fallback = null) {
  try {
    return prefsDb().getFirstSync('SELECT value FROM app_prefs WHERE key = ?', [key])?.value ?? fallback;
  } catch {
    return fallback;
  }
}

export function setPref(key, value) {
  try {
    prefsDb().runSync('INSERT INTO app_prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, String(value)]);
  } catch {
    // Not worth interrupting anyone over a remembered setting.
  }
}

export const APPEARANCES = [
  { key: 'system', label: 'Phone setting' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

export function getAppearancePref() {
  const value = getPref('appearance');
  return ['light', 'dark', 'system'].includes(value) ? value : 'system';
}

export function setAppearancePref(value) {
  setPref('appearance', value);
}

function resolve(pref) {
  if (pref === 'dark' || pref === 'light') return pref;
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

// The scheme this run of the app uses.
export const activeScheme = resolve(getAppearancePref());

// Whether a newly chosen setting differs from what's on screen now (so a restart is needed).
export function needsRestartFor(pref) {
  return resolve(pref) !== activeScheme;
}
