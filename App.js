import 'react-native-gesture-handler';
import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { AuthProvider } from './src/context/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';
import SplashView from './src/components/SplashView';
import { initLocalDb } from './src/db/localDb';
import { fontAssets } from './src/theme';

// Initialize SQLite before AuthProvider can restore a session and start an automatic sync.
initLocalDb();

export default function App() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  // A font failure should never block the app — fall through with system fonts.
  const ready = fontsLoaded || !!fontError;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {ready ? (
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        ) : (
          <SplashView fontsReady={false} message="Starting up" />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
