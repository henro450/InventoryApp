import React from 'react';
import { AuthProvider } from './src/context/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';
import { initLocalDb } from './src/db/localDb';

// Initialize SQLite before AuthProvider can restore a session and start an automatic sync.
initLocalDb();

export default function App() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
