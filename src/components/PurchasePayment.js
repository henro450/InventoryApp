import React, { useMemo, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { getSuppliers } from '../reports/localReports';
import { formatMoney } from '../utils/format';
import { formatPhone, normalizePhone } from '../utils/phone';
import CustomerSheet from './CustomerSheet';
import { Text, Card, ListCard, Divider, Segmented, Field, Note, Button, SearchField, LetterTile, KV } from './ui';
import { colors, fonts, type } from '../theme';

export const PURCHASE_MODES = [
  { key: 'full', label: 'Paid in full' },
  { key: 'part', label: 'Part paid' },
  { key: 'credit', label: 'On credit' },
];

const QUICK_PICKS = 4;

// What a stock-in's payment adds up to. partInput is typed; returns null for "paid in full" (the
// amountPaid stored for a fully paid purchase, like every older one).
export function purchaseAmounts(mode, partInput, total) {
  if (mode === 'full') return { amountPaid: null, paid: total, owed: 0, problem: null };
  const paid = mode === 'credit' ? 0 : Math.round(Number(partInput) * 100) / 100;
  if (mode === 'part' && (String(partInput).trim() === '' || !Number.isFinite(paid) || paid < 0)) {
    return { amountPaid: null, paid: 0, owed: total, problem: 'Enter how much you paid now, or choose "On credit" if nothing was paid.' };
  }
  if (paid > total + 0.005) return { amountPaid: paid, paid, owed: 0, problem: `That's more than the purchase total of ${formatMoney(total)}.` };
  return { amountPaid: paid, paid, owed: Math.max(0, Math.round((total - paid) * 100) / 100), problem: null };
}

// The payment part of a stock-in: paid in full, part paid or on credit, and who supplied it.
// The supplier is optional when paid in full and needed when anything is owed, so the Suppliers
// screen can say who to pay. Suppliers bought from before are offered first.
export default function PurchasePayment({ companyId, total, mode, onModeChange, partInput, onPartInputChange, supplier, onSupplierChange }) {
  const [query, setQuery] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const known = useMemo(() => getSuppliers(companyId).suppliers, [companyId]);
  const owingNow = (phone) => {
    const match = known.find((s) => s.supplierPhone === normalizePhone(phone));
    return match && match.balance > 0 ? match.balance : 0;
  };
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    if (!q) return [...known].sort((a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt))).slice(0, QUICK_PICKS);
    return known.filter((s) => s.supplierName.toLowerCase().includes(q) || (digits && s.supplierPhone.includes(digits))).slice(0, 6);
  }, [known, query]);

  const amounts = purchaseAmounts(mode, partInput, total);
  const needed = mode !== 'full';

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 8 }}>
        <Text style={type.label}>How did you pay the supplier?</Text>
        <Segmented accessibilityLabel="How the supplier was paid" options={PURCHASE_MODES} value={mode} onChange={onModeChange} />
      </View>

      {mode === 'part' && (
        <Field
          label="Amount paid now"
          prefix="₦"
          keyboardType="decimal-pad"
          value={partInput}
          onChangeText={onPartInputChange}
          placeholder="0"
          error={amounts.problem && String(partInput).trim() !== '' ? amounts.problem : null}
        />
      )}

      {needed && total > 0 && (
        <Card padding={14} gap={6}>
          <KV label="Purchase total" value={formatMoney(total)} />
          <KV label="Paid now" value={formatMoney(Math.min(amounts.paid, total))} valueColor={colors.ok} />
          <Divider />
          <KV label="You will owe" value={formatMoney(amounts.owed)} valueColor={amounts.owed > 0 ? colors.warn : colors.ink} strong />
        </Card>
      )}

      <View style={{ gap: 10 }}>
        <Text style={type.label}>
          {needed ? 'Who supplied it?' : 'Supplier'}
          {!needed && <Text style={type.caption}> (optional)</Text>}
        </Text>
        {supplier ? (
          <Card padding={14} gap={10}>
            <View style={styles.personRow}>
              <LetterTile label={supplier.name} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.bodyStrong} numberOfLines={1}>{supplier.name}</Text>
                <Text style={type.caption}>{formatPhone(supplier.phone)}</Text>
              </View>
              <Button title="Change" variant="ghost" height={36} onPress={() => onSupplierChange(null)} />
            </View>
            {amounts.owed > 0 && (
              <Note kind={owingNow(supplier.phone) > 0 ? 'warn' : 'info'} icon={owingNow(supplier.phone) > 0 ? 'alert' : 'info'}>
                {owingNow(supplier.phone) > 0
                  ? `You already owe ${supplier.name} ${formatMoney(owingNow(supplier.phone))}. After this: ${formatMoney(owingNow(supplier.phone) + amounts.owed)}.`
                  : `You will owe ${supplier.name} ${formatMoney(amounts.owed)}. Pay it off from the Suppliers screen.`}
              </Note>
            )}
          </Card>
        ) : (
          <>
            {known.length > QUICK_PICKS && <SearchField value={query} onChangeText={setQuery} placeholder="Search suppliers" />}
            {matches.length > 0 && (
              <ListCard>
                {matches.map((s, index) => (
                  <Pressable
                    key={s.supplierPhone}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.supplierName}${s.balance > 0 ? `, you owe ${formatMoney(s.balance)}` : ''}`}
                    onPress={() => {
                      onSupplierChange({ name: s.supplierName, phone: s.supplierPhone });
                      setQuery('');
                    }}
                    style={({ pressed }) => [styles.pickRow, index > 0 && styles.pickRowBorder, pressed && { backgroundColor: colors.surfaceMuted }]}
                  >
                    <LetterTile label={s.supplierName} size={36} />
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={type.bodyStrong} numberOfLines={1}>{s.supplierName}</Text>
                      <Text style={type.caption}>{formatPhone(s.supplierPhone)}</Text>
                    </View>
                    {s.balance > 0 && <Text style={styles.owes}>You owe {formatMoney(s.balance)}</Text>}
                  </Pressable>
                ))}
              </ListCard>
            )}
            <Button title="New supplier" variant="secondary" icon="contacts" height={48} onPress={() => setSheetOpen(true)} />
          </>
        )}
      </View>

      <CustomerSheet
        visible={sheetOpen}
        initial={supplier}
        who="supplier"
        title="Who supplied this stock?"
        description="Purchases and anything you owe are kept against this supplier on the Suppliers screen."
        onClose={() => setSheetOpen(false)}
        onSave={(s) => {
          onSupplierChange(s);
          setSheetOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  pickRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  owes: { fontFamily: fonts.semibold, fontSize: 13, color: colors.warn, fontVariant: ['tabular-nums'] },
});
