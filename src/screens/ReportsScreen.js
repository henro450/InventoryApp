import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { getLastSyncedAt } from '../db/localDb';
import { exportCsv } from '../utils/csvExport';

// RPT-01, RPT-02, RPT-03, RPT-04, PRC-04: stock on hand (item/category filter), sales vs
// purchases (date range filter), margin by item/category/Sub Company, per-transaction margin
// (historical PriceHistory cost basis), discrepancy report (expected vs counted stock), and
// price trend for a selected item. RPT-05 export is CSV only — no PDF/Excel, which would need
// new heavyweight dependencies this project has otherwise avoided throughout.
export default function ReportsScreen({ route }) {
  const { user, isMainCompany } = useAuth();
  const companyId = route?.params?.companyId || user.companyId;
  const companyLabel = route?.params?.companyName;
  const lastSynced = getLastSyncedAt();
  const lastSyncedLabel = lastSynced
    ? `Data last synced: ${new Date(lastSynced).toLocaleString()}`
    : 'Not yet synced';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stockOnHand, setStockOnHand] = useState([]);
  const [salesVsPurchases, setSalesVsPurchases] = useState(null);
  const [marginByItem, setMarginByItem] = useState([]);
  const [transactionMargins, setTransactionMargins] = useState([]);
  const [marginByCompany, setMarginByCompany] = useState(null);
  const [discrepancies, setDiscrepancies] = useState([]);
  const [priceTrend, setPriceTrend] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [generatingSnapshot, setGeneratingSnapshot] = useState(false);

  const [items, setItems] = useState([]);
  const [categoryInput, setCategoryInput] = useState('');
  const [itemSearchText, setItemSearchText] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [dateError, setDateError] = useState(null);
  const [appliedFilters, setAppliedFilters] = useState({ category: '', itemId: null, from: '', to: '' });

  async function load(filters = appliedFilters) {
    setLoading(true);
    setError(null);
    try {
      const calls = [
        api.getStockOnHandReport(companyId, { category: filters.category, itemId: filters.itemId }),
        api.getSalesVsPurchases(companyId, { from: filters.from, to: filters.to }),
        api.getMarginByItem(companyId),
        api.getItems(companyId),
        api.getTransactionMargins(companyId, { itemId: filters.itemId, from: filters.from, to: filters.to, limit: 50 }),
        api.getDiscrepancies(companyId, { from: filters.from, to: filters.to }),
        filters.itemId ? api.getPriceTrend(companyId, { itemId: filters.itemId }) : Promise.resolve({ history: [] }),
        isMainCompany ? api.getOversightSummary({ from: filters.from, to: filters.to }) : Promise.resolve(null),
        api.getReportSnapshots(companyId, { limit: 20 }),
      ];
      const [stock, svp, margin, itemsResp, txMargins, discrepancyResp, trendResp, summaryResp, snapshotResp] = await Promise.all(calls);
      setStockOnHand(stock.items);
      setSalesVsPurchases(svp);
      setMarginByItem(margin.report);
      setItems(itemsResp.items);
      setTransactionMargins(txMargins.transactions);
      setDiscrepancies(discrepancyResp.discrepancies);
      setPriceTrend(trendResp.history);
      setMarginByCompany(summaryResp ? summaryResp.companies : null);
      setSnapshots(snapshotResp.snapshots);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [companyId]);

  function handleApplyFilters() {
    if (fromInput && isNaN(Date.parse(fromInput))) {
      setDateError('Invalid "from" date — use YYYY-MM-DD');
      return;
    }
    if (toInput && isNaN(Date.parse(toInput))) {
      setDateError('Invalid "to" date — use YYYY-MM-DD');
      return;
    }
    setDateError(null);
    const next = {
      category: categoryInput.trim(),
      itemId: selectedItem?.id || null,
      from: fromInput.trim(),
      to: toInput.trim(),
    };
    setAppliedFilters(next);
    load(next);
  }

  function handleClearSelectedItem() {
    setSelectedItem(null);
    setItemSearchText('');
  }

  async function handleExport(filename, rows, columns) {
    if (rows.length === 0) {
      Alert.alert('Nothing to export', 'There is no data in this report to export yet.');
      return;
    }
    try {
      await exportCsv(filename, rows, columns);
    } catch (err) {
      Alert.alert('Export failed', err.message);
    }
  }

  async function handleGenerateSnapshot() {
    setGeneratingSnapshot(true);
    try {
      await api.generateReportSnapshot(companyId);
      const { snapshots: fresh } = await api.getReportSnapshots(companyId, { limit: 20 });
      setSnapshots(fresh);
    } catch (err) {
      Alert.alert('Could not generate report', err.message);
    } finally {
      setGeneratingSnapshot(false);
    }
  }

  const itemMatches =
    itemSearchText && !selectedItem
      ? items.filter((i) => {
          const q = itemSearchText.toLowerCase();
          return i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q);
        })
      : [];

  // RPT-03: category breakdown derived client-side from the per-item report — no separate
  // backend endpoint needed, this is just a regroup of data already fetched.
  const marginByCategory = Object.values(
    marginByItem.reduce((acc, row) => {
      const key = row.category || 'Uncategorized';
      if (!acc[key]) acc[key] = { category: key, totalRevenue: 0, estimatedCost: 0, estimatedMargin: 0 };
      acc[key].totalRevenue += row.totalRevenue;
      acc[key].estimatedCost += row.estimatedCost;
      acc[key].estimatedMargin += row.estimatedMargin;
      return acc;
    }, {})
  );

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
      {companyLabel && <Text style={styles.syncLabel}>{lastSyncedLabel}</Text>}

      {error && (
        <Text style={styles.error}>
          Reports require an internet connection to reach the latest data — {error}
        </Text>
      )}

      <TouchableOpacity onPress={() => load()} style={styles.refreshButton}>
        <Text style={styles.refreshText}>Refresh</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Filters</Text>
      <View style={styles.card}>
        <Text style={styles.filterLabel}>Category</Text>
        <TextInput
          style={styles.input}
          value={categoryInput}
          onChangeText={setCategoryInput}
          placeholder="e.g. Hardware"
        />

        <Text style={styles.filterLabel}>Item</Text>
        {selectedItem ? (
          <View style={styles.filterChip}>
            <Text style={styles.filterChipText}>{selectedItem.name}</Text>
            <TouchableOpacity onPress={handleClearSelectedItem}>
              <Text style={styles.filterChipClear}>×</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TextInput
              style={styles.input}
              value={itemSearchText}
              onChangeText={setItemSearchText}
              placeholder="Search by name or SKU"
            />
            {itemMatches.length > 0 &&
              itemMatches.slice(0, 5).map((i) => (
                <TouchableOpacity
                  key={i.id}
                  style={styles.itemMatchRow}
                  onPress={() => {
                    setSelectedItem(i);
                    setItemSearchText('');
                  }}
                >
                  <Text style={styles.itemMatchText}>{i.name} · {i.sku}</Text>
                </TouchableOpacity>
              ))}
          </>
        )}

        <Text style={styles.filterLabel}>From (YYYY-MM-DD)</Text>
        <TextInput style={styles.input} value={fromInput} onChangeText={setFromInput} placeholder="Optional" />

        <Text style={styles.filterLabel}>To (YYYY-MM-DD)</Text>
        <TextInput style={styles.input} value={toInput} onChangeText={setToInput} placeholder="Optional" />

        {dateError && <Text style={styles.error}>{dateError}</Text>}

        <TouchableOpacity style={styles.applyButton} onPress={handleApplyFilters}>
          <Text style={styles.applyButtonText}>Apply Filters</Text>
        </TouchableOpacity>
      </View>

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

      <SectionHeader
        title="Stock on Hand"
        onExport={() =>
          handleExport(
            'stock-on-hand.csv',
            stockOnHand,
            [
              { key: 'sku', label: 'SKU' },
              { key: 'name', label: 'Name' },
              { key: 'category', label: 'Category' },
              { key: 'quantityOnHand', label: 'Quantity On Hand' },
              { key: 'unit', label: 'Unit' },
              { key: 'lowStockThreshold', label: 'Low Stock Threshold' },
            ]
          )
        }
      />
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

      <SectionHeader
        title="Margin by Item"
        onExport={() =>
          handleExport(
            'margin-by-item.csv',
            marginByItem,
            [
              { key: 'name', label: 'Item' },
              { key: 'category', label: 'Category' },
              { key: 'totalUnitsSold', label: 'Units Sold' },
              { key: 'totalRevenue', label: 'Revenue' },
              { key: 'estimatedCost', label: 'Estimated Cost' },
              { key: 'estimatedMargin', label: 'Estimated Margin' },
            ]
          )
        }
      />
      {marginByItem.length === 0 ? (
        <Text style={styles.empty}>No sales recorded yet.</Text>
      ) : (
        marginByItem.map((row) => (
          <View key={row.itemId} style={styles.marginCard}>
            <Text style={styles.itemName}>{row.name}</Text>
            <Row label="Category" value={row.category || 'Uncategorized'} />
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

      <SectionHeader
        title="Margin by Category"
        onExport={() =>
          handleExport(
            'margin-by-category.csv',
            marginByCategory,
            [
              { key: 'category', label: 'Category' },
              { key: 'totalRevenue', label: 'Revenue' },
              { key: 'estimatedCost', label: 'Estimated Cost' },
              { key: 'estimatedMargin', label: 'Estimated Margin' },
            ]
          )
        }
      />
      {marginByCategory.length === 0 ? (
        <Text style={styles.empty}>No sales recorded yet.</Text>
      ) : (
        marginByCategory.map((row) => (
          <View key={row.category} style={styles.marginCard}>
            <Text style={styles.itemName}>{row.category}</Text>
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

      {isMainCompany && (
        <>
          <Text style={styles.sectionTitle}>Margin by Sub Company</Text>
          {!marginByCompany ? (
            <Text style={styles.empty}>Could not load company breakdown.</Text>
          ) : (
            marginByCompany.map((row) => (
              <View key={row.companyId} style={styles.marginCard}>
                <Text style={styles.itemName}>{row.isMain ? `(Main) ${row.companyName}` : row.companyName}</Text>
                <Row label="Revenue" value={formatMoney(row.totalSalesRevenue)} />
                <Row label="Purchase cost" value={formatMoney(row.totalPurchaseCost)} />
                <Row
                  label="Margin"
                  value={formatMoney(row.margin)}
                  valueStyle={row.margin >= 0 ? styles.positive : styles.negative}
                />
              </View>
            ))
          )}
        </>
      )}

      <SectionHeader
        title="Per-Transaction Margin (Recent Sales)"
        onExport={() =>
          handleExport(
            'transaction-margins.csv',
            transactionMargins,
            [
              { key: 'itemName', label: 'Item' },
              { key: 'sku', label: 'SKU' },
              { key: 'occurredAt', label: 'Date' },
              { key: 'quantity', label: 'Quantity' },
              { key: 'unitPrice', label: 'Sale Price' },
              { key: 'estimatedCost', label: 'Estimated Cost' },
              { key: 'estimatedMargin', label: 'Estimated Margin' },
            ]
          )
        }
      />
      <Text style={styles.empty}>Showing up to the 50 most recent matching sales.</Text>
      {transactionMargins.length === 0 ? (
        <Text style={styles.empty}>No sales recorded yet.</Text>
      ) : (
        transactionMargins.map((tx) => (
          <View key={tx.transactionId} style={styles.marginCard}>
            <Text style={styles.itemName}>{tx.itemName || 'Unknown item'}</Text>
            <Row label="Date" value={new Date(tx.occurredAt).toLocaleDateString()} />
            <Row label="Quantity" value={String(tx.quantity)} />
            <Row label="Sale price" value={formatMoney(tx.unitPrice)} />
            <Row
              label="Cost"
              value={tx.costAvailable ? formatMoney(tx.estimatedCost) : 'Cost data unavailable'}
              valueStyle={!tx.costAvailable && styles.muted}
            />
            <Row
              label="Margin"
              value={tx.costAvailable ? formatMoney(tx.estimatedMargin) : '—'}
              valueStyle={
                tx.costAvailable ? (tx.estimatedMargin >= 0 ? styles.positive : styles.negative) : styles.muted
              }
            />
          </View>
        ))
      )}

      <SectionHeader
        title="Discrepancy Report"
        onExport={() =>
          handleExport(
            'discrepancies.csv',
            discrepancies,
            [
              { key: 'itemName', label: 'Item' },
              { key: 'sku', label: 'SKU' },
              { key: 'occurredAt', label: 'Date' },
              { key: 'expected', label: 'Expected (System)' },
              { key: 'counted', label: 'Counted (Physical)' },
              { key: 'discrepancy', label: 'Discrepancy' },
            ]
          )
        }
      />
      <Text style={styles.empty}>Expected (system) vs. counted (physical) stock for every manual adjustment.</Text>
      {discrepancies.length === 0 ? (
        <Text style={styles.empty}>No stock adjustments recorded yet.</Text>
      ) : (
        discrepancies.map((d) => (
          <View key={d.transactionId} style={styles.marginCard}>
            <Text style={styles.itemName}>{d.itemName || 'Unknown item'}</Text>
            <Row label="Date" value={new Date(d.occurredAt).toLocaleDateString()} />
            <Row label="Expected" value={d.discrepancyKnown ? String(d.expected) : 'Unknown'} />
            <Row label="Counted" value={String(d.counted)} />
            <Row
              label="Discrepancy"
              value={d.discrepancyKnown ? String(d.discrepancy) : '—'}
              valueStyle={
                !d.discrepancyKnown ? styles.muted : d.discrepancy === 0 ? null : d.discrepancy > 0 ? styles.positive : styles.negative
              }
            />
          </View>
        ))
      )}

      <SectionHeader
        title="Price Trend"
        onExport={() =>
          handleExport(
            `price-trend-${selectedItem ? selectedItem.sku : 'item'}.csv`,
            priceTrend,
            [
              { key: 'effectiveDate', label: 'Date' },
              { key: 'priceType', label: 'Type' },
              { key: 'amount', label: 'Amount' },
            ]
          )
        }
      />
      {!selectedItem ? (
        <Text style={styles.empty}>Select an item above (in Filters) to view its price trend.</Text>
      ) : priceTrend.length === 0 ? (
        <Text style={styles.empty}>No price history recorded yet for {selectedItem.name}.</Text>
      ) : (
        priceTrend.map((h) => (
          <View key={h.id} style={styles.itemRow}>
            <Text style={styles.itemName}>
              {new Date(h.effectiveDate).toLocaleDateString()} · {h.priceType}
            </Text>
            <Text style={styles.itemQty}>{formatMoney(h.amount)}</Text>
          </View>
        ))
      )}

      <Text style={styles.sectionTitle}>Scheduled Reports</Text>
      <Text style={styles.empty}>
        A summary is generated automatically once a day. "Delivery" is in-app only — no
        email/push service is configured, so a fresh snapshot appears here next time you open
        the app rather than being sent to you.
      </Text>
      <TouchableOpacity style={styles.applyButton} onPress={handleGenerateSnapshot} disabled={generatingSnapshot}>
        {generatingSnapshot ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.applyButtonText}>Generate Now</Text>
        )}
      </TouchableOpacity>
      {snapshots.length === 0 ? (
        <Text style={styles.empty}>No automatic reports generated yet.</Text>
      ) : (
        snapshots.map((s) => (
          <View key={s.id} style={styles.marginCard}>
            <Text style={styles.itemName}>{new Date(s.generatedAt).toLocaleString()}</Text>
            <Row label="Items" value={String(s.itemCount)} />
            <Row label="Low stock" value={String(s.lowStockCount)} />
            <Row label="Sales revenue" value={formatMoney(s.totalSalesRevenue)} />
            <Row label="Purchase cost" value={formatMoney(s.totalPurchaseCost)} />
            <Row
              label="Margin"
              value={formatMoney(s.margin)}
              valueStyle={s.margin >= 0 ? styles.positive : styles.negative}
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

function SectionHeader({ title, onExport }) {
  return (
    <View style={styles.sectionHeaderRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <TouchableOpacity onPress={onExport}>
        <Text style={styles.exportText}>Export CSV</Text>
      </TouchableOpacity>
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
  syncLabel: { fontSize: 11, color: '#999', marginBottom: 12 },
  error: { color: '#d9534f', marginBottom: 12, fontSize: 13 },
  refreshButton: { alignSelf: 'flex-end', marginBottom: 12 },
  refreshText: { color: '#2f6fed', fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  sectionHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20,
  },
  exportText: { color: '#2f6fed', fontWeight: '600', fontSize: 12 },
  card: { backgroundColor: '#f4f6fb', borderRadius: 10, padding: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { color: '#666', fontSize: 13 },
  rowValue: { fontWeight: '600', fontSize: 13 },
  positive: { color: '#2e9c4c' },
  negative: { color: '#d9534f' },
  muted: { color: '#999', fontWeight: '400' },
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
  filterLabel: { fontSize: 12, color: '#666', marginBottom: 4, marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, fontSize: 14, backgroundColor: '#fff' },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#eef2fd', borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12,
  },
  filterChipText: { color: '#2f6fed', fontWeight: '600', fontSize: 13 },
  filterChipClear: { color: '#2f6fed', fontWeight: '700', fontSize: 16, paddingHorizontal: 6 },
  itemMatchRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e5e9f2' },
  itemMatchText: { fontSize: 13, color: '#333' },
  applyButton: {
    backgroundColor: '#2f6fed', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 12,
  },
  applyButtonText: { color: '#fff', fontWeight: '600' },
});
