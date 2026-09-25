import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './Icon';
import { Text } from './ui';
import { colors, fonts, shadow } from '../theme';

const TAB_META = {
  Overview: { label: 'Overview', icon: 'home' },
  Inventory: { label: 'Inventory', icon: 'box' },
  Reports: { label: 'Reports', icon: 'chart' },
  AuditLog: { label: 'Audit', icon: 'list' },
  Alerts: { label: 'Alerts', icon: 'bell' },
};

// Custom bottom tab bar. The "Scan" route is not a real page: pressing it opens the scanner
// modal (scan-to-find) through `onScan` instead of switching tabs.
export default function TabBar({ state, navigation, onScan }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]} accessibilityRole="tablist">
      {state.routes.map((route, index) => {
        if (route.name === 'Scan') {
          return (
            <Pressable key={route.key} accessibilityRole="button" accessibilityLabel="Scan barcode" onPress={onScan} style={styles.item}>
              <View style={styles.scanButton}>
                <Icon name="scan" size={22} color="#FFFFFF" strokeWidth={1.9} />
              </View>
              <Text style={[styles.label, { color: colors.ink }]}>Scan</Text>
            </Pressable>
          );
        }
        const meta = TAB_META[route.name] || { label: route.name, icon: 'box' };
        const focused = state.index === index;
        const color = focused ? colors.primary : colors.ink3;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={meta.label}
            onPress={onPress}
            style={styles.item}
          >
            <Icon name={meta.icon} size={23} color={color} strokeWidth={focused ? 2 : 1.7} />
            <Text style={[styles.label, { color, fontFamily: focused ? fonts.semibold : fonts.medium }]}>{meta.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start', paddingTop: 9, paddingHorizontal: 8,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line,
  },
  item: { width: 64, minHeight: 48, alignItems: 'center', gap: 4 },
  label: { fontSize: 11 },
  scanButton: {
    width: 50, height: 50, marginTop: -20, borderRadius: 17, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center', ...shadow.raised,
  },
});
