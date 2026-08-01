import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../context/AuthContext';
import { insertLocalTransaction, upsertLocalItem } from '../db/localDb';
import { runSync } from '../sync/syncEngine';

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

  async function handleSave() {
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      Alert.alert('Invalid quantity', 'Please enter a quantity greater than zero.');
      return;
    }

    if (type === 'in' && !unitPrice) {
      Alert.alert('Price required', 'Please enter the purchase price for this stock-in.');
      return;
    }

    if (type === 'out' && unitPrice.trim() === '' && (defaultedPriceValue === null || defaultedPriceValue === undefined)) {
      Alert.alert(
        'No price available',
        'This item has no recorded purchase price to default to. Please enter a sale price.'
      );
      return;
    }

    const priceWasDefaulted = type === 'out' && unitPrice.trim() === '';
    const resolvedPrice = priceWasDefaulted ? defaultedPriceValue : Number(unitPrice);

    insertLocalTransaction({
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
    });

    // Reflect the change locally right away so the UI feels instant, regardless of
    // connectivity (matches server-side quantity logic in routes/transactions.js).
    const updatedQty =
      type === 'in' ? item.quantityOnHand + qty
      : type === 'out' ? item.quantityOnHand - qty
      : qty; // adjustment sets an absolute value

    upsertLocalItem({
      ...item,
      quantityOnHand: updatedQty,
      lastPurchasePrice: type === 'in' ? resolvedPrice : item.lastPurchasePrice,
      userId: user.id,
    });

    // Best-effort immediate sync; safe to fail silently offline (SYNC-01/SYNC-05).
    runSync(user.id);

    navigation.goBack();
  }

  return (
    <View style={styles.container}>
      <Text style={styles.itemTitle}>{item.name}</Text>
      <Text style={styles.itemMeta}>Current stock: {item.quantityOnHand} {item.unit}</Text>

      <View style={styles.typeRow}>
        {['in', 'out', 'adjustment'].map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.typeButton, type === t && styles.typeButtonActive]}
            onPress={() => setType(t)}
          >
            <Text style={[styles.typeButtonText, type === t && styles.typeButtonTextActive]}>
              {t === 'in' ? 'Stock In' : t === 'out' ? 'Stock Out (Sale)' : 'Adjustment'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>{type === 'adjustment' ? 'New counted quantity' : 'Quantity'}</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        value={quantity}
        onChangeText={setQuantity}
        placeholder="0"
      />

      {type !== 'adjustment' && (
        <>
          <Text style={styles.label}>
            {type === 'in' ? 'Purchase price (per unit)' : 'Sale price (per unit) — optional'}
          </Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={unitPrice}
            onChangeText={setUnitPrice}
            placeholder={
              type === 'out' && defaultedPriceValue != null
                ? `Leave blank to use last price: ${defaultedPriceValue}`
                : '0.00'
            }
          />
          {willDefaultPrice && defaultedPriceValue != null && (
            <Text style={styles.defaultNote}>
              No price entered — this sale will be recorded at {defaultedPriceValue} (the item's last recorded price).
            </Text>
          )}
        </>
      )}

      <TouchableOpacity style={styles.button} onPress={handleSave}>
        <Text style={styles.buttonText}>Save Transaction</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#fff' },
  itemTitle: { fontSize: 20, fontWeight: '700' },
  itemMeta: { fontSize: 14, color: '#777', marginTop: 4, marginBottom: 20 },
  typeRow: { flexDirection: 'row', marginBottom: 20 },
  typeButton: {
    flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10,
    alignItems: 'center', marginRight: 6,
  },
  typeButtonActive: { backgroundColor: '#2f6fed', borderColor: '#2f6fed' },
  typeButtonText: { fontSize: 12, color: '#333' },
  typeButtonTextActive: { color: '#fff', fontWeight: '600' },
  label: { fontSize: 13, color: '#666', marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16 },
  defaultNote: { fontSize: 12, color: '#2f6fed', marginTop: 6 },
  button: { backgroundColor: '#2f6fed', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 28 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
