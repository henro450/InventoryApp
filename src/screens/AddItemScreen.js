import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { upsertLocalItem } from '../db/localDb';
import { useAuth } from '../context/AuthContext';
import { runSync } from '../sync/syncEngine';

// INV-01/INV-06: item creation now works fully offline. The item is written to the local
// queue immediately with syncStatus = 'pending' and a client-generated id (clientItemId).
// runSync() is then triggered as best-effort; if there's no connectivity it fails silently
// and the item stays queued (SYNC-01/SYNC-05) until the next automatic sync pass, at which
// point the server assigns a real id and the local record is updated (see syncEngine.js).
//
// INV-01: this screen also doubles as the edit form when navigated to with a `route.params.item`
// — SKU stays read-only in that mode since the backend's item-update path never accepts it.
export default function AddItemScreen({ navigation, route }) {
  const { user } = useAuth();
  const editingItem = route?.params?.item ?? null;
  const isEditMode = !!editingItem;

  const [sku, setSku] = useState(editingItem?.sku ?? '');
  const [name, setName] = useState(editingItem?.name ?? '');
  const [category, setCategory] = useState(editingItem?.category ?? '');
  const [unit, setUnit] = useState(editingItem?.unit ?? 'unit');
  const [lowStockThreshold, setLowStockThreshold] = useState(
    editingItem?.lowStockThreshold != null ? String(editingItem.lowStockThreshold) : ''
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    if (!sku || !name) {
      Alert.alert('Missing info', 'SKU and name are required.');
      return;
    }
    setSubmitting(true);

    try {
      if (isEditMode) {
        upsertLocalItem({
          ...editingItem,
          name,
          category: category || null,
          unit,
          lowStockThreshold: lowStockThreshold ? Number(lowStockThreshold) : 0,
          updatedAt: new Date().toISOString(),
          syncStatus: 'pending',
          userId: user.id,
        });
      } else {
        const clientItemId = uuidv4();
        upsertLocalItem({
          id: null,
          localId: clientItemId,
          clientItemId,
          sku,
          name,
          category: category || null,
          unit,
          companyId: user.companyId,
          quantityOnHand: 0,
          lowStockThreshold: lowStockThreshold ? Number(lowStockThreshold) : 0,
          lastPurchasePrice: null,
          updatedAt: new Date().toISOString(),
          syncStatus: 'pending',
          userId: user.id,
        });
      }

      // Best-effort immediate sync; safe to fail silently if offline.
      runSync(user.id);

      navigation.goBack();
    } catch (err) {
      Alert.alert('Could not save item', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>SKU</Text>
      {isEditMode ? (
        <Text style={styles.readOnlyValue}>{sku}</Text>
      ) : (
        <View style={styles.skuRow}>
          <TextInput
            style={[styles.input, styles.skuInput]}
            value={sku}
            onChangeText={setSku}
            placeholder="e.g. SKU-1001"
          />
          <TouchableOpacity
            style={styles.scanButton}
            onPress={() => navigation.navigate('ScanBarcode', { onScanned: (code) => setSku(code) })}
          >
            <Text style={styles.scanButtonText}>Scan</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Widget" />

      <Text style={styles.label}>Category</Text>
      <TextInput style={styles.input} value={category} onChangeText={setCategory} placeholder="Optional" />

      <Text style={styles.label}>Unit</Text>
      <TextInput style={styles.input} value={unit} onChangeText={setUnit} placeholder="e.g. unit, kg, box" />

      <Text style={styles.label}>Low stock threshold</Text>
      <TextInput
        style={styles.input}
        value={lowStockThreshold}
        onChangeText={setLowStockThreshold}
        placeholder="0"
        keyboardType="numeric"
      />

      <TouchableOpacity style={styles.button} onPress={handleSave} disabled={submitting}>
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{isEditMode ? 'Save Changes' : 'Save Item'}</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.note}>Works offline — this item will sync automatically once you're back online.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#fff' },
  label: { fontSize: 13, color: '#666', marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16 },
  skuRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  skuInput: { flex: 1 },
  scanButton: { backgroundColor: '#2f6fed', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16 },
  scanButtonText: { color: '#fff', fontWeight: '600' },
  readOnlyValue: { fontSize: 16, color: '#888', paddingVertical: 12 },
  button: { backgroundColor: '#2f6fed', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  note: { marginTop: 16, fontSize: 12, color: '#999', textAlign: 'center' },
});
