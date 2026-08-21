import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { getLastSyncedAt } from '../db/localDb';

// Configurable threshold-based alerts, in-app only — no push/email delivery is configured
// anywhere in this project, so alerts surface here when the screen is opened rather than
// being pushed while the app is closed. Low-stock reuses the existing per-item
// lowStockThreshold; price anomalies are new (PRC-06 already allows any price with no
// restriction — this only flags outliers for review, never blocks anything).
export default function AlertsScreen({ route }) {
  const { user } = useAuth();
  const companyId = route?.params?.companyId || user.companyId;
  const companyLabel = route?.params?.companyName;
  const isOwnCompany = companyId === user.companyId;

  const lastSynced = getLastSyncedAt();
  const lastSyncedLabel = lastSynced
    ? `Data last synced: ${new Date(lastSynced).toLocaleString()}`
    : 'Not yet synced';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lowStockItems, setLowStockItems] = useState([]);
  const [priceAnomalies, setPriceAnomalies] = useState([]);
  const [thresholdPercent, setThresholdPercent] = useState(20);
  const [thresholdInput, setThresholdInput] = useState('20');
  const [savingThreshold, setSavingThreshold] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAlerts(companyId);
      setLowStockItems(data.lowStockItems);
      setPriceAnomalies(data.priceAnomalies);
      setThresholdPercent(data.thresholdPercent);
      setThresholdInput(String(data.thresholdPercent));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [companyId]);

  async function handleSaveThreshold() {
    const value = Number(thresholdInput);
    if (isNaN(value) || value < 0) {
      Alert.alert('Invalid value', 'Threshold must be a non-negative number.');
      return;
    }
    setSavingThreshold(true);
    try {
      await api.updateAlertSettings({ priceAnomalyThresholdPercent: value });
      await load();
    } catch (err) {
      Alert.alert('Could not save', err.message);
    } finally {
      setSavingThreshold(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      {companyLabel && <Text style={styles.companyLabel}>{companyLabel}</Text>}
      <Text style={styles.syncLabel}>{lastSyncedLabel}</Text>

      {error && (
        <Text style={styles.error}>Alerts require an internet connection to load — {error}</Text>
      )}

      <TouchableOpacity onPress={load} style={styles.refreshButton}>
        <Text style={styles.refreshText}>Refresh</Text>
      </TouchableOpacity>

      {isOwnCompany && (
        <>
          <Text style={styles.sectionTitle}>Price Anomaly Threshold</Text>
          <View style={styles.card}>
            <Text style={styles.filterLabel}>
              Alert when a purchase price differs from the item's previous price by more than:
            </Text>
            <View style={styles.thresholdRow}>
              <TextInput
                style={styles.thresholdInput}
                value={thresholdInput}
                onChangeText={setThresholdInput}
                keyboardType="numeric"
                placeholder="20"
              />
              <Text style={styles.percentSign}>%</Text>
              <TouchableOpacity style={styles.saveButton} onPress={handleSaveThreshold} disabled={savingThreshold}>
                {savingThreshold ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>Low Stock ({lowStockItems.length})</Text>
      {lowStockItems.length === 0 ? (
        <Text style={styles.empty}>No items are currently low on stock.</Text>
      ) : (
        lowStockItems.map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.negative}>
              {item.quantityOnHand} {item.unit} (threshold {item.lowStockThreshold})
            </Text>
          </View>
        ))
      )}

      <Text style={styles.sectionTitle}>Price Anomalies ({priceAnomalies.length})</Text>
      <Text style={styles.empty}>Purchases deviating more than {thresholdPercent}% from the previous price.</Text>
      {priceAnomalies.length === 0 ? (
        <Text style={styles.empty}>No price anomalies detected.</Text>
      ) : (
        priceAnomalies.map((a, idx) => (
          <View key={`${a.itemId}-${a.effectiveDate}-${idx}`} style={styles.marginCard}>
            <Text style={styles.itemName}>{a.itemName || 'Unknown item'}</Text>
            <Row label="Date" value={new Date(a.effectiveDate).toLocaleDateString()} />
            <Row label="Previous price" value={`$${a.previousPrice.toFixed(2)}`} />
            <Row label="New price" value={`$${a.newPrice.toFixed(2)}`} />
            <Row label="Deviation" value={`${a.deviationPercent.toFixed(1)}%`} valueStyle={styles.negative} />
          </View>
        ))
      )}
    </ScrollView>
  );
}

function Row({ label, value, valueStyle }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueStyle]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  companyLabel: { fontSize: 13, color: '#888', marginBottom: 4 },
  syncLabel: { fontSize: 11, color: '#999', marginBottom: 12 },
  error: { color: '#d9534f', marginBottom: 12, fontSize: 13 },
  refreshButton: { alignSelf: 'flex-end', marginBottom: 12 },
  refreshText: { color: '#2f6fed', fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  card: { backgroundColor: '#f4f6fb', borderRadius: 10, padding: 12 },
  filterLabel: { fontSize: 12, color: '#666', marginBottom: 8 },
  thresholdRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thresholdInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, fontSize: 14,
    backgroundColor: '#fff', width: 70,
  },
  percentSign: { fontSize: 14, color: '#666' },
  saveButton: { backgroundColor: '#2f6fed', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, marginLeft: 'auto' },
  saveButtonText: { color: '#fff', fontWeight: '600' },
  empty: { color: '#999', fontSize: 13 },
  itemRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  itemName: { fontSize: 14, fontWeight: '600' },
  marginCard: { backgroundColor: '#f4f6fb', borderRadius: 10, padding: 12, marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { color: '#666', fontSize: 13 },
  rowValue: { fontWeight: '600', fontSize: 13 },
  negative: { color: '#d9534f', fontWeight: '600' },
});
