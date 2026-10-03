import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Alert } from 'react-native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../context/AuthContext';
import { getSales } from '../reports/localReports';
import { receiptNumber, returnLine } from '../reports/salesMath';
import { saveLocalReturn } from '../db/localDb';
import { runSync } from '../sync/syncEngine';
import { useLocalRefresh } from '../hooks/useLocalRefresh';
import { formatDateTime, formatMoney, formatNumber, quantityStep } from '../utils/format';
import { formatPhone } from '../utils/phone';
import { splitBreakdown } from '../utils/sale';
import { SPLIT_METHODS, breakdownFromInputs, splitProblem } from '../utils/payments';
import { shareReceipt, whatsappReceipt } from '../utils/receipt';
import PaymentMethodPicker from '../components/PaymentMethodPicker';
import {
  Text, Screen, NavHeader, Card, SectionTitle, Divider, Button, Sheet, Pill, KV, Note, Stepper, Loading, EmptyState,
} from '../components/ui';
import { colors, fonts, type } from '../theme';

function methodsText(byMethod) {
  const parts = SPLIT_METHODS.filter((m) => Number(byMethod[m.key]) > 0).map((m) => `${m.label} ${formatMoney(byMethod[m.key])}`);
  return parts.join(' + ') || '—';
}

// One sale: its items, how it was paid, any returns, and its receipt (share to WhatsApp or any
// app). Company admins can void the whole sale or take some items back; stock goes back on the
// shelf and the money is settled as the server does it (returnLine in reports/salesMath.js).
export default function SaleDetailScreen({ route, navigation }) {
  const { user, isCompanyAdmin } = useAuth();
  const { saleKey } = route.params;
  const [sale, setSale] = useState(undefined);
  const [returning, setReturning] = useState(null); // 'void' | 'return' while the sheet is open

  useLocalRefresh(() => setSale(getSales(user.companyId).find((s) => s.key === saleKey) || null));

  const companyName = user.company?.name;
  const canReturn = isCompanyAdmin && sale && sale.lines.some((l) => l.remainingQty > 0);

  if (sale === undefined) {
    return (
      <Screen>
        <NavHeader title="Sale" />
        <Loading />
      </Screen>
    );
  }
  if (sale === null) {
    return (
      <Screen>
        <NavHeader title="Sale" />
        <View style={{ padding: 20 }}>
          <Card>
            <EmptyState icon="receipt" title="Sale not found" body="It may have been removed from this phone." />
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <NavHeader title={`Receipt #${receiptNumber(sale.key)}`} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.pills}>
          {sale.status === 'voided' && <Pill kind="danger" label="Voided" />}
          {sale.status === 'returned' && <Pill kind="warn" label="Items returned" />}
          {sale.pending && <Pill kind="warn" icon="sync" label="Not synced yet" />}
        </View>

        <Card padding={18} gap={10}>
          <Text style={type.caption}>{formatDateTime(sale.occurredAt)}</Text>
          {sale.lines.map((l, i) => (
            <View key={l.clientTransactionId}>
              {i > 0 && <Divider />}
              <View style={styles.line}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.itemName}>{l.itemName}</Text>
                  <Text style={type.caption}>
                    {formatNumber(l.quantity)} {l.unit} × {formatMoney(l.unitPrice)}
                    {l.returnedQty > 0 ? ` · ${formatNumber(l.returnedQty)} returned` : ''}
                  </Text>
                </View>
                <Text style={styles.amount}>{formatMoney(l.total)}</Text>
              </View>
            </View>
          ))}
          <Divider />
          <KV label="Total" value={formatMoney(sale.total)} strong />
          <KV label="Paid" value={formatMoney(sale.paid)} valueColor={colors.ok} />
          <Text style={type.caption}>{methodsText(sale.paidByMethod)}</Text>
          {sale.owed > 0 && <KV label="Still owed on this sale" value={formatMoney(sale.owed)} valueColor={colors.danger} />}
          {sale.customerName && (
            <Text style={type.caption}>
              Customer: {sale.customerName}
              {sale.customerPhone ? ` · ${formatPhone(sale.customerPhone)}` : ''}
            </Text>
          )}
        </Card>

        {sale.returns.length > 0 && (
          <Card padding={18} gap={10}>
            <SectionTitle title={sale.status === 'voided' ? 'Voided' : 'Returned'} />
            {sale.returns.map((r) => (
              <View key={r.clientTransactionId} style={styles.line}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.itemName}>
                    {r.itemName} × {formatNumber(r.quantity)}
                  </Text>
                  <Text style={type.caption}>
                    {formatDateTime(r.occurredAt)} · {r.returnReason === 'void' ? 'sale cancelled' : 'brought back'}
                  </Text>
                </View>
                <Text style={[styles.amount, { color: colors.danger }]}>−{formatMoney(Number(r.quantity) * Number(r.unitPrice))}</Text>
              </View>
            ))}
            <Divider />
            {sale.refunded > 0 && <KV label="Money given back" value={formatMoney(sale.refunded)} />}
            {sale.refunded > 0 && <Text style={type.caption}>{methodsText(sale.refundedByMethod)}</Text>}
            {sale.debtCancelled > 0 && <KV label="Taken off what they owed" value={formatMoney(sale.debtCancelled)} />}
          </Card>
        )}

        <View style={{ gap: 10 }}>
          <Button title="Share receipt" icon="share" variant="secondary" onPress={() => shareReceipt(sale, companyName)} />
          {sale.customerPhone ? (
            <Button title="Send receipt on WhatsApp" icon="phone" variant="secondary" onPress={() => whatsappReceipt(sale, companyName)} />
          ) : null}
        </View>

        {canReturn && (
          <View style={{ gap: 10 }}>
            <SectionTitle title="Something wrong?" />
            <Button title="Customer returned items" icon="refund" variant="secondary" onPress={() => setReturning('return')} />
            <Button title="Void this sale" icon="trash" variant="danger" onPress={() => setReturning('void')} />
            <Text style={type.caption}>Stock goes back on the shelf. Anything they still owed on the items is cancelled first; the rest is money you give back.</Text>
          </View>
        )}
      </ScrollView>

      {returning && (
        <ReturnSheet
          sale={sale}
          mode={returning}
          user={user}
          onClose={() => setReturning(null)}
          onSaved={(message) => {
            setReturning(null);
            setSale(getSales(user.companyId).find((s) => s.key === saleKey) || null);
            runSync(user.id);
            Alert.alert(returning === 'void' ? 'Sale voided' : 'Return recorded', message);
          }}
        />
      )}
    </Screen>
  );
}

