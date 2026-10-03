import React, { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, KeyboardAvoidingView } from 'react-native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { useFocusEffect } from '@react-navigation/native';
import { saveLocalStockTransaction, saveLocalSale, getLocalItemByLocalId, getLocalItems } from '../db/localDb';
import { useAuth } from '../context/AuthContext';
import { runSync } from '../sync/syncEngine';
import { formatMoney, formatNumber, quantityStep } from '../utils/format';
import { saleTotals, splitAmountPaid } from '../utils/sale';
import Icon from '../components/Icon';
import SalePayment, { amountPaidInputFor } from '../components/SalePayment';
import AddSaleItemsSheet from '../components/AddSaleItemsSheet';
import SaleLines from '../components/SaleLines';
import { Text, Screen, NavHeader, Card, Divider, Segmented, Stepper, Field, Note, Stat, BottomBar, Button, Banner } from '../components/ui';
import { colors, fonts, type as typo } from '../theme';

const TYPES = [
  { key: 'in', label: 'Stock in' },
  { key: 'out', label: 'Stock out · Sale' },
  { key: 'adjustment', label: 'Adjustment' },
];

// This screen is the client-side counterpart to PRC-07/PRC-08/PRC-09 on the server:
// - Purchase ("Stock In"): price is required, and may be higher or lower than any
//   previous purchase price for the item (PRC-06) — no validation prevents that here.
// - Sale ("Stock Out"): a list of items, starting with the one the screen was opened from.
//   "Add item" opens a sheet to add more, by search or barcode scan. Each line keeps the
//   single-item rules: quantity is checked against that item's stock, and a blank price uses
//   the item's last purchase price, labelled on the line (PRC-08). Problems show on the line
//   and Save stays off until every line is valid.
// - Payment (Stock Out, components/SalePayment.js): paid in full, part payment or not paid yet,
//   for the whole sale. A balance must be owed by a customer: someone who already owes (shown
//   with their current balance), or a new one from contacts or typed in. Balances are followed
//   up on the Debtors screen.
// - Saving a sale writes one stock-out per line, all sharing a new saleId, the customer and the
//   payment method, so sync and Reports keep working per item. The amount paid is split across
//   the lines in proportion to each line's total (utils/sale.js), so Debtors adds up.
// Everything is written to the local SQLite queue immediately and marked 'pending' — it does
// NOT require connectivity (SYNC-01/INV-06). runSync() is triggered afterward as a best-effort
// attempt; if it fails, the records stay queued for the next automatic sync pass.
export default function StockTransactionScreen({ route, navigation }) {
  const { user, subscriptionBlocked, isCompanyAdmin } = useAuth();
  // The route param is a snapshot from when the list was loaded; always show (and save
  // against) the item's current row on this device, which a background sync may have updated.
  const [item, setItem] = useState(route.params.item);
  const [type, setType] = useState('out'); // default to recording a sale
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');

  // Sale (stock out) state: the items in the sale and the payment for the whole sale.
  const [lines, setLines] = useState(() => [newLine(route.params.item)]);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentMode, setPaymentMode] = useState('full'); // 'full' | 'part' | 'credit'
  const [partPaidInput, setPartPaidInput] = useState('');
  const amountPaidInput = amountPaidInputFor(paymentMode, partPaidInput);
  const [customer, setCustomer] = useState(null); // { name, phone } who owes the balance
  const [pickerOpen, setPickerOpen] = useState(false);
  const [catalog, setCatalog] = useState([]);

  useFocusEffect(
    useCallback(() => {
      const current = getLocalItemByLocalId(route.params.item.localId);
      if (current) setItem(current);
      setLines((ls) => ls.map((l) => ({ ...l, item: getLocalItemByLocalId(l.item.localId) || l.item })));
    }, [route.params.item.localId])
  );

  const defaultedPriceValue = item.lastPurchasePrice;
  const hasDefault = defaultedPriceValue !== null && defaultedPriceValue !== undefined;

  function alertBlocked() {
    Alert.alert(
      'Subscription ended',
      isCompanyAdmin
        ? 'Stock in and sales are paused until the subscription is paid. Open Subscription to pay and upload proof of payment.'
        : 'Stock in and sales are paused until your company renews its subscription. Please tell your company admin.',
      isCompanyAdmin
        ? [{ text: 'Later', style: 'cancel' }, { text: 'Subscription', onPress: () => navigation.navigate('Subscription') }]
        : [{ text: 'OK' }]
    );
  }

  function alertOutOfStock(current) {
    Alert.alert('Out of stock', `${current.name} has no stock available, so it can't be sold. Record a stock-in first.`);
  }

  function alertNotEnough(current, available) {
    Alert.alert(
      'Not enough stock',
      `Only ${formatNumber(available)} ${current.unit} of ${current.name} available. Reduce the quantity sold.`
    );
  }

  // --- Stock in / adjustment: one item ---------------------------------------------------
  async function handleSave() {
    if (subscriptionBlocked && type === 'in') {
      alertBlocked();
      return;
    }
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      Alert.alert('Invalid quantity', 'Please enter a quantity greater than zero.');
      return;
    }
    if (type === 'in' && !unitPrice) {
      Alert.alert('Price required', 'Please enter the purchase price for this stock-in.');
      return;
    }

    const current = getLocalItemByLocalId(item.localId) || item;
    setItem(current);
    if (!current.allowDecimal && !Number.isInteger(qty)) {
      Alert.alert('Whole numbers only', `${current.name} is counted in whole ${current.unit}. Turn on "Allow decimal quantities" on the item to record ${formatNumber(qty)}.`);
      return;
    }

    const localTransaction = {
      clientTransactionId: uuidv4(),
      itemLocalId: current.localId,
      itemServerId: current.id, // may be null if the item itself hasn't synced yet
      itemClientItemId: current.clientItemId,
      companyId: user.companyId,
      type,
      quantity: qty,
      unitPrice: type === 'in' ? Number(unitPrice) : null,
      paymentMethod: null,
      amountPaid: null,
      customerName: null,
      customerPhone: null,
      priceWasDefaulted: false,
      occurredAt: new Date().toISOString(),
      userId: user.id,
    };

    // Applied to the local balance right away, regardless of connectivity.
    try {
      saveLocalStockTransaction(localTransaction);
    } catch (err) {
      Alert.alert('Could not save', err.message);
      return;
    }

    // Best-effort immediate sync; safe to fail silently offline (SYNC-01/SYNC-05).
    runSync(user.id);
    navigation.goBack();
  }

  // --- Stock out: a sale of one or more items ---------------------------------------------
  function openPicker() {
    setCatalog(getLocalItems(user.companyId));
    setPickerOpen(true);
  }

  function toggleLine(picked) {
    setLines((ls) => (ls.some((l) => l.item.localId === picked.localId) ? ls.filter((l) => l.item.localId !== picked.localId) : [...ls, newLine(picked)]));
  }

  // Scan from the picker: a match is added to the sale (or, if it's already in the sale, its
  // quantity goes up by one step — 1, or 0.5 for items that allow decimals).
  function scanIntoSale() {
    setPickerOpen(false);
    navigation.navigate('ScanBarcode', {
      onScanned: (code) => {
        const normalized = code.trim().toLowerCase();
        const match = getLocalItems(user.companyId).find((i) => i.sku.trim().toLowerCase() === normalized);
        if (!match) {
          Alert.alert('Not found', `No item in this list has SKU "${code}".`);
          return;
        }
        if ((Number(match.quantityOnHand) || 0) <= 0) {
          alertOutOfStock(match);
          return;
        }
        setLines((ls) => {
          const existing = ls.find((l) => l.item.localId === match.localId);
          if (!existing) return [...ls, newLine(match)];
          const next = Math.round(((Number(existing.quantity) || 0) + quantityStep(match)) * 100) / 100;
          return ls.map((l) => (l === existing ? { ...l, quantity: String(next) } : l));
        });
      },
    });
  }

  function updateLine(localId, changes) {
    setLines((ls) => ls.map((l) => (l.item.localId === localId ? { ...l, ...changes } : l)));
  }

  function removeLine(localId) {
    setLines((ls) => ls.filter((l) => l.item.localId !== localId));
  }

  async function handleSaveSale() {
    if (subscriptionBlocked) {
      alertBlocked();
      return;
    }
    // Check against every item's current row, which a background sync may have changed.
    const fresh = lines.map((l) => ({ ...l, item: getLocalItemByLocalId(l.item.localId) || l.item }));
    setLines(fresh);
    const t = saleTotals(fresh, amountPaidInput);
    if (!fresh.length) return;
    const firstError = t.calcs.findIndex((c) => c.error);
    if (firstError !== -1) {
      Alert.alert(fresh[firstError].item.name, t.calcs[firstError].error);
      return;
    }
    if (paymentMode === 'part' && !t.paidEntered) {
      Alert.alert('How much was paid?', 'Enter the amount paid now, or choose "Not paid yet" if nothing was paid.');
      return;
    }
    if (t.paidEntered && t.paid < 0) {
      Alert.alert('Invalid amount', 'Amount paid must be zero or more.');
      return;
    }
    if (t.overpaid) {
      Alert.alert('Amount too high', `The sale total is ${formatMoney(t.total)}. Amount paid can't be more than that.`);
      return;
    }
    if (t.owed > 0 && !customer) {
      Alert.alert('Who owes the balance?', `${formatMoney(t.owed)} will be owed. Choose the customer under "Who owes the balance?" before saving.`);
      return;
    }

    // Part payment: split what was paid across the lines by line total. Paid in full = null.
    const shares = t.owed > 0 ? splitAmountPaid(t.calcs.map((c) => c.total), t.paid) : null;
    const saleId = fresh.length > 1 ? uuidv4() : null; // single-item sales stay as before
    const occurredAt = new Date().toISOString();
    const transactions = fresh.map((l, index) => ({
      clientTransactionId: uuidv4(),
      itemLocalId: l.item.localId,
      itemServerId: l.item.id, // may be null if the item itself hasn't synced yet
      itemClientItemId: l.item.clientItemId,
      companyId: user.companyId,
      type: 'out',
      quantity: t.calcs[index].qty,
      unitPrice: t.calcs[index].price,
      priceWasDefaulted: t.calcs[index].priceWasDefaulted,
      paymentMethod,
      amountPaid: shares ? shares[index] : null,
      // Only a sale with a balance is tied to a customer (Debtors follows those up).
      customerName: t.owed > 0 ? customer.name : null,
      customerPhone: t.owed > 0 ? customer.phone : null,
      saleId,
      occurredAt,
      userId: user.id,
    }));

    // All lines and their stock changes commit together, or none do. The stock check is
    // repeated inside the write against each item's current row.
    try {
      saveLocalSale(transactions);
    } catch (err) {
      const line = fresh.find((l) => l.item.localId === err.itemLocalId);
      const latest = (line && getLocalItemByLocalId(line.item.localId)) || line?.item;
      setLines((ls) => ls.map((l) => ({ ...l, item: getLocalItemByLocalId(l.item.localId) || l.item })));
      if (latest && err.code === 'OUT_OF_STOCK') alertOutOfStock(latest);
      else if (latest && err.code === 'INSUFFICIENT_STOCK') alertNotEnough(latest, err.available);
      else Alert.alert('Could not save', err.message);
      return;
    }

    runSync(user.id);
    navigation.goBack();
  }

  const subscriptionBanner = subscriptionBlocked && (
    <Banner
      kind="error"
      icon="alert"
      title="Subscription ended"
      subtitle={
        isCompanyAdmin
          ? 'Stock in and sales are paused until the subscription is paid. Adjustments still work.'
          : 'Stock in and sales are paused until your company renews. Adjustments still work.'
      }
      actionLabel={isCompanyAdmin ? 'Pay' : undefined}
      onAction={() => navigation.navigate('Subscription')}
    />
  );
  const typePicker = <Segmented accessibilityLabel="Transaction type" options={TYPES} value={type} onChange={setType} />;

  if (type === 'out') {
    const t = saleTotals(lines, amountPaidInput);
    const saveTitle = t.errors
      ? `Fix ${t.errors} item${t.errors > 1 ? 's' : ''} to save`
      : t.owed > 0
        ? `Save sale · ${formatMoney(t.owed)} owed`
        : 'Save sale';
    return (
      <Screen>
        <NavHeader title="Record transaction" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            {subscriptionBanner}
            {typePicker}

            <SaleLines lines={lines} calcs={t.calcs} onChange={updateLine} onRemove={removeLine} onAdd={openPicker} />

            <SalePayment
              companyId={user.companyId}
              totals={t}
              mode={paymentMode}
              onModeChange={setPaymentMode}
              partInput={partPaidInput}
              onPartInputChange={setPartPaidInput}
              paymentMethod={paymentMethod}
              onPaymentMethodChange={setPaymentMethod}
              customer={customer}
              onCustomerChange={setCustomer}
            />
          </ScrollView>

          <BottomBar>
            <View style={styles.summary}>
              <View style={{ gap: 2 }}>
                <Text style={typo.caption}>
                  {lines.length} item{lines.length === 1 ? '' : 's'}
                </Text>
                <Text style={styles.summaryUnits}>{formatNumber(t.units)} units</Text>
              </View>
              <View style={{ gap: 2, alignItems: 'flex-end' }}>
                <Text style={typo.caption}>Sale total</Text>
                <Text style={styles.summaryTotal}>{formatMoney(t.total)}</Text>
              </View>
            </View>
            <Button title={saveTitle} onPress={handleSaveSale} disabled={subscriptionBlocked || !lines.length || t.errors > 0 || t.overpaid} />
            <Text style={[typo.caption, { textAlign: 'center' }]}>Saved on this device first, then synced automatically.</Text>
          </BottomBar>
        </KeyboardAvoidingView>
        <AddSaleItemsSheet
          visible={pickerOpen}
          items={catalog}
          selectedIds={new Set(lines.map((l) => l.item.localId))}
          onToggle={toggleLine}
          onScan={scanIntoSale}
          onClose={() => setPickerOpen(false)}
        />
      </Screen>
    );
  }

  // Live preview of what saving will do, mirroring the quantity logic above.
  const qty = Number(quantity) || 0;
  const previewQty = type === 'in' ? item.quantityOnHand + qty : quantity === '' ? item.quantityOnHand : qty;
  const previewPrice = type === 'in' && unitPrice.trim() !== '' ? Number(unitPrice) : null;
  const previewTotal = previewPrice != null && qty > 0 ? previewPrice * qty : null;

  return (
    <Screen>
      <NavHeader title="Record transaction" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {subscriptionBanner}
          <Card padding={16}>
            <View style={styles.itemRow}>
              <View style={styles.itemIcon}>
                <Icon name="box" size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={typo.caption}>
                  <Text style={typo.mono}>{item.sku}</Text> · {item.category || 'Uncategorized'}
                </Text>
              </View>
            </View>
            <Divider />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Stat label="On hand" value={`${formatNumber(item.quantityOnHand)} ${item.unit}`} />
              <Stat label="Last purchase price" value={hasDefault ? formatMoney(defaultedPriceValue) : '—'} />
            </View>
          </Card>

          {typePicker}

          <Stepper
            big
            label={type === 'adjustment' ? 'New counted quantity' : 'Quantity received'}
            value={quantity}
            onChange={setQuantity}
            decimal={!!item.allowDecimal}
            step={quantityStep(item)}
          />

          {type === 'in' && (
            <Field
              label="Purchase price per unit"
              prefix="₦"
              keyboardType="decimal-pad"
              value={unitPrice}
              onChangeText={setUnitPrice}
              placeholder="0.00"
            />
          )}

          {type === 'adjustment' && (
            <Note>An adjustment sets the stock to the number you counted. The difference is kept for the discrepancy report.</Note>
          )}

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Stat label="Stock after" value={`${formatNumber(previewQty)} ${item.unit}`} />
            {previewTotal != null && <Stat align="right" label="Purchase total" value={formatMoney(previewTotal)} />}
          </View>
        </ScrollView>

        <BottomBar>
          <Button title="Save transaction" onPress={handleSave} disabled={subscriptionBlocked && type === 'in'} />
          <Text style={[typo.caption, { textAlign: 'center' }]}>Saved on this device first, then synced automatically.</Text>
        </BottomBar>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function newLine(item) {
  return { item, quantity: '1', unitPrice: '' };
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 10, gap: 18 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  itemName: { fontFamily: fonts.semibold, fontSize: 16 },
  summary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  summaryUnits: { fontFamily: fonts.semibold, fontSize: 16, fontVariant: ['tabular-nums'] },
  summaryTotal: { fontFamily: fonts.display, fontSize: 24, lineHeight: 28, letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
});
