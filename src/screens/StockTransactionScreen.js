import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { saveLocalStockTransaction } from '../db/localDb';
import { useAuth } from '../context/AuthContext';
import { runSync } from '../sync/syncEngine';
import { formatMoney, formatNumber } from '../utils/format';
import Icon from '../components/Icon';
import { Text, Screen, NavHeader, Card, Divider, Segmented, Stepper, Field, Note, Stat, BottomBar, Button } from '../components/ui';
import { colors, fonts, type as typo } from '../theme';

const TYPES = [
  { key: 'in', label: 'Stock in' },
  { key: 'out', label: 'Stock out · Sale' },
  { key: 'adjustment', label: 'Adjustment' },
];

// This screen is the client-side counterpart to PRC-07/PRC-08/PRC-09 on the server:
// - Purchase ("Stock In"): price is required, and may be higher or lower than any
//   previous purchase price for the item (PRC-06) — no validation prevents that here.
// - Sale ("Stock Out"): price field is optional. If left blank, we show the item's last
//   known purchase price as the value that will be used, and label it clearly so the
//   user can review or override before saving (PRC-08).
// Both transaction types are written to the local SQLite queue immediately and marked
// 'pending' — they do NOT require connectivity (SYNC-01/INV-06). runSync() is triggered
// afterward as a best-effort attempt; if it fails, the record stays queued for the next
// automatic sync pass.
export default function StockTransactionScreen({ route, navigation }) {
  const { item } = route.params;
  const { user } = useAuth();
  const [type, setType] = useState('out'); // default to recording a sale
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');

  const willDefaultPrice = type === 'out' && unitPrice.trim() === '';
  const defaultedPriceValue = item.lastPurchasePrice;
  const hasDefault = defaultedPriceValue !== null && defaultedPriceValue !== undefined;

  async function handleSave() {
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      Alert.alert('Invalid quantity', 'Please enter a quantity greater than zero.');
      return;
    }

    if (type === 'out' && item.quantityOnHand <= 0) {
      Alert.alert('Out of stock', `${item.name} has no stock available, so it can't be sold. Record a stock-in first.`);
      return;
    }

    if (type === 'out' && qty > item.quantityOnHand) {
      Alert.alert(
        'Not enough stock',
        `Only ${formatNumber(item.quantityOnHand)} ${item.unit} of ${item.name} available. Reduce the quantity sold.`
      );
      return;
    }

    if (type === 'in' && !unitPrice) {
      Alert.alert('Price required', 'Please enter the purchase price for this stock-in.');
      return;
    }

    if (type === 'out' && unitPrice.trim() === '' && !hasDefault) {
      Alert.alert('No price available', 'This item has no recorded purchase price to default to. Please enter a sale price.');
      return;
    }

    const priceWasDefaulted = type === 'out' && unitPrice.trim() === '';
    const resolvedPrice = priceWasDefaulted ? defaultedPriceValue : Number(unitPrice);

    const localTransaction = {
      clientTransactionId: uuidv4(),
      itemLocalId: item.localId,
      itemServerId: item.id, // may be null if the item itself hasn't synced yet
      itemClientItemId: item.clientItemId,
      companyId: user.companyId,
      type,
      quantity: qty,
      unitPrice: resolvedPrice,
      priceWasDefaulted,
      occurredAt: new Date().toISOString(),
      userId: user.id,
    };

    // Reflect the change locally right away so the UI feels instant, regardless of
    // connectivity (matches server-side quantity logic in routes/transactions.js).
    const updatedQty =
      type === 'in' ? item.quantityOnHand + qty
      : type === 'out' ? item.quantityOnHand - qty
      : qty; // adjustment sets an absolute value

    const updatedItem = {
      ...item,
      quantityOnHand: updatedQty,
      lastPurchasePrice: type === 'in' ? resolvedPrice : item.lastPurchasePrice,
      userId: user.id,
    };
    saveLocalStockTransaction(localTransaction, updatedItem);

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

  return (
    <Screen>
      <NavHeader title="Record transaction" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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

          {type === 'adjustment' && (
            <Note>An adjustment sets the stock to the number you counted. The difference is kept for the discrepancy report.</Note>
          )}

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Stat label={type === 'out' ? 'Stock after sale' : 'Stock after'} value={`${formatNumber(previewQty)} ${item.unit}`} />
            {previewPrice != null && qty > 0 && <Stat align="right" label={totalLabel} value={formatMoney(previewPrice * qty)} />}
          </View>
          {type === 'out' && item.quantityOnHand <= 0 ? (
            <Note kind="error" icon="alert">This item is out of stock and can't be sold. Record a stock-in first.</Note>
          ) : (
            previewQty < 0 && <Note kind="error" icon="alert">Not enough stock. Only {formatNumber(item.quantityOnHand)} {item.unit} available.</Note>
          )}
        </ScrollView>

        <BottomBar>
          <Button title="Save transaction" onPress={handleSave} />
          <Text style={[typo.caption, { textAlign: 'center' }]}>Saved on this device first, then synced automatically.</Text>
        </BottomBar>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 10, gap: 18 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  itemName: { fontFamily: fonts.semibold, fontSize: 16 },
});
