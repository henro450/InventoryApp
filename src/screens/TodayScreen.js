import React, { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { getToday } from '../reports/localReports';
import { receiptNumber } from '../reports/salesMath';
import { runSync } from '../sync/syncEngine';
import { useLocalRefresh } from '../hooks/useLocalRefresh';
import { getLastSyncedAt } from '../db/localDb';
import { SPLIT_METHODS } from '../utils/payments';
import { KIND_META } from '../utils/outflows';
import { formatMoney, formatTime, lastSyncedLabel, plural } from '../utils/format';
import Icon from '../components/Icon';
import { Text, Screen, LargeHeader, AccountButton, Card, KV, Divider, SectionTitle, Button, InlineEmpty, Loading } from '../components/ui';
import { colors, fonts, type } from '../theme';

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

function methodsLine(byMethod) {
  const parts = SPLIT_METHODS.filter((m) => Number(byMethod[m.key]) > 0).map((m) => `${m.label} ${formatMoney(byMethod[m.key])}`);
  return parts.join(' · ');
}

const KIND_LABEL = (kind) => (kind === 'supplier' ? 'Paid to suppliers' : KIND_META[kind]?.label || 'Money out');

// Home tab for staff (not company admins): what I sold and took in today, and the cash I should
// have for the end-of-day handover. Worked out from this phone's records, so it works offline.
export default function TodayScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [day, setDay] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useLocalRefresh(() => setDay(getToday(user)));

  async function handleRefresh() {
    setRefreshing(true);
    await runSync(user.id);
    setDay(getToday(user));
    setRefreshing(false);
  }

  const firstName = String(user.name || '').trim().split(/\s+/)[0];
  const header = (
    <LargeHeader eyebrow={greeting() + (firstName ? `, ${firstName}` : '')} title="Today" right={<AccountButton user={user} onLogout={logout} />} />
  );

  if (!day) {
    return (
      <Screen>
        {header}
        <Loading />
      </Screen>
    );
  }

  const spentKinds = Object.entries(day.spentByKind).filter(([, v]) => v > 0);

  return (
    <Screen>
      {header}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
      >
        <View style={styles.hero} accessibilityRole="summary">
          <Text style={styles.heroLabel}>Cash you should have from today</Text>
          <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
            {formatMoney(Math.max(0, day.cashInHand))}
          </Text>
          <View style={styles.heroDivider} />
          <View style={styles.heroRow}>
            <Text style={styles.heroSmall}>Cash taken in</Text>
            <Text style={styles.heroSmallValue}>{formatMoney(day.cashIn)}</Text>
          </View>
          <View style={styles.heroRow}>
            <Text style={styles.heroSmall}>Cash paid out</Text>
            <Text style={styles.heroSmallValue}>{formatMoney(day.cashOut)}</Text>
          </View>
          {day.cashInHand < 0 && (
            <Text style={styles.heroNote}>You paid out {formatMoney(-day.cashInHand)} more cash than you took in today.</Text>
          )}
          <Text style={styles.heroFaint}>Not counting cash that was in the drawer this morning. {lastSyncedLabel(getLastSyncedAt(user.id))}</Text>
        </View>

        <View style={styles.tiles}>
          <Tile label="My sales" value={String(day.salesCount)} hint={day.salesCount ? formatMoney(day.sold) : 'None yet'} />
          <Tile label="Paid to me" value={formatMoney(day.received)} hint={day.owed > 0 ? `${formatMoney(day.owed)} owed` : 'Nothing owed'} />
        </View>

        <Card gap={10}>
          <Text style={type.bodyStrong}>Money in</Text>
          <KV label="From sales" value={formatMoney(day.received)} />
          {day.received > 0 && <Text style={type.caption}>{methodsLine(day.receivedByMethod)}</Text>}
          <KV label="From debtors" value={formatMoney(day.collected)} />
          {day.collected > 0 && <Text style={type.caption}>{methodsLine(day.collectedByMethod)}</Text>}
          <Divider />
          <Text style={type.bodyStrong}>Money out</Text>
          {spentKinds.length === 0 && day.refunded === 0 ? (
            <Text style={type.caption}>Nothing paid out today.</Text>
          ) : (
            <>
              {spentKinds.map(([kind, amount]) => (
                <KV key={kind} label={KIND_LABEL(kind)} value={formatMoney(amount)} />
              ))}
              {day.refunded > 0 && <KV label="Given back on returns" value={formatMoney(day.refunded)} />}
            </>
          )}
          <Divider />
          <Text style={type.caption}>Transfers and POS go to the bank, so they aren't in the cash above.</Text>
        </Card>

        <View style={styles.actions}>
          <Button title="Sell an item" icon="box" onPress={() => navigation.navigate('Inventory')} style={{ flex: 1 }} />
          <Button title="Expense" icon="receipt" variant="secondary" onPress={() => navigation.navigate('MoneyOut')} style={{ flex: 1 }} />
        </View>

        <View style={{ gap: 10 }}>
          <SectionTitle title="My sales today" />
          {day.sales.length === 0 ? (
            <InlineEmpty>Sales you record today show here.</InlineEmpty>
          ) : (
            <Card padding={0} gap={0}>
              {day.sales.slice(0, 20).map((s, index) => (
                <Pressable
                  key={s.key}
                  accessibilityRole="button"
                  onPress={() => navigation.navigate('SaleDetail', { saleKey: s.key })}
                  style={({ pressed }) => [styles.sale, index > 0 && styles.saleBorder, pressed && { backgroundColor: colors.surfaceMuted }]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.saleName} numberOfLines={1}>
                      {s.lines.length === 1 ? s.lines[0].itemName : plural(s.lines.length, 'item')}
                      {s.customerName ? ` · ${s.customerName}` : ''}
                    </Text>
                    <Text style={type.caption}>
                      {formatTime(s.occurredAt)} · #{receiptNumber(s.key)}
                      {s.owed > 0 ? ` · ${formatMoney(s.owed)} owed` : ''}
                      {s.status === 'voided' ? ' · cancelled' : s.status === 'returned' ? ' · items returned' : ''}
                    </Text>
                  </View>
                  <Text style={styles.saleTotal}>{formatMoney(s.total - s.returnedValue)}</Text>
                  <Icon name="chev" size={18} color={colors.ink3} />
                </Pressable>
              ))}
            </Card>
          )}
          {day.sales.length > 20 && (
            <Button title="See all sales" variant="ghost" height={44} onPress={() => navigation.navigate('Sales')} />
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function Tile({ label, value, hint }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.tileHint} numberOfLines={1}>
        {hint}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32, gap: 16 },
  hero: { backgroundColor: colors.inkBg, borderRadius: 22, padding: 20, gap: 8 },
  heroLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.onDarkMuted },
  heroValue: { fontFamily: fonts.display, fontSize: 36, letterSpacing: -0.8, color: colors.onInk, fontVariant: ['tabular-nums'] },
  heroDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.12)', marginVertical: 4 },
  heroRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  heroSmall: { fontSize: 13, color: colors.onDarkMuted },
  heroSmallValue: { fontFamily: fonts.semibold, fontSize: 14, color: colors.onInk, fontVariant: ['tabular-nums'] },
  heroNote: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.onInk },
  heroFaint: { fontSize: 11, lineHeight: 15, color: colors.heroFaint, marginTop: 4 },
  tiles: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 6 },
  tileLabel: { fontSize: 13, color: colors.ink3 },
  tileValue: { fontFamily: fonts.display, fontSize: 26, letterSpacing: -0.5 },
  tileHint: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink3 },
  actions: { flexDirection: 'row', gap: 12 },
  sale: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 16 },
  saleBorder: { borderTopWidth: 1, borderTopColor: colors.line },
  saleName: { fontFamily: fonts.semibold, fontSize: 14 },
  saleTotal: { fontFamily: fonts.semibold, fontSize: 14, fontVariant: ['tabular-nums'] },
});
