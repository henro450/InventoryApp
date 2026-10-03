import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, Linking } from 'react-native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../context/AuthContext';
import { getSupplierLedger } from '../reports/localReports';
import { saveLocalSupplierPayment } from '../db/localDb';
import { runSync } from '../sync/syncEngine';
import { useLocalRefresh } from '../hooks/useLocalRefresh';
import { formatDate, formatYmd, formatMoney, formatNumber } from '../utils/format';
import { formatPhone } from '../utils/phone';
import { PAYMENT_METHODS as ALL_METHODS, methodLabel } from '../utils/payments';
import {
  Text, Screen, NavHeader, Card, SectionTitle, Divider, Button, Field, Segmented, Sheet, Pill, InlineEmpty, KV, Loading,
} from '../components/ui';
import { colors, fonts, type } from '../theme';

const PAYMENT_METHODS = ALL_METHODS.filter((m) => m.key !== 'mixed');

// One supplier: what was bought from them, what is still owed, and the payments made since.
// "Record payment" (company admins) saves on this phone first and syncs like a debt repayment.
export default function SupplierDetailScreen({ route }) {
  const { user, isCompanyAdmin } = useAuth();
  const { supplierPhone } = route.params;
  const companyId = route.params.companyId || user.companyId;
  const editable = companyId === user.companyId && isCompanyAdmin;
  const [data, setData] = useState(null);
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('transfer');
  const [amountError, setAmountError] = useState(null);

  function load() {
    setData(getSupplierLedger(companyId, supplierPhone));
  }
  useLocalRefresh(load);

  const supplier = data?.supplier;
  const name = supplier?.supplierName || route.params.supplierName || 'Supplier';
  const balance = supplier?.balance ?? 0;

  function openPayment() {
    setAmount(balance > 0 ? String(balance) : '');
    setMethod('transfer');
    setAmountError(null);
    setPaying(true);
  }

  function handleSavePayment() {
    const value = Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(value) || value <= 0) {
      setAmountError('Enter an amount greater than zero.');
      return;
    }
    if (value > balance + 0.005) {
      setAmountError(`You owe ${name} ${formatMoney(balance)}. Enter that or less.`);
      return;
    }
    saveLocalSupplierPayment({
      clientPaymentId: uuidv4(),
      companyId,
      supplierName: name,
      supplierPhone,
      amount: value,
      paymentMethod: method,
      occurredAt: new Date().toISOString(),
      userId: user.id,
    });
    setPaying(false);
    load();
    runSync(user.id);
    const left = Math.max(0, balance - value);
    Alert.alert('Payment recorded', left > 0 ? `You now owe ${name} ${formatMoney(left)}.` : `You have paid ${name} everything you owed.`);
  }

  function call() {
    Linking.openURL(`tel:${supplierPhone}`).catch(() => Alert.alert("Couldn't start a call", formatPhone(supplierPhone)));
  }

  if (!data) {
    return (
      <Screen>
        <NavHeader title={name} />
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen>
      <NavHeader title={name} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card padding={18} gap={12}>
          <View style={{ gap: 4 }}>
            <Text style={type.caption}>{balance > 0 ? 'You owe' : balance < 0 ? 'Overpaid' : 'Balance'}</Text>
            <Text style={[styles.balance, balance <= 0 && { color: colors.ok }]}>
              {balance < 0 ? formatMoney(-balance) : balance > 0 ? formatMoney(balance) : 'Paid up'}
            </Text>
            <Text style={type.small}>{formatPhone(supplierPhone)}</Text>
          </View>
          <Divider />
          <KV label="Bought from them" value={formatMoney(supplier?.totalBought ?? 0)} />
          <KV label="Left unpaid on purchases" value={formatMoney(supplier?.totalOwed ?? 0)} />
          <KV label="Paid since" value={formatMoney(supplier?.totalPaid ?? 0)} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <Button title="Call" variant="secondary" icon="phone" height={46} style={{ flex: 1 }} onPress={call} />
            {editable && balance > 0 && <Button title="Record payment" icon="wallet" height={46} style={{ flex: 1.4 }} onPress={openPayment} />}
          </View>
        </Card>

        <Card padding={18} gap={10}>
          <SectionTitle title="Payments made" />
          {data.payments.length === 0 ? (
            <InlineEmpty>No payments recorded since the purchases.</InlineEmpty>
          ) : (
            data.payments.map((p, i) => (
              <View key={String(p.id)}>
                {i > 0 && <Divider />}
                <View style={styles.row}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rowTitle}>{methodLabel(p.paymentMethod)}</Text>
                    <Text style={type.caption}>{formatDate(p.occurredAt)}</Text>
                  </View>
                  {p.pending && <Pill kind="warn" icon="sync" label="Not synced" />}
                  <Text style={styles.amount}>{formatMoney(p.amount)}</Text>
                </View>
              </View>
            ))
          )}
        </Card>

        <Card padding={18} gap={10}>
          <SectionTitle title="Purchases" />
          {data.purchases.length === 0 ? (
            <InlineEmpty>No purchases recorded from this supplier.</InlineEmpty>
          ) : (
            data.purchases.map((p, i) => (
              <View key={String(p.transactionId)}>
                {i > 0 && <Divider />}
                <View style={styles.row}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rowTitle} numberOfLines={2}>
                      {p.itemName || 'Item'} × {formatNumber(p.quantity)}
                      {p.unit ? ` ${p.unit}` : ''}
                    </Text>
                    <Text style={type.caption}>
                      {formatDate(p.occurredAt)} · {formatMoney(p.total)} · paid {formatMoney(p.amountPaid)}
                    </Text>
                    {p.expiryDate && <Text style={type.caption}>Expires {formatYmd(p.expiryDate)}</Text>}
                  </View>
                  {p.pending && <Pill kind="warn" icon="sync" label="Not synced" />}
                  <Text style={[styles.amount, p.owed > 0 ? { color: colors.danger } : { color: colors.ink3 }]}>
                    {p.owed > 0 ? formatMoney(p.owed) : 'Paid'}
                  </Text>
                </View>
              </View>
            ))
          )}
          <Text style={type.caption}>Amounts on the right are what was left unpaid on each purchase. Payments reduce the total balance.</Text>
        </Card>
      </ScrollView>

      <Sheet
        visible={paying}
        onClose={() => setPaying(false)}
        title="Pay supplier"
        description={`You owe ${name} ${formatMoney(balance)}.`}
        footer={
          <>
            <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setPaying(false)} />
            <Button title="Save payment" style={{ flex: 1 }} onPress={handleSavePayment} />
          </>
        }
      >
        <Field label="Amount paid" prefix="₦" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} error={amountError} autoFocus />
        <View style={{ gap: 8 }}>
          <Text style={type.label}>Paid by</Text>
          <Segmented accessibilityLabel="Payment method" options={PAYMENT_METHODS} value={method} onChange={setMethod} />
        </View>
        <Text style={type.caption}>This shows in Money out as money spent on stock.</Text>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 16 },
  balance: { fontFamily: fonts.display, fontSize: 32, letterSpacing: -0.8, color: colors.danger },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  rowTitle: { fontFamily: fonts.semibold, fontSize: 14 },
  amount: { fontFamily: fonts.semibold, fontSize: 14, fontVariant: ['tabular-nums'] },
});
