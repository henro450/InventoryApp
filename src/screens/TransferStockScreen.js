import React, { useMemo, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Alert, KeyboardAvoidingView } from 'react-native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../context/AuthContext';
import { getLocalCompany, getLocalSubCompanies, getLocalItems, getLocalItemByLocalId, saveLocalTransfer } from '../db/localDb';
import { runSync } from '../sync/syncEngine';
import { formatMoney, formatNumber, quantityStep } from '../utils/format';
import { hasPacks, toUnits, packLabel, formatStock, unitOptions } from '../utils/pack';
import {
  Text, Screen, NavHeader, Card, ListCard, Chip, Segmented, Stepper, Note, Stat, BottomBar, Button, SearchField,
  LetterTile, InlineEmpty,
} from '../components/ui';
import { colors, type } from '../theme';

const sameSku = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Moves stock between the Main Company and its Sub Companies (main company admins). The stock
// leaves one branch and arrives in the other at its last purchase price; it is not a sale or a
// purchase. If the receiving branch has no item with the same SKU, a copy of the item is created
// there. Saved on this phone first and synced like everything else.
export default function TransferStockScreen({ navigation, route }) {
  const { user } = useAuth();
  const branches = useMemo(() => {
    const main = getLocalCompany(user.companyId);
    return [main, ...getLocalSubCompanies(user.companyId).filter((c) => c.isActive)].filter(Boolean);
  }, [user.companyId]);
  const startItem = route.params?.item || null;
  const [fromId, setFromId] = useState(startItem?.companyId || route.params?.companyId || user.companyId);
  const [toId, setToId] = useState(() => branches.find((b) => b.id !== (startItem?.companyId || route.params?.companyId || user.companyId))?.id ?? null);
  const [item, setItem] = useState(startItem);
  const [query, setQuery] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitMode, setUnitMode] = useState('unit');

  const branchName = (id) => branches.find((b) => b.id === id)?.name || 'Branch';
  const fromItems = useMemo(() => getLocalItems(fromId), [fromId]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inStock = fromItems.filter((i) => Number(i.quantityOnHand) > 0);
    return (q ? inStock.filter((i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)) : inStock).slice(0, 8);
  }, [fromItems, query]);
  // The receiving branch's item with the same SKU, if it has one.
  const target = useMemo(() => (item && toId ? getLocalItems(toId).find((i) => sameSku(i.sku, item.sku)) || null : null), [item, toId]);

  const inPacks = !!item && hasPacks(item) && unitMode === 'pack';
  const qty = item ? toUnits(quantity, item, inPacks) : 0;
  const onHand = Number(item?.quantityOnHand) || 0;
  const problem = !item
    ? 'Choose the item to move.'
    : !toId
      ? 'Choose where the stock is going.'
      : qty <= 0
        ? 'Enter how much to move.'
        : qty > onHand
          ? `Only ${formatStock(onHand, item)} in ${branchName(fromId)}.`
          : !item.allowDecimal && !Number.isInteger(qty)
            ? `${item.name} is counted in whole ${item.unit}.`
            : null;

  function chooseFrom(id) {
    setFromId(id);
    setItem(null);
    setQuantity('');
    if (toId === id) setToId(branches.find((b) => b.id !== id)?.id ?? null);
  }

  function handleSave() {
    const current = item && getLocalItemByLocalId(item.localId);
    if (!current) {
      Alert.alert('Item not found', 'This item is no longer on this phone. Choose it again.');
      setItem(null);
      return;
    }
    if (problem) {
      Alert.alert('Check the transfer', problem);
      return;
    }
    let toLocalId = target?.localId;
    let newTarget = null;
    if (!target) {
      const clientItemId = uuidv4();
      toLocalId = clientItemId;
      newTarget = {
        id: null,
        localId: clientItemId,
        clientItemId,
        companyId: toId,
        sku: current.sku,
        name: current.name,
        category: current.category,
        unit: current.unit,
        lowStockThreshold: current.lowStockThreshold,
        allowDecimal: !!current.allowDecimal,
        sellingPrice: current.sellingPrice,
        packSize: current.packSize,
        packName: current.packName,
        lastPurchasePrice: null,
        updatedAt: new Date().toISOString(),
      };
    }
    try {
      saveLocalTransfer({
        transferId: uuidv4(),
        from: { itemLocalId: current.localId, companyId: fromId, clientTransactionId: uuidv4() },
        to: { itemLocalId: toLocalId, companyId: toId, clientTransactionId: uuidv4() },
        quantity: qty,
        occurredAt: new Date().toISOString(),
        userId: user.id,
        companyId: user.companyId,
        newTarget,
      });
    } catch (err) {
      Alert.alert('Could not save', err.code === 'INSUFFICIENT_STOCK' ? `Only ${formatStock(err.available, current)} left in ${branchName(fromId)}.` : err.message);
      return;
    }
    runSync(user.id);
    navigation.goBack();
    Alert.alert('Stock moved', `${formatStock(qty, current)} of ${current.name} moved from ${branchName(fromId)} to ${branchName(toId)}.`);
  }

  if (branches.length < 2) {
    return (
      <Screen>
        <NavHeader title="Move stock" />
        <View style={styles.content}>
          <Card>
            <InlineEmpty>Add a sub company first. Stock can only move between your branches.</InlineEmpty>
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <NavHeader title="Move stock" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <View style={{ gap: 8 }}>
            <Text style={type.label}>From</Text>
            <View style={styles.chips}>
              {branches.map((b) => (
                <Chip key={b.id} label={b.name} active={fromId === b.id} onPress={() => chooseFrom(b.id)} />
              ))}
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <Text style={type.label}>Item</Text>
            {item ? (
              <Card padding={14} gap={10}>
                <View style={styles.itemRow}>
                  <LetterTile label={item.name} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={type.bodyStrong} numberOfLines={2}>{item.name}</Text>
                    <Text style={type.caption}>
                      <Text style={type.mono}>{item.sku}</Text> · {formatStock(item.quantityOnHand, item)} in {branchName(fromId)}
                    </Text>
                  </View>
                  <Button title="Change" variant="ghost" height={36} onPress={() => setItem(null)} />
                </View>
              </Card>
            ) : (
              <>
                {fromItems.length > 8 && <SearchField value={query} onChangeText={setQuery} placeholder="Search name or SKU" />}
                {matches.length ? (
                  <ListCard>
                    {matches.map((i, index) => (
                      <Pressable
                        key={i.localId}
                        accessibilityRole="button"
                        onPress={() => {
                          setItem(i);
                          setUnitMode('unit');
                          setQuery('');
                        }}
                        style={({ pressed }) => [styles.pickRow, index > 0 && styles.pickBorder, pressed && { backgroundColor: colors.surfaceMuted }]}
                      >
                        <LetterTile label={i.name} size={36} />
                        <View style={{ flex: 1, gap: 1 }}>
                          <Text style={type.bodyStrong} numberOfLines={1}>{i.name}</Text>
                          <Text style={type.caption}>{formatStock(i.quantityOnHand, i)}</Text>
                        </View>
                      </Pressable>
                    ))}
                  </ListCard>
                ) : (
                  <InlineEmpty>{query.trim() ? 'No item in stock matches.' : `${branchName(fromId)} has no stock to move.`}</InlineEmpty>
                )}
              </>
            )}
          </View>

          <View style={{ gap: 8 }}>
            <Text style={type.label}>To</Text>
            <View style={styles.chips}>
              {branches.filter((b) => b.id !== fromId).map((b) => (
                <Chip key={b.id} label={b.name} active={toId === b.id} onPress={() => setToId(b.id)} />
              ))}
            </View>
          </View>

          {item && hasPacks(item) && (
            <Segmented accessibilityLabel="Unit to move" options={unitOptions(item)} value={unitMode} onChange={setUnitMode} />
          )}
          {item && (
            <Stepper
              big
              label={inPacks ? `${packLabel(item, 2)} to move` : `Quantity to move (${item.unit})`}
              value={quantity}
              onChange={setQuantity}
              decimal={!!item.allowDecimal && !inPacks}
              step={inPacks ? 1 : quantityStep(item)}
            />
          )}

          {item && toId && (
            <Note>
              {target
                ? `Adds to ${target.name} in ${branchName(toId)}, which has ${formatStock(target.quantityOnHand, target)} now.`
                : `${branchName(toId)} doesn't stock ${item.name} yet. It will be added there with the same SKU, price and settings.`}
            </Note>
          )}

          {item && qty > 0 && (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Stat label={`${branchName(fromId)} after`} value={formatStock(Math.max(0, onHand - qty), item)} />
              <Stat
                align="right"
                label="Value at cost"
                value={item.lastPurchasePrice != null ? formatMoney(Math.round(qty * Number(item.lastPurchasePrice) * 100) / 100) : '—'}
              />
            </View>
          )}
        </ScrollView>

        <BottomBar>
          <Button title={item && qty > 0 ? `Move ${formatNumber(qty)} ${item.unit}` : 'Move stock'} onPress={handleSave} disabled={!!problem} />
          <Text style={[type.caption, { textAlign: 'center' }]}>Not counted as a sale or a purchase.</Text>
        </BottomBar>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 10, gap: 18 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  pickBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
});
