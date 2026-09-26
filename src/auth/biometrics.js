import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';
import { api } from '../api/client';

// Fingerprint login. After a password login the user can register this phone: the server issues
// a device token, which is kept in SecureStore (the platform keystore/keychain) and only read
// after the phone's own fingerprint check passes. The token is exchanged for a normal session
// (POST /auth/biometric/login). The password is never stored on the phone, and the server can
// revoke the token (turned off here, another account registered, or a password reset).

const TOKEN_KEY = 'biometricDeviceToken';
const USER_KEY = 'biometricUser'; // { id, email, name } — shown on the login screen

// True when the phone has a fingerprint sensor with at least one fingerprint enrolled.
export async function fingerprintAvailable() {
  try {
    const [hasHardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    return hasHardware && enrolled && types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
  } catch {
    return false;
  }
}

// The account registered for fingerprint login on this phone, or null.
export async function getFingerprintUser() {
  try {
    const [user, token] = await Promise.all([SecureStore.getItemAsync(USER_KEY), SecureStore.getItemAsync(TOKEN_KEY)]);
    return user && token ? JSON.parse(user) : null;
  } catch {
    return null;
  }
}

// Shows the system fingerprint prompt. Resolves true only on a successful scan; cancelling or
// failing resolves false. Device PIN fallback is off, so this really is the fingerprint.
export async function confirmFingerprint(promptMessage) {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: 'Cancel',
    disableDeviceFallback: true,
  });
  return result.success;
}

async function clearStored() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}

// Registers this phone for `user` (must be signed in). Replaces any other account's fingerprint
// login on this phone, revoking its token on the server.
export async function registerFingerprint(user) {
  const previous = await SecureStore.getItemAsync(TOKEN_KEY);
  const { deviceToken } = await api.registerBiometric(Device.deviceName || Device.modelName || null);
  if (previous) api.revokeBiometric(previous).catch(() => {});
  await SecureStore.setItemAsync(TOKEN_KEY, deviceToken);
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify({ id: user.id, email: user.email, name: user.name }));
}

// Fingerprint check, then exchange the stored token for a session. Resolves null if the user
// cancels the scan. If the server no longer accepts the token, fingerprint login is switched
// off on this phone and the error (code BIOMETRIC_INVALID) is rethrown.
export async function signInWithFingerprint() {
  const ok = await confirmFingerprint('Log in with your fingerprint');
  if (!ok) return null;
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) {
    await clearStored();
    throw Object.assign(new Error('Fingerprint login is not set up on this phone. Log in with your password.'), { code: 'BIOMETRIC_INVALID' });
  }
  try {
    return await api.biometricLogin(token);
  } catch (err) {
    if (err.code === 'BIOMETRIC_INVALID') await clearStored();
    throw err;
  }
}

export async function turnOffFingerprint() {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  await clearStored();
  if (token) api.revokeBiometric(token).catch(() => {});
}
