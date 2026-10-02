import React, { useEffect, useMemo, useState } from 'react';
import { View, Modal, Pressable, FlatList, StyleSheet, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './Icon';
import { Text, SearchField, IconButton, LetterTile, Pill, Button, InlineEmpty } from './ui';
import { formatMoney, formatNumber } from '../utils/format';
import { isLowStock } from '../utils/inventory';
import { colors, fonts, type, shadow } from '../theme';

// Picker for a multi-item sale: tick everything the customer is buying (quantities are set on
// the sale screen afterwards). Search by name or SKU, or scan a barcode. Items with no stock
// can't be ticked. Built on its own modal rather than <Sheet> so the search stays at the top and
// "Done" stays at the bottom while a long catalog scrolls between them.
export default function AddSaleItemsSheet({ visible, items, selectedIds, onToggle, onScan, onClose }) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q));
  }, [items, query]);

  const count = selectedIds.size;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 14 }]} accessibilityViewIsModal>
          <View style={styles.handle} />
          <View style={{ gap: 6 }}>
            <Text style={type.sheetTitle} accessibilityRole="header">
              Add items
            </Text>
            <Text style={type.small}>Tick everything the customer is buying. You can set quantities after.</Text>
          </View>
          <View style={styles.searchRow}>
            <SearchField value={query} onChangeText={setQuery} placeholder="Search name or SKU" />
            <IconButton icon="scan" label="Scan barcode" variant="outline" size={48} onPress={onScan} />
          </View>
          <FlatList
            data={results}
            keyExtractor={(i) => String(i.localId)}
            keyboardShouldPersistTaps="handled"
            style={{ flexGrow: 0, flexShrink: 1 }}
            ListEmptyComponent={
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <InlineEmpty>{items.length ? 'No items match.' : 'No items yet. Add items on the Inventory tab.'}</InlineEmpty>
              </View>
            }
            renderItem={({ item }) => (
              <PickerRow item={item} selected={selectedIds.has(item.localId)} onPress={() => onToggle(item)} />
            )}
          />
          <Button
            title={count ? `Done · ${count} item${count === 1 ? '' : 's'} in sale` : 'Done'}
            variant="dark"
            height={50}
            onPress={onClose}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PickerRow({ item, selected, onPress }) {
  const onHand = Number(item.quantityOnHand) || 0;
  const out = onHand <= 0;
  const low = !out && isLowStock(item);
  const price = item.lastPurchasePrice;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: out }}
      accessibilityLabel={`${item.name}, ${formatNumber(onHand)} ${item.unit}${out ? ', out of stock' : ''}`}
      onPress={onPress}
      disabled={out}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.check, selected && styles.checkOn]}>{selected ? <Icon name="check" size={16} color="#FFFFFF" strokeWidth={2.6} /> : null}</View>
      <View style={{ opacity: out ? 0.5 : 1 }}>
        <LetterTile label={item.name} size={38} />
      </View>
      <View style={{ flex: 1, gap: 2, opacity: out ? 0.5 : 1 }}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={type.caption} numberOfLines={1}>
          <Text style={type.mono}>{item.sku}</Text> · {formatNumber(onHand)} {item.unit}
        </Text>
      </View>
      {out ? (
        <Pill kind="danger" label="Out of stock" />
      ) : low ? (
        <Pill kind="warn" label="Low" />
      ) : (
        <Text style={styles.price}>{price !== null && price !== undefined ? formatMoney(price) : '—'}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,19,34,0.5)' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 10, maxHeight: '88%', gap: 14, ...shadow.raised,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.lineStrong },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  check: { width: 26, height: 26, borderRadius: 8, borderWidth: 1.5, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  name: { fontFamily: fonts.semibold, fontSize: 14 },
  price: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2, fontVariant: ['tabular-nums'] },
});
