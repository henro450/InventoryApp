import React, { createContext, useContext, useState, useEffect } from 'react';
import { Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Network from 'expo-network';
import { api, saveToken, clearToken, setUnauthorizedHandler } from '../api/client';
import { getPendingCount, clearLocalData } from '../db/localDb';
import { runSync } from '../sync/syncEngine';
import { isTokenExpired } from '../utils/jwt';
import { ROLES } from '../constants/roles';

// AUTH-02: token is cached locally (SecureStore) so the user stays logged in and can keep
// using the app offline after the first successful login.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // { id, name, email, role, companyId, company: { allowSubCompanies } }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const cachedUser = await SecureStore.getItemAsync('cachedUser');
      const token = await SecureStore.getItemAsync('authToken');
      if (cachedUser && token) {
        // AUTH-03: only enforce expiry while online — offline, a cached session must keep
        // working regardless of what the device clock says (AUTH-02).
        const netState = await Network.getNetworkStateAsync();
        const online = netState.isConnected && netState.isInternetReachable;
        if (online && isTokenExpired(token)) {
          await SecureStore.deleteItemAsync('authToken');
          await SecureStore.deleteItemAsync('cachedUser');
        } else {
          const parsedUser = JSON.parse(cachedUser);
          setUser(parsedUser);
          if (online) refreshCompany(parsedUser);
          // AUTH-04: push any backlog left from an unclean exit right away. The SuperAdmin
          // doesn't keep inventory on the device, so it never syncs.
          if (parsedUser.role !== ROLES.SUPER) runSync(parsedUser.id);
        }
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    // AUTH-03: a 401 on any authenticated request forces a clean logout centrally, from
    // inside api/client.js, without every screen needing its own handling.
    setUnauthorizedHandler(async (code) => {
      await SecureStore.deleteItemAsync('cachedUser');
      setUser(null);
      Alert.alert(
        code === 'TOKEN_EXPIRED' ? 'Session expired' : 'Authentication error',
        code === 'TOKEN_EXPIRED'
          ? 'Your session has expired, please log in again.'
          : 'You were logged out. Please log in again.'
      );
    });
  }, []);

  // The SuperAdmin can change whether a company may have Sub Companies at any time, so a
  // restored session re-reads it rather than trusting the copy cached at login.
  async function refreshCompany(currentUser) {
    if (currentUser.role !== ROLES.MAIN) return;
    try {
      const { company } = await api.getMyCompany();
      if (!company) return;
      const updated = {
        ...currentUser,
        company: { id: company.id, name: company.name, type: company.type, allowSubCompanies: company.allowSubCompanies },
      };
      await SecureStore.setItemAsync('cachedUser', JSON.stringify(updated));
      setUser((u) => (u && u.id === updated.id ? updated : u));
    } catch {
      // Offline or transient — keep the cached value.
    }
  }

  async function login(email, password) {
    const { token, user: loggedInUser } = await api.login(email.trim(), password);
    await saveToken(token);
    await SecureStore.setItemAsync('cachedUser', JSON.stringify(loggedInUser));
    setUser(loggedInUser);
    // AUTH-04: sync any backlog belonging to this user immediately.
    if (loggedInUser.role !== ROLES.SUPER) runSync(loggedInUser.id);
    return loggedInUser;
  }

  async function performLogout() {
    await clearToken();
    await SecureStore.deleteItemAsync('cachedUser');
    clearLocalData();
    setUser(null);
  }

  function logout() {
    const pending = user ? getPendingCount(user.id) : 0;
    if (pending > 0) {
      Alert.alert(
        'Unsynced changes',
        `You have ${pending} unsynced change${pending === 1 ? '' : 's'}. Logging out will remove them from this device. Log out anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Log Out', style: 'destructive', onPress: performLogout },
        ]
      );
      return;
    }
    performLogout();
  }

  const isSuperAdmin = user?.role === ROLES.SUPER;
  const isMainCompany = user?.role === ROLES.MAIN;
  // Sessions cached before this flag existed have no company info; the server still enforces it.
  const allowSubCompanies = isMainCompany && user?.company?.allowSubCompanies !== false;

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isMainCompany, isSuperAdmin, allowSubCompanies }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
