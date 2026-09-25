import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { getLocalItems, getSyncStatusSummary, saveLocalItem, deleteLocalItem, getLastSyncedAt } from '../db/localDb';
import { runSync } from '../sync/syncEngine';
import { isLowStock } from '../utils/inventory';
import { exportCsv, pickAndParseCsv } from '../utils/csvExport';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

// SYNC-06: visible "All synced" / "X pending" indicator so the user always knows whether
// their data has reached the cloud.
export default function InventoryScreen({ navigation, route }) {
  const { user } = useAuth();
  const viewingCompanyId = route?.params?.companyId || user.companyId;
  const isOwnCompany = viewingCompanyId === user.companyId;
  const [items, setItems] = useState([]);
  const [syncSummary, setSyncSummary] = useState({ total: 0, pending: 0, failed: 0, conflict: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);

  const loadLocal = useCallback(() => {
    setItems(getLocalItems(viewingCompanyId));
    setSyncSummary(getSyncStatusSummary(user.id));
  }, [viewingCompanyId, user.id]);

  useFocusEffect(
    useCallback(() => {
      loadLocal();
    }, [loadLocal])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await runSync(user.id); // no-ops gracefully if offline (SYNC-01)
    loadLocal();
    setRefreshing(false);
  }

  function handleEdit(item) {
    navigation.navigate('AddItem', { item });
  }

  function handleDeactivate(item) {
    Alert.alert(
      'Deactivate item',
      `Deactivate "${item.name}"? It will no longer appear in inventory.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: () => {
            if (!item.id) {
              deleteLocalItem(item.localId);
            } else {
              saveLocalItem({ ...item, isActive: 0, syncStatus: 'pending', userId: user.id });
              runSync(user.id);
            }
            loadLocal();
          },
        },
      ]
    );
  }

  function handleScanToFind() {
    navigation.navigate('ScanBarcode', {
      onScanned: (code) => {
        const normalized = code.trim().toLowerCase();
        const match = items.find((i) => i.sku.trim().toLowerCase() === normalized);
        if (!match) {
          Alert.alert('Not found', `No item in this list has SKU "${code}".`);
          return;
        }
        navigation.navigate('StockTransaction', { item: match });
      },
    });
  }

  async function handleExportCatalog() {
    if (items.length === 0) {
      Alert.alert('Nothing to export', 'There are no items in this catalog yet.');
      return;
    }
    try {
      await exportCsv('item-catalog.csv', items, [
        { key: 'sku', label: 'SKU' },
        { key: 'name', label: 'Name' },
        { key: 'category', label: 'Category' },
        { key: 'unit', label: 'Unit' },
        { key: 'lowStockThreshold', label: 'Low Stock Threshold' },
      ]);
    } catch (err) {
      Alert.alert('Export failed', err.message);
    }
  }

  async function handleImportCatalog() {
    let rows;
    try {
      rows = await pickAndParseCsv();
    } catch (err) {
      Alert.alert('Import failed', err.message);
      return;
    }
    if (!rows) return; // user cancelled the picker

    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
      const sku = (row.SKU || row.sku || '').trim();
      const name = (row.Name || row.name || '').trim();
      if (!sku || !name) {
        skipped++;
        continue;
      }
      const clientItemId = uuidv4();
      saveLocalItem({
        id: null,
        localId: clientItemId,
        clientItemId,
        sku,
        name,
        category: (row.Category || row.category || '').trim() || null,
        unit: (row.Unit || row.unit || '').trim() || 'unit',
        companyId: user.companyId,
        quantityOnHand: 0,
        lowStockThreshold: Number(row['Low Stock Threshold'] || row.lowStockThreshold || 0) || 0,
        lastPurchasePrice: null,
        updatedAt: new Date().toISOString(),
        syncStatus: 'pending',
        userId: user.id,
      });
      imported++;
    }

    runSync(user.id);
    loadLocal();
    Alert.alert('Import complete', `Imported ${imported} item${imported === 1 ? '' : 's'}${skipped > 0 ? `, skipped ${skipped} row${skipped === 1 ? '' : 's'} missing SKU/Name` : ''}.`);
  }

  const visibleItems = showLowStockOnly ? items.filter(isLowStock) : items;
  const lastSynced = getLastSyncedAt(user.id);
  const lastSyncedLabel = lastSynced
    ? `Data last synced: ${new Date(lastSynced).toLocaleString()}`
    : 'Not yet synced';

  return (
    <View style={styles.container}>
      {!isOwnCompany && (
        <View style={styles.readOnlyBanner}>
          <Text style={styles.readOnlyText}>Viewing {route?.params?.companyName || 'Sub Company'} — read-only</Text>
          <Text style={styles.lastSyncedText}>{lastSyncedLabel}</Text>
        </View>
      )}

      <View style={styles.syncBar}>
        <Text style={styles.syncText}>
          {syncSummary.total > 0 ? `${syncSummary.total} unsynced change(s)` : 'All synced'}
          {syncSummary.conflict > 0 ? ` · ${syncSummary.conflict} need review` : ''}
          {syncSummary.failed > 0 ? ` · ${syncSummary.failed} retrying` : ''}
        </Text>
        <TouchableOpacity
          style={[styles.filterChip, showLowStockOnly && styles.filterChipActive]}
          onPress={() => setShowLowStockOnly((v) => !v)}
        >
          <Text style={[styles.filterChipText, showLowStockOnly && styles.filterChipTextActive]}>
            Low stock only
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.linkRow}>
        <TouchableOpacity onPress={() => navigation.navigate('Reports', route?.params)}>
          <Text style={styles.linkText}>Reports</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('AuditLog', route?.params)}>
          <Text style={styles.linkText}>Audit Log</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Alerts', route?.params)}>
          <Text style={styles.linkText}>Alerts</Text>
        </TouchableOpacity>
        {isOwnCompany && (
          <TouchableOpacity onPress={handleScanToFind}>
            <Text style={styles.linkText}>Scan Item</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={handleExportCatalog}>
          <Text style={styles.linkText}>Export Catalog</Text>
        </TouchableOpacity>
        {isOwnCompany && (
          <TouchableOpacity onPress={handleImportCatalog}>
            <Text style={styles.linkText}>Import Catalog</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={visibleItems}
        keyExtractor={(item) => item.localId}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={<Text style={styles.empty}>No items yet. Add one to get started.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            disabled={!isOwnCompany}
            onPress={() => navigation.navigate('StockTransaction', { item })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemMeta}>{item.sku} · {item.category || 'Uncategorized'}</Text>
              {item.syncStatus === 'conflict' && (
                <Text style={styles.conflictText}>Changed elsewhere — edit or deactivate again to resolve</Text>
              )}
              {isOwnCompany && (
                <View style={styles.itemActions}>
                  <TouchableOpacity onPress={() => handleEdit(item)}>
                    <Text style={styles.actionText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDeactivate(item)}>
                    <Text style={[styles.actionText, styles.actionTextDanger]}>Deactivate</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.qty, isLowStock(item) && styles.qtyLow]}>
                {item.quantityOnHand} {item.unit}
              </Text>
              {isLowStock(item) && <Text style={styles.lowLabel}>Low stock</Text>}
            </View>
          </TouchableOpacity>
        )}
      />

      {isOwnCompany && (
        <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('AddItem')}>
          <Text style={styles.fabText}>+ Add Item</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  readOnlyBanner: { backgroundColor: '#fff4e0', padding: 8, alignItems: 'center' },
  readOnlyText: { fontSize: 12, color: '#8a5a00', fontWeight: '600' },
  lastSyncedText: { fontSize: 11, color: '#8a5a00', marginTop: 2 },
  syncBar: {
    padding: 10, backgroundColor: '#f4f6fb', alignItems: 'center',
    flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16,
  },
  syncText: { fontSize: 13, color: '#555' },
  filterChip: { backgroundColor: '#eef2fd', borderRadius: 14, paddingVertical: 5, paddingHorizontal: 12 },
  filterChipActive: { backgroundColor: '#2f6fed' },
  filterChipText: { fontSize: 12, color: '#2f6fed', fontWeight: '600' },
  filterChipTextActive: { color: '#fff' },
  linkRow: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 16, paddingVertical: 10,
    paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  linkText: { color: '#2f6fed', fontWeight: '600', fontSize: 13 },
  empty: { textAlign: 'center', color: '#999', marginTop: 40 },
  card: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14, borderWidth: 1, borderColor: '#eee', borderRadius: 10, marginBottom: 10,
  },
  itemName: { fontSize: 16, fontWeight: '600' },
  itemMeta: { fontSize: 13, color: '#888', marginTop: 2 },
  conflictText: { fontSize: 11, color: '#b35c00', marginTop: 4 },
  itemActions: { flexDirection: 'row', gap: 16, marginTop: 6 },
  actionText: { color: '#2f6fed', fontWeight: '600', fontSize: 12 },
  actionTextDanger: { color: '#d9534f' },
  qty: { fontSize: 16, fontWeight: '600' },
  qtyLow: { color: '#d9534f' },
  lowLabel: { fontSize: 11, color: '#d9534f' },
  fab: {
    position: 'absolute', bottom: 24, right: 24, backgroundColor: '#2f6fed',
    paddingVertical: 12, paddingHorizontal: 18, borderRadius: 30, elevation: 3,
  },
  fabText: { color: '#fff', fontWeight: '600' },
});
