import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../context/AuthContext';
import { getLocalItems, getSyncStatusSummary, saveLocalItem, deleteLocalItem, getLastSyncedAt } from '../db/localDb';
import { runSync } from '../sync/syncEngine';
import { isLowStock } from '../utils/inventory';
import { exportCsv, pickAndParseCsv } from '../utils/csvExport';
import { startScanToFind } from '../utils/scan';
import { formatNumber, formatTime, lastSyncedLabel, plural, timeAgo } from '../utils/format';
import Icon from '../components/Icon';
import {
  Text, Screen, LargeHeader, NavHeader, IconButton, AccountButton, SearchField, Chip, Pill, Banner, EmptyState,
  CompanySwitcher, ReadOnlyBanner,
} from '../components/ui';
import { colors, fonts, type, shadow } from '../theme';

const CATALOG_COLUMNS = [
  { key: 'sku', label: 'SKU' },
  { key: 'name', label: 'Name' },
  { key: 'category', label: 'Category' },
  { key: 'unit', label: 'Unit' },
  { key: 'lowStockThreshold', label: 'Low Stock Threshold' },
];

// SYNC-06: visible "All synced" / "X pending" indicator so the user always knows whether
// their data has reached the cloud. The same screen doubles as the Main Company's read-only
// view of a Sub Company when opened with route.params.companyId.
export default function InventoryScreen({ navigation, route }) {
  const { user, isMainCompany, logout } = useAuth();
  const viewingCompanyId = route?.params?.companyId || user.companyId;
  const isOwnCompany = viewingCompanyId === user.companyId;
  const [items, setItems] = useState([]);
  const [syncSummary, setSyncSummary] = useState({ total: 0, pending: 0, failed: 0, conflict: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

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
    Alert.alert('Deactivate item', `Deactivate "${item.name}"? It will no longer appear in inventory.`, [
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
    ]);
  }

  function handleMore(item) {
    Alert.alert(item.name, `${item.sku}${item.category ? ` · ${item.category}` : ''}`, [
      { text: 'Record transaction', onPress: () => navigation.navigate('StockTransaction', { item }) },
      { text: 'Edit item', onPress: () => handleEdit(item) },
      { text: 'Deactivate', style: 'destructive', onPress: () => handleDeactivate(item) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function handleExportCatalog() {
    if (items.length === 0) {
      Alert.alert('Nothing to export', 'There are no items in this catalog yet.');
      return;
    }
    try {
      await exportCsv('item-catalog.csv', items, CATALOG_COLUMNS);
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

  const lowCount = useMemo(() => items.filter(isLowStock).length, [items]);
  const reviewCount = useMemo(() => items.filter((i) => i.syncStatus === 'conflict').length, [items]);

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (filter === 'low' && !isLowStock(i)) return false;
      if (filter === 'review' && i.syncStatus !== 'conflict') return false;
      if (!q) return true;
      return i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q);
    });
  }, [items, filter, query]);

  const lastSynced = getLastSyncedAt(user.id);
  const companyParams = { companyId: viewingCompanyId, companyName: route?.params?.companyName };

  const syncParts = [];
  if (syncSummary.conflict > 0) syncParts.push(`${syncSummary.conflict} need${syncSummary.conflict === 1 ? 's' : ''} review`);
  if (syncSummary.failed > 0) syncParts.push(`${syncSummary.failed} retrying`);
  syncParts.push(lastSynced ? `last synced ${formatTime(lastSynced)}` : 'not yet synced');

  const header = isOwnCompany ? (
    <LargeHeader
      eyebrow={isMainCompany ? 'Main company' : 'Sub company'}
      title="Inventory"
      right={
        <>
          <IconButton icon="upload" label="Import catalog from CSV" onPress={handleImportCatalog} />
          <IconButton icon="download" label="Export catalog as CSV" onPress={handleExportCatalog} />
          {!isMainCompany && <AccountButton user={user} onLogout={logout} />}
        </>
      }
    />
  ) : (
    <>
      <NavHeader
        title={route?.params?.companyName || 'Sub Company'}
        right={<IconButton icon="download" label="Export catalog as CSV" onPress={handleExportCatalog} />}
      />
      <View style={styles.readOnlyWrap}>
        <ReadOnlyBanner subtitle={lastSyncedLabel(lastSynced)} />
        <CompanySwitcher active="inventory" params={companyParams} />
      </View>
    </>
  );

  const listHeader = (
    <View style={styles.listHeader}>
      <View style={styles.searchRow}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Search name or SKU" />
        {isOwnCompany && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan to find an item"
            onPress={() => startScanToFind(navigation, user.companyId)}
            style={({ pressed }) => [styles.scanButton, pressed && { opacity: 0.8 }]}
          >
            <Icon name="scan" size={22} color="#FFFFFF" strokeWidth={1.9} />
          </Pressable>
        )}
      </View>
      <View style={styles.chips}>
        <Chip label="All" count={formatNumber(items.length)} active={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label="Low stock" count={lowCount} active={filter === 'low'} onPress={() => setFilter('low')} />
        {isOwnCompany && reviewCount > 0 && (
          <Chip label="Needs review" count={reviewCount} active={filter === 'review'} onPress={() => setFilter('review')} />
        )}
      </View>
      {isOwnCompany &&
        (syncSummary.total > 0 ? (
          <Banner
            kind="warn"
            icon="sync"
            title={`${plural(syncSummary.total, 'change')} waiting to sync`}
            subtitle={syncParts.join(' · ')}
            actionLabel="Sync now"
            actionLoading={refreshing}
            onAction={handleRefresh}
          />
        ) : (
          <Pill kind="ok" icon="check" label={lastSynced ? `All synced · ${timeAgo(lastSynced)}` : 'Not yet synced'} />
        ))}
    </View>
  );

  return (
    <Screen>
      {header}
      <FlatList
        data={visibleItems}
        keyExtractor={(item) => item.localId}
        ListHeaderComponent={listHeader}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
        contentContainerStyle={[styles.list, isOwnCompany && { paddingBottom: 96 }]}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          items.length === 0 ? (
            <EmptyState
              title="No items yet"
              body={isOwnCompany ? 'Add your first item, scan one, or import a CSV catalog.' : 'This company has no items yet.'}
            />
          ) : (
            <EmptyState icon="search" title="Nothing matches" body="Try a different search or filter." />
          )
        }
        renderItem={({ item }) => (
          <ItemRow
            item={item}
            editable={isOwnCompany}
            onPress={() => navigation.navigate('StockTransaction', { item })}
            onEdit={() => handleEdit(item)}
            onDeactivate={() => handleDeactivate(item)}
            onMore={() => handleMore(item)}
          />
        )}
      />
      {isOwnCompany && (
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('AddItem')}
          style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
        >
          <Icon name="plus" size={20} color="#FFFFFF" strokeWidth={2.2} />
          <Text style={styles.fabText}>Add item</Text>
        </Pressable>
      )}
    </Screen>
  );
}

