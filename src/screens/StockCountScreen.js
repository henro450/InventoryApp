import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, TextInput, Pressable, StyleSheet, Alert, KeyboardAvoidingView } from 'react-native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../context/AuthContext';
import { getLocalItems, saveLocalCount, getCached, setCached } from '../db/localDb';
import { runSync } from '../sync/syncEngine';
import { formatNumber, cleanQuantityInput, groupDigits, timeAgo, plural } from '../utils/format';
import { formatStock } from '../utils/pack';
import Icon from '../components/Icon';
import { Text, Screen, NavHeader, IconButton, SearchField, Chip, BottomBar, Button, Note, EmptyState } from '../components/ui';
import { colors, fonts, type } from '../theme';

const FILTERS = [
  { key: 'todo', label: 'Not counted' },
  { key: 'diff', label: 'Different' },
  { key: 'all', label: 'All' },
];

// A guided stock count: go along the shelves typing what is actually there (search or scan to
// find an item), then post every difference at once as adjustments. The count is kept on this
// phone as you go, so leaving the screen or closing the app doesn't lose it.
export default function StockCountScreen({ navigation }) {
  const { user } = useAuth();
  const draftKey = `stockCount:${user.id}:${user.companyId}`;
  const [items] = useState(() => getLocalItems(user.companyId));
  const [counts, setCounts] = useState(() => getCached(draftKey)?.data?.counts || {});
  const [startedAt] = useState(() => getCached(draftKey)?.data?.startedAt || new Date().toISOString());
  const [filter, setFilter] = useState('todo');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [listVersion, setListVersion] = useState(0);
  const resumed = useRef(Object.keys(counts).length > 0);

  // Keep the count on the phone as it's typed.
  useEffect(() => {
    if (saving) return;
    setCached(draftKey, Object.keys(counts).length ? { counts, startedAt } : null);
  }, [counts]);

  const isCounted = (i) => counts[i.localId] !== undefined && counts[i.localId] !== '';
  const differs = (i) => isCounted(i) && Number(counts[i.localId]) !== Number(i.quantityOnHand);
  const counted = items.filter(isCounted);
  const changes = items.filter(differs);

  // The list is worked out when the filter or search changes, not on every keystroke, so a row
  // doesn't vanish from "Not counted" while its number is being typed.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => (filter === 'todo' ? !isCounted(i) : filter === 'diff' ? differs(i) : true))
      .filter((i) => !q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q));
  }, [items, filter, query, listVersion]);

  function setCount(item, text) {
    setCounts((c) => ({ ...c, [item.localId]: cleanQuantityInput(text, item.allowDecimal) }));
  }

  function scan() {
    navigation.navigate('ScanBarcode', {
      onScanned: (code) => {
        const match = items.find((i) => i.sku.trim().toLowerCase() === code.trim().toLowerCase());
        if (!match) {
          Alert.alert('Not found', `No item in this list has SKU "${code}".`);
          return;
        }
        setFilter('all');
        setQuery(match.sku);
      },
    });
  }

  function discard() {
    Alert.alert('Start again?', 'The numbers typed so far will be cleared. Stock is not changed.', [
      { text: 'Keep counting', style: 'cancel' },
      {
        text: 'Clear count',
        style: 'destructive',
        onPress: () => {
          setCounts({});
          setFilter('todo');
          setListVersion((v) => v + 1);
        },
      },
    ]);
  }

  function post() {
    if (!changes.length) {
      Alert.alert('Nothing to change', counted.length ? 'Everything you counted matches the stock on this phone.' : 'Type the counted quantity for at least one item.');
      return;
    }
    const bad = changes.find((i) => !i.allowDecimal && !Number.isInteger(Number(counts[i.localId])));
    if (bad) {
      Alert.alert(bad.name, `${bad.name} is counted in whole ${bad.unit}. Enter a whole number.`);
      return;
    }
    const lines = changes.slice(0, 6).map((i) => `${i.name}: ${formatNumber(i.quantityOnHand)} → ${formatNumber(Number(counts[i.localId]))}`);
    if (changes.length > 6) lines.push(`and ${plural(changes.length - 6, 'more item')}`);
    Alert.alert(`Update ${plural(changes.length, 'item')}?`, `${lines.join('\n')}\n\nEach is saved as an adjustment, so the differences show in the discrepancy report.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Update stock', onPress: save },
    ]);
  }

  function save() {
    const occurredAt = new Date().toISOString();
    setSaving(true);
    try {
      saveLocalCount(
        changes.map((i) => ({
          clientTransactionId: uuidv4(),
          itemLocalId: i.localId,
          itemServerId: i.id,
          itemClientItemId: i.clientItemId,
          companyId: user.companyId,
          quantity: Number(counts[i.localId]),
          unitPrice: null,
          paymentMethod: null,
          amountPaid: null,
          customerName: null,
          customerPhone: null,
          priceWasDefaulted: false,
          occurredAt,
          userId: user.id,
        }))
      );
    } catch (err) {
      setSaving(false);
      Alert.alert('Could not save', err.message);
      return;
    }
    setCached(draftKey, null);
    runSync(user.id);
    navigation.goBack();
    Alert.alert('Stock updated', `${plural(changes.length, 'item')} adjusted to what you counted.`);
  }

  return (
    <Screen>
      <NavHeader title="Stock count" right={counted.length ? <IconButton icon="trash" label="Clear count" variant="ghost" onPress={discard} /> : null} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <FlatList
          data={visible}
          keyExtractor={(i) => i.localId}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListHeaderComponent={
            <View style={{ gap: 14, paddingBottom: 14 }}>
              {resumed.current && <Note>Carrying on the count you started {timeAgo(startedAt)}.</Note>}
              <View style={styles.progress}>
                <Text style={styles.progressText}>
                  {formatNumber(counted.length)} of {formatNumber(items.length)} counted
                </Text>
                <Text style={type.caption}>{changes.length ? `${plural(changes.length, 'difference')} so far` : 'No differences yet'}</Text>
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${items.length ? (counted.length / items.length) * 100 : 0}%` }]} />
                </View>
              </View>
              <View style={styles.searchRow}>
                <View style={{ flex: 1 }}>
                  <SearchField value={query} onChangeText={setQuery} placeholder="Search name or SKU" />
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Scan an item" onPress={scan} style={({ pressed }) => [styles.scanButton, pressed && { opacity: 0.8 }]}>
                  <Icon name="scan" size={22} color="#FFFFFF" strokeWidth={1.9} />
                </Pressable>
              </View>
              <View style={styles.chips}>
                {FILTERS.map((f) => (
                  <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />
                ))}
              </View>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon={filter === 'todo' && !query ? 'check' : 'search'}
              title={filter === 'todo' && !query ? 'Everything is counted' : 'Nothing here'}
              body={filter === 'todo' && !query ? 'Check the differences, then update stock.' : 'Try a different search or filter.'}
            />
          }
          renderItem={({ item: i }) => {
            const diff = isCounted(i) ? Math.round((Number(counts[i.localId]) - Number(i.quantityOnHand)) * 100) / 100 : null;
            return (
              <View style={[styles.row, diff !== null && diff !== 0 && { borderColor: colors.warnLine }]}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.name} numberOfLines={2}>{i.name}</Text>
                  <Text style={type.caption} numberOfLines={1}>
                    <Text style={type.mono}>{i.sku}</Text> · phone says {formatStock(i.quantityOnHand, i)}
                  </Text>
                  {diff !== null && (
                    <Text style={[styles.diff, { color: diff === 0 ? colors.ok : colors.warn }]}>
                      {diff === 0 ? 'Matches' : `${diff > 0 ? '+' : '−'}${formatNumber(Math.abs(diff))} ${i.unit}`}
                    </Text>
                  )}
                </View>
                <TextInput
                  value={groupDigits(counts[i.localId] ?? '')}
                  onChangeText={(t) => setCount(i, t)}
                  keyboardType={i.allowDecimal ? 'decimal-pad' : 'number-pad'}
                  placeholder="Count"
                  placeholderTextColor={colors.placeholder}
                  accessibilityLabel={`Counted quantity of ${i.name}`}
                  selectTextOnFocus
                  style={[styles.input, isCounted(i) && { borderColor: colors.ink }]}
                />
              </View>
            );
          }}
        />
        <BottomBar>
          <Button
            title={changes.length ? `Update stock · ${plural(changes.length, 'item')}` : 'Update stock'}
            onPress={post}
            loading={saving}
            disabled={!counted.length}
          />
          <Text style={[type.caption, { textAlign: 'center' }]}>Only items you counted and that differ are changed.</Text>
        </BottomBar>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24 },
  progress: { gap: 6, padding: 16, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  progressText: { fontFamily: fonts.semibold, fontSize: 16 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceMuted, overflow: 'hidden', marginTop: 4 },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  searchRow: { flexDirection: 'row', gap: 10 },
  scanButton: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  diff: { fontFamily: fonts.semibold, fontSize: 12 },
  input: {
    width: 92, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.lineStrong, textAlign: 'center',
    fontFamily: fonts.display, fontSize: 18, color: colors.ink, paddingVertical: 0, fontVariant: ['tabular-nums'],
  },
});