// Choose what comes back (everything, for a void) and how any money is handed back.
function ReturnSheet({ sale, mode, user, onClose, onSaved }) {
  const open = sale.lines.filter((l) => l.remainingQty > 0);
  const [qty, setQty] = useState(() => Object.fromEntries(open.map((l) => [l.clientTransactionId, mode === 'void' ? String(l.remainingQty) : '0'])));
  const [method, setMethod] = useState('cash');
  const [split, setSplit] = useState({ cash: '', transfer: '', pos: '' });
  const [saving, setSaving] = useState(false);

  const picked = open
    .map((l) => ({ line: l, quantity: Math.min(Number(qty[l.clientTransactionId]) || 0, l.remainingQty) }))
    .filter((p) => p.quantity > 0)
    .map((p) => ({ ...p, ...returnLine(p.line, p.quantity) }));
  const value = picked.reduce((sum, p) => sum + p.value, 0);
  const refund = Math.round(picked.reduce((sum, p) => sum + p.refund, 0) * 100) / 100;
  const debtCut = Math.round(picked.reduce((sum, p) => sum + p.debtCut, 0) * 100) / 100;
  const tooMany = open.some((l) => (Number(qty[l.clientTransactionId]) || 0) > l.remainingQty);

  function handleSave() {
    if (!picked.length) {
      Alert.alert('Nothing chosen', 'Set how many of each item came back.');
      return;
    }
    const mixed = method === 'mixed' && refund > 0;
    if (mixed && splitProblem(split, refund)) {
      Alert.alert('Check the split', splitProblem(split, refund));
      return;
    }
    const breakdowns = mixed ? splitBreakdown(picked.map((p) => p.refund), breakdownFromInputs(split)) : null;
    const occurredAt = new Date().toISOString();
    const rows = picked.map((p, index) => {
      const hasSplit = mixed && Object.keys(breakdowns[index]).length > 0;
      return {
        clientTransactionId: uuidv4(),
        itemLocalId: p.line.itemLocalId,
        itemServerId: p.line.itemServerId,
        itemClientItemId: p.line.itemClientItemId,
        companyId: user.companyId,
        type: 'return',
        quantity: p.quantity,
        unitPrice: p.line.unitPrice,
        amountPaid: p.refund,
        paymentMethod: hasSplit ? 'mixed' : method === 'mixed' ? 'cash' : method,
        paymentBreakdown: hasSplit ? breakdowns[index] : null,
        customerName: p.line.customerName,
        customerPhone: p.line.customerPhone,
        saleId: p.line.saleId,
        returnOf: p.line.clientTransactionId,
        returnReason: mode === 'void' ? 'void' : 'return',
        occurredAt,
        userId: user.id,
      };
    });
    setSaving(true);
    try {
      saveLocalReturn(rows);
    } catch (err) {
      setSaving(false);
      Alert.alert('Could not save', err.message);
      return;
    }
    const parts = [`${formatMoney(value)} of goods back in stock.`];
    if (refund > 0) parts.push(`Give the customer ${formatMoney(refund)}.`);
    if (debtCut > 0) parts.push(`${formatMoney(debtCut)} taken off what they owed.`);
    onSaved(parts.join(' '));
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title={mode === 'void' ? 'Void this sale?' : 'Items brought back'}
      description={
        mode === 'void'
          ? 'Everything left on this sale goes back into stock and the sale stops counting in your sales.'
          : 'Set how many of each item the customer brought back.'
      }
      footer={
        <>
          <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={onClose} />
          <Button
            title={mode === 'void' ? 'Void sale' : 'Save return'}
            variant={mode === 'void' ? 'danger' : 'primary'}
            style={{ flex: 1 }}
            loading={saving}
            disabled={!picked.length || tooMany}
            onPress={handleSave}
          />
        </>
      }
    >
      {mode === 'return' &&
        open.map((l) => (
          <View key={l.clientTransactionId} style={{ gap: 4 }}>
            <Stepper
              label={`${l.itemName} (up to ${formatNumber(l.remainingQty)} ${l.unit})`}
              value={qty[l.clientTransactionId]}
              onChange={(v) => setQty({ ...qty, [l.clientTransactionId]: v })}
              decimal={l.allowDecimal}
              step={quantityStep(l)}
            />
            {(Number(qty[l.clientTransactionId]) || 0) > l.remainingQty && (
              <Text style={styles.error}>Only {formatNumber(l.remainingQty)} can come back.</Text>
            )}
          </View>
        ))}
      {mode === 'void' && (
        <Card padding={14} gap={6}>
          {open.map((l) => (
            <KV key={l.clientTransactionId} label={`${l.itemName} × ${formatNumber(l.remainingQty)}`} value={formatMoney(l.remainingQty * l.unitPrice)} />
          ))}
        </Card>
      )}

      {picked.length > 0 && (
        <Card padding={14} gap={6}>
          <KV label="Value of goods coming back" value={formatMoney(value)} />
          {debtCut > 0 && <KV label="Taken off what they owe" value={formatMoney(debtCut)} />}
          <KV label="Give back to the customer" value={formatMoney(refund)} strong />
        </Card>
      )}
      {refund > 0 && (
        <PaymentMethodPicker label="Given back by" amount={refund} method={method} onMethodChange={setMethod} split={split} onSplitChange={setSplit} />
      )}
      {picked.length > 0 && refund === 0 && <Note>Nothing to give back: the customer hadn't paid for these items yet.</Note>}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 10, gap: 16, paddingBottom: 40 },
  pills: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  itemName: { fontFamily: fonts.semibold, fontSize: 15 },
  amount: { fontFamily: fonts.semibold, fontSize: 15, fontVariant: ['tabular-nums'] },
  error: { fontSize: 12, color: colors.danger },
});
