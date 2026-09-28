import React from 'react';
import { View, Pressable, TextInput, StyleSheet } from 'react-native';
import Icon from './Icon';
import { Text, ListCard, LetterTile, IconButton, CountBadge } from './ui';
import { formatMoney, formatNumber, cleanNumberInput, cleanQuantityInput, quantityStep, groupDigits } from '../utils/format';
import { colors, fonts, type } from '../theme';

// The items in a sale (stock out): one row per item with its quantity and optional sale price.
// A blank price uses the item's last purchase price, labelled in blue on the row. A row with a
// problem (more than is on hand, no price to use) turns red and says what's wrong.
// lines[i] = { item, quantity, unitPrice }; calcs[i] = lineCalc(lines[i]) from utils/sale.js.
export default function SaleLines({ lines, calcs, onChange, onRemove, onAdd }) {
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={type.heading} accessibilityRole="header">
            Items
          </Text>
          <CountBadge count={lines.length} kind="primary" />
        </View>
        <Pressable accessibilityRole="button" onPress={onAdd} hitSlop={10} style={styles.headerAction}>
          <Icon name="plus" size={18} color={colors.primary} strokeWidth={2.2} />
          <Text style={styles.link}>Add item</Text>
        </Pressable>
      </View>

      <ListCard>
        {lines.length ? (
          lines.map((line, index) => (
            <SaleLine
              key={line.item.localId}
              line={line}
              calc={calcs[index]}
              first={index === 0}
              onChange={(changes) => onChange(line.item.localId, changes)}
              onRemove={() => onRemove(line.item.localId)}
            />
          ))
        ) : (
          <View style={styles.empty}>
            <Text style={type.bodyStrong}>No items in this sale</Text>
            <Text style={type.small}>Add the items the customer is buying.</Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={onAdd}
          style={({ pressed }) => [styles.addRow, !lines.length && { borderStyle: 'solid' }, pressed && { opacity: 0.6 }]}
        >
          <Icon name="plus" size={18} color={colors.primary} strokeWidth={2.2} />
          <Text style={styles.link}>{lines.length ? 'Add another item' : 'Add item'}</Text>
        </Pressable>
      </ListCard>
    </View>
  );
}

function SaleLine({ line, calc, first, onChange, onRemove }) {
  const { item } = line;
  const qty = Number(line.quantity) || 0;
  const step = quantityStep(item); // 0.5 for items that allow decimals, else 1
  const stepTo = (next) => onChange({ quantity: String(Math.round(next * 100) / 100) });
  const hasDefault = item.lastPurchasePrice !== null && item.lastPurchasePrice !== undefined;
  return (
    <View style={[styles.line, !first && styles.lineBorder, calc.error && { backgroundColor: colors.dangerSoft }]}>
      <View style={styles.lineHead}>
        <LetterTile label={item.name} size={38} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.name} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={type.caption} numberOfLines={1}>
            <Text style={type.mono}>{item.sku}</Text> · {formatNumber(item.quantityOnHand)} {item.unit} on hand
          </Text>
        </View>
        <IconButton icon="x" label={`Remove ${item.name}`} variant="ghost" size={36} iconSize={18} onPress={onRemove} />
      </View>

      <View style={styles.controls}>
        <View style={styles.stepper}>
          <IconButton
            icon="minus"
            label={`Decrease quantity of ${item.name}`}
            variant="muted"
            size={36}
            iconSize={16}
            disabled={qty - step <= 0}
            onPress={() => stepTo(Math.max(step, qty - step))}
          />
          <TextInput
            value={groupDigits(cleanQuantityInput(line.quantity, item.allowDecimal))}
            onChangeText={(t) => onChange({ quantity: cleanQuantityInput(t, item.allowDecimal) })}
            keyboardType={item.allowDecimal ? 'decimal-pad' : 'number-pad'}
            selectTextOnFocus
            placeholder="0"
            placeholderTextColor={colors.placeholder}
            accessibilityLabel={`Quantity of ${item.name}`}
            style={styles.qtyInput}
          />
          <IconButton
            icon="plus"
            label={`Increase quantity of ${item.name}`}
            variant="muted"
            size={36}
            iconSize={16}
            onPress={() => stepTo(qty + step)}
          />
        </View>
        <View style={styles.priceBox}>
          <Text style={styles.priceAffix}>₦</Text>
          <TextInput
            value={groupDigits(cleanNumberInput(line.unitPrice))}
            onChangeText={(t) => onChange({ unitPrice: cleanNumberInput(t) })}
            keyboardType="decimal-pad"
            placeholder={hasDefault ? groupDigits(String(Number(item.lastPurchasePrice))) : 'Sale price'}
            placeholderTextColor={colors.placeholder}
            accessibilityLabel={`Sale price per unit for ${item.name}`}
            style={styles.priceInput}
          />
          <Text style={[styles.priceAffix, { fontSize: 12 }]}>each</Text>
        </View>
      </View>

      {calc.error ? (
        <View style={styles.error}>
          <Icon name="alert" size={14} color={colors.danger} strokeWidth={2} />
          <Text style={styles.errorText}>{calc.error}</Text>
        </View>
      ) : (
        <View style={styles.foot}>
          {calc.priceWasDefaulted ? (
            <Text style={[type.caption, { color: colors.primaryInk }]}>Last purchase price</Text>
          ) : (
            <Text style={type.caption}>
              {formatNumber(calc.qty)} × {formatMoney(calc.price)}
            </Text>
          )}
          <Text style={styles.total}>{calc.total !== null ? formatMoney(calc.total) : '—'}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 28 },
  headerAction: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingLeft: 8 },
  link: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primary },
  line: { padding: 14, gap: 10 },
  lineBorder: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  lineHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  name: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 19 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepper: {
    flexDirection: 'row', alignItems: 'center', height: 44, padding: 3, borderWidth: 1, borderColor: colors.lineStrong,
    borderRadius: 12, backgroundColor: colors.surface,
  },
  qtyInput: {
    width: 48, height: 36, textAlign: 'center', fontFamily: fonts.display, fontSize: 17, color: colors.ink,
    paddingVertical: 0, fontVariant: ['tabular-nums'],
  },
  priceBox: {
    flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 10,
    borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 12, backgroundColor: colors.surface,
  },
  priceAffix: { fontSize: 14, color: colors.ink3 },
  priceInput: { flex: 1, minWidth: 0, height: 40, fontFamily: fonts.regular, fontSize: 15, color: colors.ink, paddingVertical: 0 },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  total: { fontFamily: fonts.semibold, fontSize: 14, fontVariant: ['tabular-nums'] },
  error: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { flex: 1, fontFamily: fonts.medium, fontSize: 12, color: colors.danger },
  empty: { alignItems: 'center', gap: 4, paddingVertical: 24, paddingHorizontal: 18 },
  addRow: {
    height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderTopWidth: 1, borderTopColor: colors.lineStrong, borderStyle: 'dashed',
  },
});
