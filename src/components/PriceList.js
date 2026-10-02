import React from 'react';
import { View, StyleSheet } from 'react-native';
import Icon from './Icon';
import { Text } from './ui';
import { formatFee } from '../constants/registrationPricing';
import { colors, fonts, radius } from '../theme';

// The registration price list, with the tier that applies to the current answer highlighted.
export default function PriceList({ tiers, activeKey }) {
  return (
    <View style={styles.list} accessibilityRole="list">
      {tiers.map((tier, i) => {
        const active = tier.key === activeKey;
        return (
          <View
            key={tier.key}
            style={[styles.row, i > 0 && styles.rowBorder, active && styles.rowActive]}
            accessibilityLabel={`${tier.label}: ${formatFee(tier.fee)}${active ? ', applies to you' : ''}`}
          >
            <View style={[styles.radio, active && styles.radioActive]}>
              {active ? <Icon name="check" size={14} color="#FFFFFF" strokeWidth={2.5} /> : null}
            </View>
            <Text style={[styles.label, active && { color: colors.primaryInk, fontFamily: fonts.semibold }]}>{tier.label}</Text>
            <Text style={[styles.fee, active && { color: colors.primaryInk }]}>{formatFee(tier.fee)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  rowActive: { backgroundColor: colors.primarySoft },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.lineStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  radioActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  label: { flex: 1, fontSize: 15, lineHeight: 20, color: colors.ink },
  fee: { fontFamily: fonts.display, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
});
