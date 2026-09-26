import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, Linking } from 'react-native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../context/AuthContext';
import { getCustomerDebt } from '../reports/localReports';
import { saveLocalDebtPayment } from '../db/localDb';
import { runSync } from '../sync/syncEngine';
import { useLocalRefresh } from '../hooks/useLocalRefresh';
import { formatDate, formatMoney, formatNumber } from '../utils/format';
import { formatPhone } from '../utils/phone';
import {
  Text, Screen, NavHeader, Card, SectionTitle, Divider, Button, Field, Segmented, Sheet, Pill, InlineEmpty, KV, Loading,
} from '../components/ui';
import { colors, fonts, type } from '../theme';

const PAYMENT_METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'transfer', label: 'Transfer' },
];
const METHOD_LABEL = { cash: 'Cash', transfer: 'Transfer' };

// One customer's balance: their part-paid/credit sales and every repayment. "Record payment"
// saves money received on this phone first (works offline) and syncs it like any transaction.
// Read-only when a Main Company is viewing a Sub Company's customer.
export default function DebtorDetailScreen({ route }) {
  const { user } = useAuth();
  const { customerPhone } = route.params;
  const companyId = route.params.companyId || user.companyId;
  const editable = companyId === user.companyId;
  const [data, setData] = useState(null);
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [amountError, setAmountError] = useState(null);

  function load() {
    setData(getCustomerDebt(companyId, customerPhone));
  }
  useLocalRefresh(load);

  const customer = data?.customer;
  const name = customer?.customerName || route.params.customerName || 'Customer';
  const balance = customer?.balance ?? 0;

  function openPayment() {
    setAmount(balance > 0 ? String(balance) : '');
    setMethod('cash');
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
      setAmountError(`${name} owes ${formatMoney(balance)}. Enter that or less.`);
      return;
    }
    saveLocalDebtPayment({
      clientPaymentId: uuidv4(),
      companyId,
      customerName: name,
      customerPhone,
      amount: value,
      paymentMethod: method,
      occurredAt: new Date().toISOString(),
      userId: user.id,
    });
    setPaying(false);
    load();
    runSync(user.id);
    const left = Math.max(0, balance - value);
    Alert.alert('Payment recorded', left > 0 ? `${name} now owes ${formatMoney(left)}.` : `${name} has paid everything they owed.`);
  }

  function call() {
    Linking.openURL(`tel:${customerPhone}`).catch(() => Alert.alert("Couldn't start a call", formatPhone(customerPhone)));
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
            <Text style={type.caption}>{balance > 0 ? 'Owes' : balance < 0 ? 'In credit' : 'Balance'}</Text>
            <Text style={[styles.balance, balance <= 0 && { color: colors.ok }]}>
              {balance < 0 ? formatMoney(-balance) : balance > 0 ? formatMoney(balance) : 'Paid up'}
            </Text>
            <Text style={type.small}>{formatPhone(customerPhone)}</Text>
          </View>
          <Divider />
          <KV label="Owed from sales" value={formatMoney(customer?.totalOwed ?? 0)} />
          <KV label="Repaid" value={formatMoney(customer?.totalRepaid ?? 0)} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <Button title="Call" variant="secondary" icon="phone" height={46} style={{ flex: 1 }} onPress={call} />
            {editable && balance > 0 && <Button title="Record payment" icon="wallet" height={46} style={{ flex: 1.4 }} onPress={openPayment} />}
          </View>
        </Card>

        <Card padding={18} gap={10}>
          <SectionTitle title="Payments received" />
          {data.payments.length === 0 ? (
            <InlineEmpty>No repayments yet.</InlineEmpty>
          ) : (
            data.payments.map((p, i) => (
              <View key={String(p.id)}>
                {i > 0 && <Divider />}
                <View style={styles.row}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rowTitle}>{METHOD_LABEL[p.paymentMethod] || 'Cash'}</Text>
                    <Text style={type.caption}>{formatDate(p.occurredAt)}</Text>
                  </View>
                  {p.pending && <Pill kind="warn" icon="sync" label="Not synced" />}
                  <Text style={[styles.amount, { color: colors.ok }]}>{formatMoney(p.amount)}</Text>
                </View>
              </View>
            ))
          )}
        </Card>

        <Card padding={18} gap={10}>
          <SectionTitle title="Sales" />
          {data.sales.length === 0 ? (
            <InlineEmpty>No sales recorded for this customer.</InlineEmpty>
          ) : (
            data.sales.map((s, i) => (
              <View key={String(s.transactionId)}>
                {i > 0 && <Divider />}
                <View style={styles.row}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {s.itemName || 'Item'} × {formatNumber(s.quantity)}
                    </Text>
                    <Text style={type.caption}>
                      {formatDate(s.occurredAt)} · {formatMoney(s.total)} · paid {formatMoney(s.amountPaid)}
                      {s.amountPaid > 0 ? ` (${METHOD_LABEL[s.paymentMethod]})` : ''}
                    </Text>
                  </View>
                  {s.pending && <Pill kind="warn" icon="sync" label="Not synced" />}
                  <Text style={[styles.amount, s.owed > 0 ? { color: colors.danger } : { color: colors.ink3 }]}>
                    {s.owed > 0 ? formatMoney(s.owed) : 'Paid'}
                  </Text>
                </View>
              </View>
            ))
          )}
          <Text style={type.caption}>Amounts on the right are what was left unpaid on each sale. Repayments reduce the total balance.</Text>
        </Card>
      </ScrollView>

      <Sheet
        visible={paying}
        onClose={() => setPaying(false)}
        title="Record payment"
        description={`${name} owes ${formatMoney(balance)}.`}
        footer={
          <>
            <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setPaying(false)} />
            <Button title="Save payment" style={{ flex: 1 }} onPress={handleSavePayment} />
          </>
        }
      >
        <Field label="Amount received" prefix="₦" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} error={amountError} autoFocus />
        <View style={{ gap: 8 }}>
          <Text style={type.label}>Paid by</Text>
          <Segmented accessibilityLabel="Payment method" options={PAYMENT_METHODS} value={method} onChange={setMethod} />
        </View>
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
