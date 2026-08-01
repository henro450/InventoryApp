import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { getLocalItems, getPendingCount, upsertLocalItem, deleteLocalItem } from '../db/localDb';
import { runSync } from '../sync/syncEngine';
import { isLowStock } from '../utils/inventory';

// SYNC-06: visible "All synced" / "X pending" indicator so the user always knows whether
// their data has reached the cloud.
export default function InventoryScreen({ navigation, route }) {
  const { user } = useAuth();
  const viewingCompanyId = route?.params?.companyId || user.companyId;
  const isOwnCompany = viewingCompanyId === user.companyId;
  const [items, setItems] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);

  const loadLocal = useCallback(() => {
    setItems(getLocalItems(viewingCompanyId));
    setPendingCount(getPendingCount(user.id));
  }, [viewingCompanyId]);

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
              upsertLocalItem({ ...item, isActive: 0, syncStatus: 'pending' });
              runSync(user.id);
            }
            loadLocal();
          },
        },
      ]
    );
  }

  const visibleItems = showLowStockOnly ? items.filter(isLowStock) : items;

  return (
    <View style={styles.container}>
      {!isOwnCompany && (
        <View style={styles.readOnlyBanner}>
          <Text style={styles.readOnlyText}>Viewing {route?.params?.companyName || 'Sub Company'} — read-only</Text>
        </View>
      )}

      <View style={styles.syncBar}>
        <Text style={styles.syncText}>
          {pendingCount > 0 ? `${pendingCount} record(s) pending sync` : 'All synced'}
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
    flexDirection: 'row', justifyContent: 'center', gap: 24, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  linkText: { color: '#2f6fed', fontWeight: '600', fontSize: 13 },
  empty: { textAlign: 'center', color: '#999', marginTop: 40 },
  card: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14, borderWidth: 1, borderColor: '#eee', borderRadius: 10, marginBottom: 10,
  },
  itemName: { fontSize: 16, fontWeight: '600' },
  itemMeta: { fontSize: 13, color: '#888', marginTop: 2 },
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