function ItemRow({ item, editable, onPress, onEdit, onDeactivate, onMore }) {
  const swipeRef = useRef(null);
  const low = isLowStock(item);
  const conflict = item.syncStatus === 'conflict';
  const waiting = item.syncStatus === 'pending' || item.syncStatus === 'failed';

  const body = (
    <Pressable
      accessibilityRole={editable ? 'button' : undefined}
      accessibilityHint={editable ? 'Records a stock transaction' : undefined}
      disabled={!editable}
      onPress={onPress}
      style={({ pressed }) => [styles.card, conflict && { borderColor: colors.warnLine }, pressed && { backgroundColor: colors.surfaceMuted }]}
    >
      <View style={{ flex: 1, gap: 5 }}>
        <Text style={styles.itemName} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={type.caption} numberOfLines={1}>
          <Text style={type.mono}>{item.sku}</Text> · {item.category || 'Uncategorized'}
        </Text>
        {low && <Pill kind="danger" label={`Low stock · alert at ${item.lowStockThreshold}`} />}
        {editable && conflict && (
          <View style={styles.statusLine}>
            <Icon name="alert" size={15} color={colors.warn} strokeWidth={2} />
            <Text style={[styles.statusText, { color: colors.warn }]}>Changed on another device. Edit to resolve.</Text>
          </View>
        )}
        {editable && waiting && (
          <View style={styles.statusLine}>
            <Icon name="clock" size={15} color={colors.ink3} strokeWidth={2} />
            <Text style={styles.statusText}>
              {item.syncStatus === 'failed' ? 'Sync failed · will retry' : 'Saved on this device · waiting to sync'}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.qtyCol}>
        <Text style={[styles.qty, low && { color: colors.danger }]}>{formatNumber(item.quantityOnHand)}</Text>
        <Text style={type.caption}>{item.unit}</Text>
      </View>
      {editable && <IconButton icon="more" label={`More actions for ${item.name}`} variant="ghost" size={36} onPress={onMore} />}
    </Pressable>
  );

  if (!editable) return body;

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      containerStyle={styles.swipeContainer}
      renderRightActions={() => (
        <View style={styles.swipeActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${item.name}`}
            style={[styles.swipeAction, { backgroundColor: colors.ink }]}
            onPress={() => {
              swipeRef.current?.close();
              onEdit();
            }}
          >
            <Icon name="pencil" size={18} color="#FFFFFF" />
            <Text style={styles.swipeText}>Edit</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Deactivate ${item.name}`}
            style={[styles.swipeAction, { backgroundColor: colors.danger, width: 96 }]}
            onPress={() => {
              swipeRef.current?.close();
              onDeactivate();
            }}
          >
            <Icon name="trash" size={18} color="#FFFFFF" />
            <Text style={styles.swipeText}>Deactivate</Text>
          </Pressable>
        </View>
      )}
    >
      {body}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  readOnlyWrap: { paddingHorizontal: 20, paddingTop: 2, gap: 14 },
  listHeader: { gap: 14, paddingBottom: 14 },
  searchRow: { flexDirection: 'row', gap: 10 },
  scanButton: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  list: { paddingHorizontal: 20, paddingTop: 2, paddingBottom: 32 },
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 18,
    paddingVertical: 14, paddingLeft: 16, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  itemName: { fontFamily: fonts.semibold, fontSize: 15 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { flex: 1, fontSize: 12, color: colors.ink3, fontFamily: fonts.medium },
  qtyCol: { alignItems: 'flex-end', gap: 1, paddingRight: 4 },
  qty: { fontFamily: fonts.display, fontSize: 24, lineHeight: 28, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  swipeContainer: { borderRadius: 18 },
  swipeActions: { flexDirection: 'row', marginLeft: 10, borderRadius: 18, overflow: 'hidden' },
  swipeAction: { width: 80, alignItems: 'center', justifyContent: 'center', gap: 4 },
  swipeText: { color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 12 },
  fab: {
    position: 'absolute', right: 20, bottom: 18, height: 54, paddingLeft: 16, paddingRight: 20, borderRadius: 27,
    backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', gap: 8, ...shadow.primary,
  },
  fabText: { color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 15 },
});
