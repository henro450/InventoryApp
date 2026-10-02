import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Icon from './Icon';
import { Text } from './ui';
import { formatMoney, plural } from '../utils/format';
import { KIND_META } from '../utils/outflows';
import { colors, fonts } from '../theme';

export function dueTitle(d) {
  const o = d.outflow;
  const name = o.category || KIND_META[o.kind]?.short || 'Payment';
  if (d.daysUntil < 0) return `${name} was due ${plural(-d.daysUntil, 'day')} ago`;
  if (d.daysUntil === 0) return `${name} is due today`;
  if (d.daysUntil === 1) return `${name} is due tomorrow`;
  return `${name} due in ${d.daysUntil} days`;
}

// What to pre-fill in the Record sheet when someone pays a bill that's due.
export function dueRecordValues(d) {
  const o = d.outflow;
  return { kind: o.kind, category: o.category, amount: o.amount, paymentMethod: o.paymentMethod, repeatsMonthly: true, clientGoalId: o.clientGoalId };
}

// A monthly bill (rent, salaries, a loan) that's due soon or overdue, from getDueRepeats.
export default function DueBill({ due, onRecord }) {
  const title = dueTitle(due);
  return (
    <View style={styles.row}>
      <Icon name="calendar" size={20} color={colors.warn} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.sub}>{formatMoney(due.outflow.amount).replace(/\.00$/, '')} · repeats every month</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Record: ${title}`}
        onPress={onRecord}
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.buttonText}>Record</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 14, paddingRight: 10, borderRadius: 16,
    backgroundColor: colors.warnSoft, borderWidth: 1, borderColor: colors.warnLine,
  },
  title: { fontFamily: fonts.semibold, fontSize: 15, color: colors.warnInk },
  sub: { fontSize: 12, color: colors.warnInk, fontVariant: ['tabular-nums'] },
  button: {
    height: 40, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1,
    borderColor: colors.warnLine, alignItems: 'center', justifyContent: 'center',
  },
  buttonText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.warnInk },
});
