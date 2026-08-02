import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, TextInput } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

// RPT-01, RPT-02, PRC-03: stock on hand (item/category filter), sales vs purchases (date range
// filter), per-item margin, and per-transaction margin (historical PriceHistory cost basis).
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
  const [transactionMargins, setTransactionMargins] = useState([]);

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
      const [stock, svp, margin, itemsResp, txMargins] = await Promise.all([
        api.getStockOnHandReport(companyId, { category: filters.category, itemId: filters.itemId }),
        api.getSalesVsPurchases(companyId, { from: filters.from, to: filters.to }),
        api.getMarginByItem(companyId),
        api.getItems(companyId),
        api.getTransactionMargins(companyId, { itemId: filters.itemId, from: filters.from, to: filters.to, limit: 50 }),
      ]);
      setStockOnHand(stock.items);
      setSalesVsPurchases(svp);
      setMarginByItem(margin.report);
      setItems(itemsResp.items);
      setTransactionMargins(txMargins.transactions);
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

  const itemMatches =
    itemSearchText && !selectedItem
      ? items.filter((i) => {
          const q = itemSearchText.toLowerCase();
          return i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q);
        })
      : [];

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

      <Text style={styles.sectionTitle}>Per-Transaction Margin (Recent Sales)</Text>
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
