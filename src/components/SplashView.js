import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing, StatusBar } from 'react-native';
import Icon from './Icon';
import { colors, fonts } from '../theme';
import appConfig from '../../app.json';

// Shown while fonts load (App.js) and while a cached session is restored (RootNavigator).
// `fontsReady` is false on the very first frame, before custom fonts exist — fall back to the
// system font then instead of referencing a family that isn't registered yet.
export default function SplashView({ fontsReady = true, message = 'Restoring your session' }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.cubic), useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const f = (family) => (fontsReady ? { fontFamily: family } : { fontWeight: '700' });
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-60, 132] });

  return (
    <View style={styles.container} accessibilityLabel={`Inventory. ${message}`}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.ring, { width: 560, height: 560, borderRadius: 280, opacity: 0.05 }]} />
      <View style={[styles.ring, { width: 400, height: 400, borderRadius: 200, opacity: 0.07 }]} />
      <View style={[styles.ring, { width: 250, height: 250, borderRadius: 125, opacity: 0.09 }]} />

      <View style={styles.logo}>
        <Icon name="logo" size={50} color="#FFFFFF" strokeWidth={1.6} />
      </View>
      <Text style={[styles.wordmark, f(fonts.display)]}>Inventory</Text>
      <Text style={[styles.tagline, fontsReady && { fontFamily: fonts.regular }]}>Stock you can trust, online or off.</Text>

      <View style={styles.footer}>
        <View style={styles.track}>
          <Animated.View style={[styles.fill, { transform: [{ translateX }] }]} />
        </View>
        <Text style={[styles.footerText, fontsReady && { fontFamily: fonts.regular }]}>{message}</Text>
        <Text style={[styles.version, fontsReady && { fontFamily: fonts.mono }]}>v{appConfig.expo.version}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ring: { position: 'absolute', borderWidth: 1, borderColor: '#FFFFFF' },
  logo: {
    width: 96, height: 96, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.primary, shadowOpacity: 0.5, shadowRadius: 28, shadowOffset: { width: 0, height: 20 }, elevation: 12,
  },
  wordmark: { marginTop: 28, fontSize: 40, lineHeight: 46, letterSpacing: -1.2, color: '#FFFFFF' },
  tagline: { marginTop: 10, fontSize: 15, color: '#A7AEC2' },
  footer: { position: 'absolute', bottom: 64, alignItems: 'center', gap: 14 },
  track: { width: 132, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
  fill: { width: 60, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF' },
  footerText: { fontSize: 13, color: '#A7AEC2' },
  version: { fontSize: 12, color: '#7F869C' },
});
