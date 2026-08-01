import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

// RPT-01, RPT-02, RPT-03: stock on hand, sales vs purchases, and per-item margin.
// RPT-05 (export to PDF/Excel/CSV) is not implemented in this scaffold — flagged in the
// project README as a follow-on task.
export default function ReportsScreen({ route }) {
  const { user } = useAuth();
  const companyId = route?.params?.companyId || user.companyId;
  const companyLabel = route?.params?.companyName;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stockOnHand, setStockOnHand] = useState([]);
  const [salesVsPurchases, setSalesVsPurchases] = useState(null);
  const [marginByItem, setMarginByItem] = useState([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [stock, svp, margin] = await Promise.all([
        api.getStockOnHandReport(companyId),
        api.getSalesVsPurchases(companyId),
        api.getMarginByItem(companyId),
      ]);
      setStockOnHand(stock.items);
      setSalesVsPurchases(svp);
      setMarginByItem(margin.report);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [companyId]);

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

      {error && (
        <Text style={styles.error}>
          Reports require an internet connection to reach the latest data — {error}
        </Text>
      )}

      <TouchableOpacity onPress={load} style={styles.refreshButton}>
        <Text style={styles.refreshText}>Refresh</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Sales vs. Purchases</Text>
      {salesVsPurchases ? (
        <View style={styles.card}>
          <Row label="Total purchase cost" value={formatMoney(salesVsPurchases.totalPurchaseCost)} />
          <Row label="Total sales revenue" value={formatMoney(salesVsPurchases.totalSalesRevenue)} />
          <Row
            label="Margin"
            value={formatMoney(salesVsPurchases.margin)}
            valueStyle={salesVsPurchases.margin >= 0 ? styles.positive : styles.negative}
          />
          <Row label="Purchases recorded" value={String(salesVsPurchases.purchaseCount)} />
          <Row label="Sales recorded" value={String(salesVsPurchases.saleCount)} />
        </View>
      ) : (
        <Text style={styles.empty}>No data available.</Text>
      )}

      <Text style={styles.sectionTitle}>Stock on Hand</Text>
      {stockOnHand.length === 0 ? (
        <Text style={styles.empty}>No items yet.</Text>
      ) : (
        stockOnHand.map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text
              style={[styles.itemQty, item.quantityOnHand <= item.lowStockThreshold && styles.negative]}
            >
              {item.quantityOnHand} {item.unit}
            </Text>
          </View>
        ))
      )}

      <Text style={styles.sectionTitle}>Margin by Item</Text>
      {marginByItem.length === 0 ? (
        <Text style={styles.empty}>No sales recorded yet.</Text>
      ) : (
        marginByItem.map((row) => (
          <View key={row.itemId} style={styles.marginCard}>
            <Text style={styles.itemName}>{row.name}</Text>
            <Row label="Units sold" value={String(row.totalUnitsSold)} />
            <Row label="Revenue" value={formatMoney(row.totalRevenue)} />
            <Row label="Est. cost" value={formatMoney(row.estimatedCost)} />
            <Row
              label="Est. margin"
              value={formatMoney(row.estimatedMargin)}
              valueStyle={row.estimatedMargin >= 0 ? styles.positive : styles.negative}
            />
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

function formatMoney(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  companyLabel: { fontSize: 13, color: '#888', marginBottom: 8 },
  error: { color: '#d9534f', marginBottom: 12, fontSize: 13 },
  refreshButton: { alignSelf: 'flex-end', marginBottom: 12 },
  refreshText: { color: '#2f6fed', fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  card: { backgroundColor: '#f4f6fb', borderRadius: 10, padding: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { color: '#666', fontSize: 13 },
  rowValue: { fontWeight: '600', fontSize: 13 },
  positive: { color: '#2e9c4c' },
  negative: { color: '#d9534f' },
  empty: { color: '#999', fontSize: 13 },
  itemRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  itemName: { fontSize: 14, fontWeight: '600' },
  itemQty: { fontSize: 14 },
  marginCard: {
    backgroundColor: '#f4f6fb', borderRadius: 10, padding: 12, marginBottom: 10,
  },
});
