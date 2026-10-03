import { useEffect } from 'react';
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { formatDate } from './format';

// Over-the-air app updates (expo-updates). Fixes published with `npm run update:production`
// reach phones without a new store release, as long as they only change JavaScript and images
// (anything native needs a new build and a new app version). The phone checks when the app
// opens and again when it comes back to the foreground; a downloaded update is used from the
// next start, so nobody is interrupted mid-sale. Updates.isEnabled is false in development.

const CHECK_EVERY_MS = 30 * 60 * 1000;
let lastCheck = 0;
let ready = false;

// 'ready' (downloaded, applies on restart), 'none', 'disabled' or 'error'.
export async function checkForAppUpdate() {
  if (!Updates.isEnabled) return 'disabled';
  if (ready) return 'ready';
  lastCheck = Date.now();
  try {
    const { isAvailable } = await Updates.checkForUpdateAsync();
    if (!isAvailable) return 'none';
    const { isNew } = await Updates.fetchUpdateAsync();
    ready = ready || isNew;
    return ready ? 'ready' : 'none';
  } catch {
    return 'error';
  }
}

export function canRestartApp() {
  return Updates.isEnabled;
}

// Restarts the JavaScript (not the whole phone app): picks up a downloaded update or a new
// appearance setting. Only call it when the user asked to.
export function restartApp() {
  return Updates.reloadAsync();
}

// "1.0.0" or "1.0.0 · updated 3 Oct 2026".
export function appVersionLabel() {
  const version = Constants.expoConfig?.version || '';
  if (!Updates.isEnabled || Updates.isEmbeddedLaunch || !Updates.createdAt) return version;
  return `${version} · updated ${formatDate(Updates.createdAt.toISOString())}`;
}

// Background check when the app returns to the foreground, at most every 30 minutes.
export function useBackgroundUpdates() {
  useEffect(() => {
    if (!Updates.isEnabled) return undefined;
    lastCheck = Date.now(); // the launch itself already checked (checkAutomatically: ON_LOAD)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastCheck > CHECK_EVERY_MS) checkForAppUpdate();
    });
    return () => sub.remove();
  }, []);
}
