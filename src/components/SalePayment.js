import React, { useMemo, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { getDebtors } from '../reports/localReports';
import { formatMoney } from '../utils/format';
import { formatPhone, normalizePhone } from '../utils/phone';
import { roundMoney } from '../utils/sale';
import Icon from './Icon';
import CustomerSheet from './CustomerSheet';
import { Text, Card, ListCard, Divider, Segmented, Field, Note, Button, SearchField, LetterTile, KV, Chip, InlineEmpty } from './ui';
import { colors, fonts, type } from '../theme';

export const PAYMENT_MODES = [
  { key: 'full', label: 'Paid in full' },
  { key: 'part', label: 'Part payment' },
  { key: 'credit', label: 'Not paid yet' },
];

// How the customer paid for a sale; recorded on stock-out only and split out in Reports.
const PAYMENT_METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'transfer', label: 'Transfer' },
];

// Up to this many people who already owe are offered as one-tap picks before searching.
const QUICK_PICKS = 4;

// The amount-paid input saleTotals() expects: '' = paid in full, '0' = nothing paid.
export function amountPaidInputFor(mode, partInput) {
  if (mode === 'full') return '';
  if (mode === 'credit') return '0';
  return partInput;
}

// The payment part of a sale (StockTransactionScreen, stock out): how much was paid now, how,
// and — when there's a balance — who owes it. People who already owe this company are offered
// first, with what they owe, so repeat customers are a tap away and nobody is given more credit
// without seeing their current balance. New customers come from contacts or are typed in.
export default function SalePayment({
  companyId, totals: t, mode, onModeChange, partInput, onPartInputChange,
  paymentMethod, onPaymentMethodChange, customer, onCustomerChange,
}) {
  const [query, setQuery] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cashReceived, setCashReceived] = useState('');

  // Everyone this company has a debt record for (works offline; includes unsynced sales).
  const known = useMemo(() => getDebtors(companyId).customers, [companyId]);
  const owingNow = (phone) => {
    const match = known.find((c) => c.customerPhone === normalizePhone(phone));
    return match && match.balance > 0 ? match.balance : 0;
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    if (!q) return known.filter((c) => c.balance > 0).slice(0, QUICK_PICKS);
    return known
      .filter((c) => c.customerName.toLowerCase().includes(q) || (digits && c.customerPhone.includes(digits)))
      .slice(0, 6);
  }, [known, query]);

  const hasBalance = t.owed > 0;
  const halfTotal = roundMoney(Math.floor(t.total / 2));
  const cash = Number(cashReceived) || 0;
  const change = roundMoney(cash - t.total);

  function pick(c) {
    onCustomerChange({ name: c.customerName, phone: c.customerPhone });
    setQuery('');
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 8 }}>
        <Text style={type.label}>How did they pay?</Text>
        <Segmented accessibilityLabel="How the customer paid" options={PAYMENT_MODES} value={mode} onChange={onModeChange} />
      </View>

      {mode === 'part' && (
        <View style={{ gap: 8 }}>
          <Field
            label="Amount paid now"
            prefix="₦"
            keyboardType="decimal-pad"
            value={partInput}
            onChangeText={onPartInputChange}
            placeholder="0"
            error={t.overpaid ? `That's more than the sale total of ${formatMoney(t.total)}.` : null}
          />
          {t.total > 0 && (
            <View style={styles.chips}>
              <Chip label={`Half · ${formatMoney(halfTotal)}`} onPress={() => onPartInputChange(String(halfTotal))} />
            </View>
          )}
        </View>
      )}

      {mode !== 'credit' && (
        <View style={{ gap: 8 }}>
          <Text style={type.label}>{mode === 'part' ? 'Part payment made by' : 'Paid by'}</Text>
          <Segmented accessibilityLabel="Payment method" options={PAYMENT_METHODS} value={paymentMethod} onChange={onPaymentMethodChange} />
        </View>
      )}

      {mode === 'full' && paymentMethod === 'cash' && (
        <Field
          label="Cash received"
          optional
          prefix="₦"
          keyboardType="decimal-pad"
          value={cashReceived}
          onChangeText={setCashReceived}
          placeholder={formatMoney(t.total).replace('₦', '')}
          hint={
            cash > 0
              ? change >= 0
                ? `Change to give: ${formatMoney(change)}`
                : `${formatMoney(-change)} short of the total. Use Part payment if they'll pay the rest later.`
              : 'Enter what the customer handed over to see their change. Not saved.'
          }
        />
      )}

      {mode !== 'full' && (
        <Card padding={14} gap={6}>
          <KV label="Sale total" value={formatMoney(t.total)} />
          <KV label="Paid now" value={formatMoney(t.paidEntered ? Math.min(t.paid, t.total) : 0)} valueColor={colors.ok} />
          <Divider />
          <KV label="Balance to collect" value={formatMoney(t.owed)} valueColor={hasBalance ? colors.warn : colors.ink} strong />
        </Card>
      )}

      {hasBalance && (
        <View style={{ gap: 10 }}>
          <Text style={type.label}>Who owes the balance?</Text>
          {customer ? (
            <Card padding={14} gap={10}>
              <View style={styles.personRow}>
                <LetterTile label={customer.name} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={type.bodyStrong} numberOfLines={1}>{customer.name}</Text>
                  <Text style={type.caption}>{formatPhone(customer.phone)}</Text>
                </View>
                <Button title="Change" variant="ghost" height={36} onPress={() => onCustomerChange(null)} />
              </View>
              {owingNow(customer.phone) > 0 ? (
                <Note kind="warn" icon="alert">
                  {customer.name} already owes {formatMoney(owingNow(customer.phone))}. After this sale: {formatMoney(owingNow(customer.phone) + t.owed)}.
                </Note>
              ) : (
                <Note>{formatMoney(t.owed)} will be owed by {customer.name}. Follow it up on the Debtors screen.</Note>
              )}
            </Card>
          ) : (
            <>
              {known.length > 0 && <SearchField value={query} onChangeText={setQuery} placeholder="Search customers who owe" />}
              {matches.length > 0 ? (
                <ListCard>
                  {matches.map((c, index) => (
                    <Pressable
                      key={c.customerPhone}
                      accessibilityRole="button"
                      accessibilityLabel={`${c.customerName}, ${c.balance > 0 ? `owes ${formatMoney(c.balance)}` : 'owes nothing'}`}
                      onPress={() => pick(c)}
                      style={({ pressed }) => [styles.pickRow, index > 0 && styles.pickRowBorder, pressed && { backgroundColor: colors.surfaceMuted }]}
                    >
                      <LetterTile label={c.customerName} size={36} />
                      <View style={{ flex: 1, gap: 1 }}>
                        <Text style={type.bodyStrong} numberOfLines={1}>{c.customerName}</Text>
                        <Text style={type.caption}>{formatPhone(c.customerPhone)}</Text>
                      </View>
                      <Text style={[styles.owes, c.balance <= 0 && { color: colors.ink3 }]}>
                        {c.balance > 0 ? `Owes ${formatMoney(c.balance)}` : 'Paid up'}
                      </Text>
                    </Pressable>
                  ))}
                </ListCard>
              ) : query.trim() ? (
                <InlineEmpty>No customer matches "{query.trim()}". Add them as a new customer.</InlineEmpty>
              ) : null}
              <Button title="New customer" variant="secondary" icon="contacts" height={48} onPress={() => setSheetOpen(true)} />
            </>
          )}
        </View>
      )}

      <CustomerSheet
        visible={sheetOpen}
        initial={customer}
        onClose={() => setSheetOpen(false)}
        onSave={(c) => {
          onCustomerChange(c);
          setSheetOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  pickRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  owes: { fontFamily: fonts.semibold, fontSize: 13, color: colors.warn, fontVariant: ['tabular-nums'] },
});
