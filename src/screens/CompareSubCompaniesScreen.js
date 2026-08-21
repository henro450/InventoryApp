import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { api } from '../api/client';
import { getLastSyncedAt } from '../db/localDb';

// RPT-07: side-by-side comparison across every company this Main Company can see (own +
// linked Sub Companies), by metric. Own row is included and labeled, for full oversight
// context rather than a Sub-Company-only peer comparison.
export default function CompareSubCompaniesScreen() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setData(await api.getOversightSummary());
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const lastSynced = getLastSyncedAt();
  const lastSyncedLabel = lastSynced
    ? `Data last synced: ${new Date(lastSynced).toLocaleString()}`
    : 'Not yet synced';

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.syncText}>{lastSyncedLabel}</Text>

      {error && <Text style={styles.error}>Comparison requires connectivity — {error}</Text>}

      {data && (
        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.cell, styles.nameCell, styles.headerText]}>Company</Text>
            <Text style={[styles.cell, styles.headerText]}>Items</Text>
            <Text style={[styles.cell, styles.headerText]}>Low</Text>
            <Text style={[styles.cell, styles.headerText]}>Sales</Text>
            <Text style={[styles.cell, styles.headerText]}>Purch.</Text>
            <Text style={[styles.cell, styles.headerText]}>Margin</Text>
          </View>
          {data.companies.map((c) => (
            <View key={c.companyId} style={styles.row}>
              <Text style={[styles.cell, styles.nameCell]}>
                {c.isMain ? `(Main) ${c.companyName}` : c.companyName}
              </Text>
              <Text style={styles.cell}>{c.itemCount}</Text>
              <Text style={[styles.cell, c.lowStockCount > 0 && styles.negative]}>{c.lowStockCount}</Text>
              <Text style={styles.cell}>{formatMoney(c.totalSalesRevenue)}</Text>
              <Text style={styles.cell}>{formatMoney(c.totalPurchaseCost)}</Text>
              <Text style={[styles.cell, c.margin >= 0 ? styles.positive : styles.negative]}>
                {formatMoney(c.margin)}
              </Text>
            </View>
          ))}
          <View style={[styles.row, styles.totalsRow]}>
            <Text style={[styles.cell, styles.nameCell, styles.headerText]}>Total</Text>
            <Text style={[styles.cell, styles.headerText]}>{data.totals.itemCount}</Text>
            <Text style={[styles.cell, styles.headerText]}>{data.totals.lowStockCount}</Text>
            <Text style={[styles.cell, styles.headerText]}>{formatMoney(data.totals.totalSalesRevenue)}</Text>
            <Text style={[styles.cell, styles.headerText]}>{formatMoney(data.totals.totalPurchaseCost)}</Text>
            <Text style={[styles.cell, styles.headerText]}>{formatMoney(data.totals.margin)}</Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function formatMoney(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  syncText: { fontSize: 12, color: '#888', marginBottom: 12 },
  error: { color: '#d9534f', marginBottom: 12, fontSize: 13 },
  table: { borderWidth: 1, borderColor: '#eee', borderRadius: 10, overflow: 'hidden' },
  row: {
    flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 6,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  headerRow: { backgroundColor: '#f4f6fb' },
  totalsRow: { backgroundColor: '#f4f6fb', borderBottomWidth: 0 },
  headerText: { fontWeight: '700' },
  cell: { flex: 1, fontSize: 12, textAlign: 'right' },
  nameCell: { flex: 2, textAlign: 'left', fontWeight: '600' },
  positive: { color: '#2e9c4c' },
  negative: { color: '#d9534f' },
});
