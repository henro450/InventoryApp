import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Segmented, Field } from './ui';
import { PAYMENT_METHODS, SPLIT_METHODS, splitProblem } from '../utils/payments';
import { formatMoney } from '../utils/format';
import { colors, fonts, type } from '../theme';

// Cash / Transfer / POS / Split. With Split, one amount box per method, which must add up to
// `amount` (the problem is shown under the boxes; the screen checks splitProblem() before saving).
// split = { cash: '2000', transfer: '', pos: '' } as typed.
export default function PaymentMethodPicker({ label, amount, method, onMethodChange, split, onSplitChange, allowSplit = true }) {
  const options = allowSplit ? PAYMENT_METHODS : PAYMENT_METHODS.filter((m) => m.key !== 'mixed');
  const problem = method === 'mixed' ? splitProblem(split, amount) : null;
  return (
    <View style={{ gap: 8 }}>
      {label ? <Text style={type.label}>{label}</Text> : null}
      <Segmented accessibilityLabel={label || 'Payment method'} options={options} value={method} onChange={onMethodChange} />
      {method === 'mixed' && (
        <View style={styles.split}>
          {SPLIT_METHODS.map((m) => (
            <View key={m.key} style={styles.splitRow}>
              <Text style={styles.splitLabel}>{m.label}</Text>
              <Field
                style={{ flex: 1 }}
                prefix="₦"
                keyboardType="decimal-pad"
                value={split[m.key] || ''}
                onChangeText={(v) => onSplitChange({ ...split, [m.key]: v })}
                placeholder="0"
                accessibilityLabel={`Amount paid by ${m.label}`}
              />
            </View>
          ))}
          <Text style={[type.caption, problem && { color: colors.danger }]}>
            {problem || `Adds up to ${formatMoney(amount)}.`}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  split: { gap: 8, paddingTop: 4 },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  splitLabel: { width: 72, fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
});
