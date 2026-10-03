import React, { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, KeyboardAvoidingView, Pressable } from 'react-native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { getLocalItems, saveLocalItem } from '../db/localDb';
import { useAuth } from '../context/AuthContext';
import { runSync } from '../sync/syncEngine';
import Icon from '../components/Icon';
import { Text, Screen, NavHeader, Field, Chip, Stepper, BottomBar, Button, Checkbox } from '../components/ui';
import { formatMoney } from '../utils/format';
import { colors, fonts, type } from '../theme';

const UNIT_PRESETS = ['unit', 'box', 'kg', 'm', 'pair', 'litre'];

// INV-01/INV-06: item creation now works fully offline. The item is written to the local
// queue immediately with syncStatus = 'pending' and a client-generated id (clientItemId).
// runSync() is then triggered as best-effort; if there's no connectivity it fails silently
// and the item stays queued (SYNC-01/SYNC-05) until the next automatic sync pass, at which
// point the server assigns a real id and the local record is updated (see syncEngine.js).
//
// INV-01: this screen also doubles as the edit form when navigated to with a `route.params.item`
// — SKU stays read-only in that mode since the backend's item-update path never accepts it.
export default function AddItemScreen({ navigation, route }) {
  const { user } = useAuth();
  const editingItem = route?.params?.item ?? null;
  const isEditMode = !!editingItem;

  const [sku, setSku] = useState(editingItem?.sku ?? '');
  const [name, setName] = useState(editingItem?.name ?? '');
  const [category, setCategory] = useState(editingItem?.category ?? '');
  const [unit, setUnit] = useState(editingItem?.unit ?? 'unit');
  const [customUnit, setCustomUnit] = useState(!!editingItem && !UNIT_PRESETS.includes(editingItem.unit));
  const [lowStockThreshold, setLowStockThreshold] = useState(
    editingItem?.lowStockThreshold != null ? String(editingItem.lowStockThreshold) : ''
  );
  // Items sold by weight or length can take decimal quantities (e.g. 2.5 kg). Off by default.
  const [allowDecimal, setAllowDecimal] = useState(!!editingItem?.allowDecimal);
  // What the item normally sells for. Sales use it when no price is typed; without it they fall
  // back to the last purchase price, which records the sale at cost (no profit).
  const [sellingPrice, setSellingPrice] = useState(
    editingItem?.sellingPrice !== null && editingItem?.sellingPrice !== undefined ? String(editingItem.sellingPrice) : ''
  );
  // Bought or sold in packs as well as single units (a carton of 24). Stock is still kept in units.
  const [inPacks, setInPacks] = useState(Number(editingItem?.packSize) > 1);
  const [packSize, setPackSize] = useState(Number(editingItem?.packSize) > 1 ? String(editingItem.packSize) : '');
  const [packName, setPackName] = useState(editingItem?.packName ?? 'carton');
  const cost = editingItem?.lastPurchasePrice;
  const hasCost = cost !== null && cost !== undefined;
  const sellingNumber = sellingPrice.trim() === '' ? null : Number(sellingPrice);
  const [submitting, setSubmitting] = useState(false);

  // Suggest the categories this company already uses, most common first.
  const categorySuggestions = useMemo(() => {
    const counts = {};
    for (const i of getLocalItems(user.companyId)) {
      if (i.category) counts[i.category] = (counts[i.category] || 0) + 1;
    }
    return Object.keys(counts)
      .sort((a, b) => counts[b] - counts[a])
      .slice(0, 6);
  }, [user.companyId]);

  async function handleSave() {
    if (!sku || !name) {
      Alert.alert('Missing info', 'SKU and name are required.');
      return;
    }
    const size = Number(packSize);
    if (inPacks && (!Number.isInteger(size) || size < 2)) {
      Alert.alert('Pack size', `Enter how many ${unit || 'units'} are in one ${packName.trim() || 'pack'} (2 or more).`);
      return;
    }
    const pack = inPacks ? { packSize: size, packName: packName.trim().slice(0, 40) || 'pack' } : { packSize: null, packName: null };
    setSubmitting(true);

    try {
      if (isEditMode) {
        saveLocalItem({
          ...editingItem,
          name,
          category: category || null,
          unit,
          lowStockThreshold: lowStockThreshold ? Number(lowStockThreshold) : 0,
          allowDecimal,
          sellingPrice: sellingNumber,
          ...pack,
          updatedAt: new Date().toISOString(),
          syncStatus: 'pending',
          userId: user.id,
        });
      } else {
        const clientItemId = uuidv4();
        saveLocalItem({
          id: null,
          localId: clientItemId,
          clientItemId,
          sku,
          name,
          category: category || null,
          unit,
          companyId: user.companyId,
          quantityOnHand: 0,
          lowStockThreshold: lowStockThreshold ? Number(lowStockThreshold) : 0,
          allowDecimal,
          sellingPrice: sellingNumber,
          ...pack,
          lastPurchasePrice: null,
          updatedAt: new Date().toISOString(),
          syncStatus: 'pending',
          userId: user.id,
        });
      }

      // Best-effort immediate sync; safe to fail silently if offline.
      runSync(user.id);

      navigation.goBack();
    } catch (err) {
      Alert.alert('Could not save item', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <NavHeader title={isEditMode ? 'Edit item' : 'New item'} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {isEditMode ? (
            <View style={{ gap: 8 }}>
              <Text style={type.label}>SKU</Text>
              <View style={styles.readOnly}>
                <Text style={styles.readOnlyText}>{sku}</Text>
                <Icon name="lock" size={18} color={colors.ink3} />
              </View>
              <Text style={type.caption}>SKU can't be changed after the item is saved.</Text>
            </View>
          ) : (
            <Field
              label="SKU"
              value={sku}
              onChangeText={setSku}
              placeholder="e.g. SKU-1001"
              autoCapitalize="characters"
              autoCorrect={false}
              mono
              hint="SKU can't be changed after the item is saved."
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Scan SKU barcode"
                  onPress={() => navigation.navigate('ScanBarcode', { onScanned: (code) => setSku(code) })}
                  style={({ pressed }) => [styles.scanButton, pressed && { opacity: 0.7 }]}
                >
                  <Icon name="scan" size={18} color={colors.primary} strokeWidth={2} />
                  <Text style={styles.scanText}>Scan</Text>
                </Pressable>
              }
            />
          )}

          <Field label="Item name" value={name} onChangeText={setName} placeholder="e.g. Widget" />

          <Field
            label="Selling price"
            optional
            prefix="₦"
            keyboardType="decimal-pad"
            value={sellingPrice}
            onChangeText={setSellingPrice}
            placeholder="0"
            hint={
              sellingNumber !== null && hasCost
                ? `Bought for ${formatMoney(cost)}. Profit per ${unit || 'unit'}: ${formatMoney(sellingNumber - Number(cost))}.`
                : 'Used on every sale unless you type a different price. Without it, sales are recorded at the price you paid.'
            }
          />

          <View style={{ gap: 8 }}>
            <Field label="Category" optional value={category} onChangeText={setCategory} placeholder="e.g. Hardware" />
            {categorySuggestions.length > 0 && (
              <View style={styles.chips}>
                {categorySuggestions.map((c) => (
                  <Chip key={c} label={c} active={category === c} onPress={() => setCategory(category === c ? '' : c)} />
                ))}
              </View>
            )}
          </View>

          <View style={{ gap: 8 }}>
            <Text style={type.label}>Unit</Text>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {UNIT_PRESETS.map((u) => (
                <Chip
                  key={u}
                  label={u}
                  active={!customUnit && unit === u}
                  onPress={() => {
                    setCustomUnit(false);
                    setUnit(u);
                  }}
                />
              ))}
              <Chip label="Other" active={customUnit} onPress={() => setCustomUnit(true)} />
            </View>
            {customUnit && (
              <Field value={unit} onChangeText={setUnit} placeholder="e.g. roll, can, bag" accessibilityLabel="Custom unit" autoCapitalize="none" />
            )}
          </View>

          <Checkbox
            label="Allow decimal quantities"
            hint="For items sold by weight or length, e.g. 2.5 kg. Stock in, sales and counts take decimals, and + / − change by 0.5."
            checked={allowDecimal}
            onChange={setAllowDecimal}
          />

          <View style={{ gap: 12 }}>
            <Checkbox
              label="Also bought or sold in packs"
              hint={`For a carton, crate or bag of several ${unit || 'units'}. Stock in and sales can then be entered in packs or single ${unit || 'units'}.`}
              checked={inPacks}
              onChange={setInPacks}
            />
            {inPacks && (
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Field
                  label="Pack name"
                  value={packName}
                  onChangeText={setPackName}
                  placeholder="carton"
                  autoCapitalize="none"
                  style={{ flex: 1 }}
                />
                <Field
                  label={`${unit || 'Units'} per pack`}
                  keyboardType="number-pad"
                  value={packSize}
                  onChangeText={(t) => setPackSize(t.replace(/\D/g, ''))}
                  placeholder="24"
                  style={{ flex: 1 }}
                />
              </View>
            )}
            {inPacks && Number(packSize) > 1 && sellingNumber !== null && (
              <Text style={type.caption}>
                One {packName.trim() || 'pack'} of {packSize} sells for {formatMoney(sellingNumber * Number(packSize))} unless you type a price.
              </Text>
            )}
          </View>

          <View style={{ gap: 8 }}>
            <Stepper label="Low-stock alert at" value={lowStockThreshold} onChange={setLowStockThreshold} />
            <Text style={type.caption}>You get an alert when stock falls to this level.</Text>
          </View>
        </ScrollView>

        <BottomBar>
          <Button title={isEditMode ? 'Save changes' : 'Save item'} onPress={handleSave} loading={submitting} />
          <View style={styles.offline}>
            <Icon name="cloud" size={16} color={colors.ink3} strokeWidth={2} />
            <Text style={type.caption}>Works offline. Syncs when you are back online.</Text>
          </View>
        </BottomBar>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 12, gap: 22 },
  readOnly: {
    height: 52, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  readOnlyText: { fontFamily: fonts.mono, fontSize: 16, color: colors.ink2 },
  scanButton: {
    height: 40, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.primarySoft,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  scanText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  offline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
});
