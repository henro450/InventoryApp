import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { getLastSyncedAt } from '../db/localDb';
import { exportCsv } from '../utils/csvExport';
import { formatMoney, formatNumber, lastSyncedLabel } from '../utils/format';
import { Text, Screen, NavHeader, IconButton, Segmented, Card, BarRow, Banner, Loading } from '../components/ui';
import { colors, fonts, type } from '../theme';

const METRICS = [
  { key: 'margin', label: 'Margin', total: 'Total margin', money: true },
  { key: 'totalSalesRevenue', label: 'Sales', total: 'Total sales', money: true },
  { key: 'totalPurchaseCost', label: 'Purchases', total: 'Total purchases', money: true },
  { key: 'lowStockCount', label: 'Low stock', total: 'Low-stock items', money: false },
];

const COLUMNS = [
  { key: 'itemCount', label: 'Items', money: false, width: 60 },
  { key: 'lowStockCount', label: 'Low', money: false, width: 48 },
  { key: 'totalSalesRevenue', label: 'Sales', money: true, width: 110 },
  { key: 'totalPurchaseCost', label: 'Purchases', money: true, width: 110 },
  { key: 'margin', label: 'Margin', money: true, width: 110 },
];

// RPT-07: side-by-side view of the Main Company and every linked Sub Company, by metric.
// Own row is included and labeled, for full oversight.
export default function CompareSubCompaniesScreen() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [metric, setMetric] = useState('margin');

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.getOversightSummary());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleExport() {
    if (!data || data.companies.length === 0) {
      Alert.alert('Nothing to export', 'There is no comparison data yet.');
      return;
    }
    try {
      await exportCsv('company-comparison.csv', data.companies, [
        { key: 'companyName', label: 'Company' },
        { key: 'itemCount', label: 'Items' },
        { key: 'lowStockCount', label: 'Low Stock' },
        { key: 'totalSalesRevenue', label: 'Sales Revenue' },
        { key: 'totalPurchaseCost', label: 'Purchase Cost' },
        { key: 'margin', label: 'Margin' },
      ]);
    } catch (err) {
      Alert.alert('Export failed', err.message);
    }
  }

  const header = <NavHeader title="Compare companies" right={<IconButton icon="download" label="Export comparison as CSV" onPress={handleExport} />} />;

  if (loading) {
    return (
      <Screen>
        {header}
        <Loading />
      </Screen>
    );
  }

  const m = METRICS.find((x) => x.key === metric);
  const fmt = (v, money) => (money ? formatMoney(v) : formatNumber(v));
  const rows = data ? [...data.companies].sort((a, b) => b[metric] - a[metric]) : [];
  const max = Math.max(0, ...rows.map((r) => r[metric]));

  return (
    <Screen>
      {header}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
      >
        <Text style={type.caption}>{lastSyncedLabel(getLastSyncedAt(user.id))}</Text>
        {error && <Banner kind="error" title="Comparison needs a connection" subtitle={error} actionLabel="Retry" onAction={handleRefresh} />}

        {data && (
          <>
            <Segmented accessibilityLabel="Metric" options={METRICS} value={metric} onChange={setMetric} />

            <Card padding={18} gap={16}>
              <View style={styles.totalRow}>
                <Text style={type.small}>{m.total}</Text>
                <Text style={styles.total}>{fmt(data.totals[metric], m.money)}</Text>
              </View>
              {rows.map((c) => (
                <BarRow
                  key={c.companyId}
                  name={c.companyName}
                  you={c.isMain}
                  value={c[metric]}
                  max={max}
                  label={fmt(c[metric], m.money)}
                  danger={(metric === 'margin' && c.margin < 0) || (metric === 'lowStockCount' && c.lowStockCount > 0)}
                />
              ))}
            </Card>

            <View style={styles.table}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  <View style={[styles.tr, styles.thead]}>
                    <Text style={[styles.th, styles.nameCell]}>Company</Text>
                    {COLUMNS.map((c) => (
                      <Text key={c.key} style={[styles.th, styles.num, { width: c.width }]}>
                        {c.label}
                      </Text>
                    ))}
                  </View>
                  {data.companies.map((c) => (
                    <View key={c.companyId} style={styles.tr}>
                      <Text style={[styles.td, styles.nameCell]} numberOfLines={1}>
                        {c.isMain ? `${c.companyName} (you)` : c.companyName}
                      </Text>
                      {COLUMNS.map((col) => (
                        <Text
                          key={col.key}
                          style={[
                            styles.td,
                            styles.num,
                            { width: col.width },
                            col.key === 'lowStockCount' && c.lowStockCount > 0 && { color: colors.danger },
                            col.key === 'margin' && { color: c.margin >= 0 ? colors.ok : colors.danger },
                          ]}
                        >
                          {fmt(c[col.key], col.money)}
                        </Text>
                      ))}
                    </View>
                  ))}
                  <View style={[styles.tr, styles.tfoot]}>
                    <Text style={[styles.th, styles.nameCell, { color: colors.ink }]}>Total</Text>
                    {COLUMNS.map((col) => (
                      <Text key={col.key} style={[styles.th, styles.num, { width: col.width, color: colors.ink }]}>
                        {fmt(data.totals[col.key], col.money)}
                      </Text>
                    ))}
                  </View>
                </View>
              </ScrollView>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32, gap: 16 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  total: { fontFamily: fonts.display, fontSize: 24, letterSpacing: -0.5 },
  table: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 18, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  thead: { backgroundColor: colors.surfaceMuted, borderBottomColor: colors.line, paddingVertical: 10 },
  tfoot: { backgroundColor: colors.surfaceMuted, borderBottomWidth: 0 },
  th: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink3 },
  td: { fontSize: 13, color: colors.ink, fontVariant: ['tabular-nums'] },
  nameCell: { width: 150 },
  num: { textAlign: 'right' },
});
