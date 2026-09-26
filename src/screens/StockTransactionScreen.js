import React, { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { useFocusEffect } from '@react-navigation/native';
import { saveLocalStockTransaction, getLocalItemByLocalId } from '../db/localDb';
import { useAuth } from '../context/AuthContext';
import { runSync } from '../sync/syncEngine';
import { formatMoney, formatNumber } from '../utils/format';
import { formatPhone } from '../utils/phone';
import Icon from '../components/Icon';
import CustomerSheet from '../components/CustomerSheet';
import { Text, Screen, NavHeader, Card, Divider, Segmented, Stepper, Field, Note, Stat, BottomBar, Button, IconButton, Banner } from '../components/ui';
import { colors, fonts, type as typo } from '../theme';

const TYPES = [
  { key: 'in', label: 'Stock in' },
  { key: 'out', label: 'Stock out · Sale' },
  { key: 'adjustment', label: 'Adjustment' },
];

// How the customer paid for a sale; recorded on stock-out only and split out in Reports.
const PAYMENT_METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'transfer', label: 'Transfer' },
];

// This screen is the client-side counterpart to PRC-07/PRC-08/PRC-09 on the server:
// - Purchase ("Stock In"): price is required, and may be higher or lower than any
//   previous purchase price for the item (PRC-06) — no validation prevents that here.
// - Sale ("Stock Out"): price field is optional. If left blank, we show the item's last
//   known purchase price as the value that will be used, and label it clearly so the
//   user can review or override before saving (PRC-08).
// - Part payment (Stock Out): "Amount paid" is optional — blank means paid in full. Anything
//   less (including 0, fully on credit) leaves a balance owed by a customer, chosen from the
//   phone's contacts or typed in with the contact button beside the field. Balances are
//   followed up on the Debtors screen.
// Both transaction types are written to the local SQLite queue immediately and marked
// 'pending' — they do NOT require connectivity (SYNC-01/INV-06). runSync() is triggered
// afterward as a best-effort attempt; if it fails, the record stays queued for the next
// automatic sync pass.
export default function StockTransactionScreen({ route, navigation }) {
  const { user, subscriptionBlocked, isCompanyAdmin } = useAuth();
  // The route param is a snapshot from when the list was loaded; always show (and save
  // against) the item's current row on this device, which a background sync may have updated.
  const [item, setItem] = useState(route.params.item);
  useFocusEffect(
    useCallback(() => {
      const current = getLocalItemByLocalId(route.params.item.localId);
      if (current) setItem(current);
    }, [route.params.item.localId])
  );
  const [type, setType] = useState('out'); // default to recording a sale
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [amountPaidInput, setAmountPaidInput] = useState('');
  const [customer, setCustomer] = useState(null); // { name, phone } who owes the balance
  const [customerSheetOpen, setCustomerSheetOpen] = useState(false);

  const willDefaultPrice = type === 'out' && unitPrice.trim() === '';
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

  async function handleSave() {
    if (subscriptionBlocked && (type === 'in' || type === 'out')) {
      alertBlocked();
      return;
    }
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      Alert.alert('Invalid quantity', 'Please enter a quantity greater than zero.');
      return;
    }

    const current = getLocalItemByLocalId(item.localId) || item;
    setItem(current);

    if (type === 'out' && current.quantityOnHand <= 0) {
      alertOutOfStock(current);
      return;
    }

    if (type === 'out' && qty > current.quantityOnHand) {
      alertNotEnough(current, current.quantityOnHand);
      return;
    }

    if (type === 'in' && !unitPrice) {
      Alert.alert('Price required', 'Please enter the purchase price for this stock-in.');
      return;
    }

    const currentDefault = current.lastPurchasePrice;
    if (type === 'out' && unitPrice.trim() === '' && (currentDefault === null || currentDefault === undefined)) {
      Alert.alert('No price available', 'This item has no recorded purchase price to default to. Please enter a sale price.');
      return;
    }

    const priceWasDefaulted = type === 'out' && unitPrice.trim() === '';
    const resolvedPrice = priceWasDefaulted ? currentDefault : Number(unitPrice);

    // Part payment: blank = paid in full. Anything owed needs a customer to follow up with.
    let amountPaid = null;
    if (type === 'out' && amountPaidInput.trim() !== '') {
      const saleTotal = Math.round(qty * resolvedPrice * 100) / 100;
      const paid = Number(amountPaidInput);
      if (!Number.isFinite(paid) || paid < 0) {
        Alert.alert('Invalid amount', 'Amount paid must be zero or more.');
        return;
      }
      if (paid > saleTotal + 0.005) {
        Alert.alert('Amount too high', `The sale total is ${formatMoney(saleTotal)}. Amount paid can't be more than that.`);
        return;
      }
      if (paid < saleTotal - 0.005) {
        if (!customer) {
          Alert.alert('Who is paying?', `${formatMoney(saleTotal - paid)} will be owed. Choose the customer from your contacts or enter their name and number.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Add customer', onPress: () => setCustomerSheetOpen(true) },
          ]);
          return;
        }
        amountPaid = paid;
      }
    }

    const localTransaction = {
      clientTransactionId: uuidv4(),
      itemLocalId: current.localId,
      itemServerId: current.id, // may be null if the item itself hasn't synced yet
      itemClientItemId: current.clientItemId,
      companyId: user.companyId,
      type,
      quantity: qty,
      unitPrice: resolvedPrice,
      paymentMethod: type === 'out' ? paymentMethod : null,
      amountPaid,
      customerName: type === 'out' && customer ? customer.name : null,
      customerPhone: type === 'out' && customer ? customer.phone : null,
      priceWasDefaulted,
      occurredAt: new Date().toISOString(),
      userId: user.id,
    };

    // Applied to the local balance right away, regardless of connectivity (same quantity rules
    // as the server). The stock check is repeated inside the write against the current row.
    try {
      saveLocalStockTransaction(localTransaction);
    } catch (err) {
      const latest = getLocalItemByLocalId(current.localId) || current;
      setItem(latest);
      if (err.code === 'OUT_OF_STOCK') alertOutOfStock(latest);
      else if (err.code === 'INSUFFICIENT_STOCK') alertNotEnough(latest, err.available);
      else Alert.alert('Could not save', err.message);
      return;
    }

    // Best-effort immediate sync; safe to fail silently offline (SYNC-01/SYNC-05).
    runSync(user.id);

    navigation.goBack();
  }

  // Live preview of what saving will do, mirroring the quantity logic above.
  const qty = Number(quantity) || 0;
  const previewQty =
    type === 'in' ? item.quantityOnHand + qty : type === 'out' ? item.quantityOnHand - qty : quantity === '' ? item.quantityOnHand : qty;
  const previewPrice = type === 'adjustment' ? null : unitPrice.trim() !== '' ? Number(unitPrice) : type === 'out' && hasDefault ? defaultedPriceValue : null;
  const totalLabel = type === 'in' ? 'Purchase total' : 'Sale total';
  const previewTotal = previewPrice != null && qty > 0 ? previewPrice * qty : null;
  const paidEntered = type === 'out' && amountPaidInput.trim() !== '' && Number.isFinite(Number(amountPaidInput));
  const previewOwed = paidEntered && previewTotal != null ? Math.max(0, previewTotal - Number(amountPaidInput)) : 0;
  const nothingPaid = paidEntered && Number(amountPaidInput) === 0;

  return (
    <Screen>
      <NavHeader title="Record transaction" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {subscriptionBlocked && (
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
          )}
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

          <Segmented accessibilityLabel="Transaction type" options={TYPES} value={type} onChange={setType} />

          <Stepper
            big
            label={type === 'adjustment' ? 'New counted quantity' : type === 'in' ? 'Quantity received' : 'Quantity sold'}
            value={quantity}
            onChange={setQuantity}
          />

          {type !== 'adjustment' && (
            <View style={{ gap: 8 }}>
              <Field
                label={type === 'in' ? 'Purchase price per unit' : 'Sale price per unit'}
                optional={type === 'out'}
                prefix="₦"
                keyboardType="decimal-pad"
                value={unitPrice}
                onChangeText={setUnitPrice}
                placeholder={type === 'out' && hasDefault ? `Leave blank to use ${formatMoney(defaultedPriceValue)}` : '0.00'}
              />
              {willDefaultPrice && hasDefault && (
                <Note>
                  No price entered, so this sale will be recorded at{' '}
                  <Text style={{ fontFamily: fonts.semibold, color: colors.primaryInk }}>{formatMoney(defaultedPriceValue)}</Text>, the item's last
                  recorded purchase price.
                </Note>
              )}
            </View>
          )}

          {type === 'out' && (
            <View style={{ gap: 8 }}>
              <Field
                label="Amount paid"
                optional
                prefix="₦"
                keyboardType="decimal-pad"
                value={amountPaidInput}
                onChangeText={setAmountPaidInput}
                placeholder={previewTotal != null ? `Full amount (${formatMoney(previewTotal)})` : 'Full amount'}
                hint="Leave blank if paid in full. Enter less for a part payment, or 0 if nothing was paid."
                trailing={
                  <IconButton
                    icon="contacts"
                    label={customer ? `Customer: ${customer.name}. Change` : 'Choose who is paying'}
                    variant={customer ? 'soft' : 'ghost'}
                    size={40}
                    onPress={() => setCustomerSheetOpen(true)}
                  />
                }
              />
              {customer && (
                <View style={styles.customerRow}>
                  <Icon name="user" size={16} color={colors.ink2} />
                  <Text style={styles.customerText} numberOfLines={1}>
                    {customer.name} · {formatPhone(customer.phone)}
                  </Text>
                  <Button title="Remove" variant="ghost" height={32} onPress={() => setCustomer(null)} />
                </View>
              )}
              {previewOwed > 0 && (
                <Note kind={customer ? 'info' : 'warn'} icon={customer ? 'info' : 'alert'}>
                  {formatMoney(previewOwed)} will be owed{customer ? ` by ${customer.name}` : '. Tap the contact button to choose who is paying.'}
                </Note>
              )}
            </View>
          )}

          {type === 'out' && !nothingPaid && (
            <View style={{ gap: 8 }}>
              <Text style={typo.label}>{paidEntered && previewOwed > 0 ? 'Part payment made by' : 'Payment'}</Text>
              <Segmented accessibilityLabel="Payment method" options={PAYMENT_METHODS} value={paymentMethod} onChange={setPaymentMethod} />
            </View>
          )}

          {type === 'adjustment' && (
            <Note>An adjustment sets the stock to the number you counted. The difference is kept for the discrepancy report.</Note>
          )}

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Stat label={type === 'out' ? 'Stock after sale' : 'Stock after'} value={`${formatNumber(previewQty)} ${item.unit}`} />
            {previewTotal != null && <Stat align="right" label={totalLabel} value={formatMoney(previewTotal)} />}
          </View>
          {type === 'out' && item.quantityOnHand <= 0 ? (
            <Note kind="error" icon="alert">This item is out of stock and can't be sold. Record a stock-in first.</Note>
          ) : (
            previewQty < 0 && <Note kind="error" icon="alert">Not enough stock. Only {formatNumber(item.quantityOnHand)} {item.unit} available.</Note>
          )}
        </ScrollView>

        <BottomBar>
          <Button title="Save transaction" onPress={handleSave} disabled={subscriptionBlocked && (type === 'in' || type === 'out')} />
          <Text style={[typo.caption, { textAlign: 'center' }]}>Saved on this device first, then synced automatically.</Text>
        </BottomBar>
      </KeyboardAvoidingView>
      <CustomerSheet
        visible={customerSheetOpen}
        initial={customer}
        onClose={() => setCustomerSheetOpen(false)}
        onSave={(c) => {
          setCustomer(c);
          setCustomerSheetOpen(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 10, gap: 18 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  itemName: { fontFamily: fonts.semibold, fontSize: 16 },
  customerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 4 },
  customerText: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.ink2 },
});
