import React, { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { getLocalItems, getLastSyncedAt, getSyncStatusSummary, getLocalSubCompanies } from '../db/localDb';
import { getOversightSummary, getDebtors, getMoneyOut, getDueRepeats } from '../reports/localReports';
import { useLocalRefresh } from '../hooks/useLocalRefresh';
import { useOnline } from '../hooks/useOnline';
import { runSync } from '../sync/syncEngine';
import { isLowStock } from '../utils/inventory';
import { formatMoney, formatNumber, lastSyncedLabel, plural, timeAgo } from '../utils/format';
import { KIND_META } from '../utils/outflows';
import { SPENDING_KINDS } from '../reports/outflowMath';
import Icon from '../components/Icon';
import DueBill, { dueRecordValues } from '../components/DueBill';
import {
  Text, Screen, LargeHeader, IconButton, AccountButton, Pill, SectionTitle, ListCard, Divider,
  LetterTile, EmptyState, Loading,
} from '../components/ui';
import { colors, fonts, outflowColors, type } from '../theme';

// RPT-06: Main Company dashboard. If there are no linked Sub Companies, this simply shows
// an empty state below — a standalone company (ROLE-07) is not treated as an error state.
// Everything here is computed from this phone's database (companies, items, and transactions
// pulled by sync, plus unsynced local changes), so it works the same offline.
export default function DashboardScreen({ navigation }) {
  const { user, logout, allowSubCompanies } = useAuth();
  const [subCompanies, setSubCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [syncSummary, setSyncSummary] = useState({ total: 0 });
  const [summary, setSummary] = useState(null);
  const [debt, setDebt] = useState(null);
  const [moneyOut, setMoneyOut] = useState(null);
  const [dues, setDues] = useState([]);
  const online = useOnline();

  function load() {
    setSubCompanies(getLocalSubCompanies(user.companyId));
    setSummary(getOversightSummary(user));
    setDebt(getDebtors(user.companyId).totals);
    setMoneyOut(getMoneyOut(user).totals);
    setDues(getDueRepeats(user.companyId));
    // INV-05: own-company low-stock count only — not aggregated across Sub Companies.
    setLowStockCount(getLocalItems(user.companyId).filter(isLowStock).length);
    setSyncSummary(getSyncStatusSummary(user.id));
    setLoading(false);
  }

  useLocalRefresh(load);

  async function handleRefresh() {
    setRefreshing(true);
    await runSync(user.id);
    load();
    setRefreshing(false);
  }

  if (loading) return <Loading />;

  const totals = summary?.totals;
  const ownRow = summary?.companies?.find((c) => c.isMain);
  const statsById = new Map((summary?.companies || []).map((c) => [String(c.companyId), c]));
  const lastSynced = getLastSyncedAt(user.id);
  // Stock bought comes from the same transactions as the summary; other money out and savings
  // from recorded outflows. Falls back to the summary's stock cost before outflows have loaded.
  const out = moneyOut || { byKind: { stock: totals?.totalPurchaseCost || 0 }, spent: totals?.totalPurchaseCost || 0, savingsNet: 0 };
  const outKinds = SPENDING_KINDS.filter((k) => (out.byKind[k] || 0) > 0);
  const savingsNet = Math.max(0, out.savingsNet);
  const heroMax = totals ? Math.max(totals.totalSalesRevenue, out.spent, savingsNet) : 0;

  return (
    <Screen>
      <LargeHeader
        eyebrow={`${ownRow?.companyName || 'Your company'} · Main company`}
        title="Overview"
        right={
          <>
            <IconButton icon="bell" label="Alerts" dot={lowStockCount > 0} onPress={() => navigation.navigate('Alerts')} />
            <AccountButton user={user} onLogout={logout} />
          </>
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
      >
        <View style={styles.syncRow}>
          {syncSummary.total > 0 ? (
            <Pill kind="warn" icon="sync" label={`${plural(syncSummary.total, 'change')} waiting to sync`} />
          ) : (
            <Pill kind="ok" icon="check" label={lastSynced ? `All synced · ${timeAgo(lastSynced)}` : 'Not yet synced'} />
          )}
          <Text style={type.caption}>{online ? 'Pull down to refresh' : 'Offline · data on this phone'}</Text>
        </View>

        {debt && debt.outstanding > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens the list of people owing"
            onPress={() => navigation.navigate('Debtors')}
            style={({ pressed }) => [styles.debtRow, pressed && { backgroundColor: colors.surfaceMuted }]}
          >
            <Icon name="wallet" size={20} color={colors.danger} />
            <View style={{ flex: 1 }}>
              <Text style={styles.debtTitle}>{formatMoney(debt.outstanding)} owed to you</Text>
              <Text style={type.caption}>{plural(debt.customersOwing, 'customer')} owing · tap to see who</Text>
            </View>
            <Icon name="chev" size={18} color={colors.chevron} />
          </Pressable>
        )}

        {syncSummary.total > 0 && (
          <Text style={type.caption}>Figures below include the changes from this phone that haven't synced yet.</Text>
        )}

        {dues.slice(0, 2).map((d) => (
          <DueBill key={d.outflow.clientOutflowId} due={d} onRecord={() => navigation.navigate('MoneyOut', { record: dueRecordValues(d) })} />
        ))}

        {totals && (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens everything that went out"
            onPress={() => navigation.navigate('MoneyOut', { period: 'all' })}
            style={({ pressed }) => [styles.hero, pressed && { opacity: 0.92 }]}
          >
            <View style={styles.heroHead}>
              <Text style={styles.heroLabel}>Money in and out · all companies</Text>
              <View style={styles.heroMore}>
                <Text style={styles.heroMoreText}>Details</Text>
                <Icon name="chev" size={14} color="#FFFFFF" />
              </View>
            </View>
            <View style={styles.heroRows}>
              <HeroRow label="Money from sales" value={totals.totalSalesRevenue}>
                <View style={[styles.heroBar, { backgroundColor: colors.okOnDark, width: `${barWidth(totals.totalSalesRevenue, heroMax)}%` }]} />
              </HeroRow>
              <HeroRow label="Money out" value={out.spent}>
                <View style={[styles.heroStack, { width: `${barWidth(out.spent, heroMax)}%` }]}>
                  {outKinds.map((k) => (
                    <View key={k} style={{ flex: out.byKind[k], backgroundColor: outflowColors[k].onDark }} />
                  ))}
                </View>
              </HeroRow>
              {outKinds.length > 1 && (
                <View style={styles.legend}>
                  {outKinds.map((k) => (
                    <View key={k} style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: outflowColors[k].onDark }]} />
                      <Text style={styles.legendText}>{KIND_META[k].short}</Text>
                    </View>
                  ))}
                </View>
              )}
              {savingsNet > 0 && (
                <HeroRow label="Set aside in savings" value={savingsNet}>
                  <View style={[styles.heroBar, { backgroundColor: outflowColors.savings.onDark, width: `${barWidth(savingsNet, heroMax)}%` }]} />
                </HeroRow>
              )}
            </View>
            <View style={styles.heroDivider} />
            <Text style={styles.heroDiff}>{differenceSentence(totals.totalSalesRevenue, out.spent, savingsNet)}</Text>
            <Text style={styles.heroSync}>{lastSyncedLabel(lastSynced)}</Text>
          </Pressable>
        )}

        {totals && (
          <View style={styles.tiles}>
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Inventory')} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
              <View style={styles.tileLabelRow}>
                <Icon name="box" size={18} color={colors.ink3} />
                <Text style={styles.tileLabel}>Total items</Text>
              </View>
              <Text style={styles.tileValue}>{formatNumber(totals.itemCount)}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('Alerts')}
              style={({ pressed }) => [styles.tile, totals.lowStockCount > 0 && styles.tileDanger, pressed && styles.pressed]}
            >
              <View style={styles.tileLabelRow}>
                <Icon name="alert" size={18} color={totals.lowStockCount > 0 ? colors.danger : colors.ink3} />
                <Text style={[styles.tileLabel, totals.lowStockCount > 0 && { color: colors.danger }]}>Low stock</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={[styles.tileValue, totals.lowStockCount > 0 && { color: colors.danger }]}>{formatNumber(totals.lowStockCount)}</Text>
                <Text style={[styles.tileHint, totals.lowStockCount > 0 && { color: colors.danger }]}>
                  {lowStockCount} {lowStockCount === 1 ? 'is' : 'are'} yours
                </Text>
              </View>
            </Pressable>
          </View>
        )}

        {/* A company the SuperAdmin set up without Sub Companies doesn't see this section at all;
            if the option is turned off later, existing Sub Companies stay viewable. */}
        {(allowSubCompanies || subCompanies.length > 0) && (
          <>
            <SectionTitle
              title="Sub companies"
              right={
                allowSubCompanies && (
                  <View style={{ flexDirection: 'row' }}>
                    <Pressable accessibilityRole="button" onPress={() => navigation.navigate('CompareSubCompanies')} style={styles.headerLink}>
                      <Text style={styles.link}>Compare</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => navigation.navigate('ManageSubCompanies')} style={styles.headerLink}>
                      <Text style={styles.link}>Manage</Text>
                    </Pressable>
                  </View>
                )
              }
            />

            {subCompanies.length === 0 ? (
              <ListCard>
                <EmptyState
                  icon="building"
                  title="No Sub Companies linked yet"
                  body="You're using this app as a standalone company. Everything works the same whether or not you ever link a Sub Company."
                />
              </ListCard>
            ) : (
              <ListCard style={{ marginTop: -8 }}>
                {subCompanies.map((c, i) => {
                  const stats = statsById.get(String(c.id));
                  return (
                    <View key={String(c.id)}>
                      {i > 0 && <Divider />}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityHint="Opens a read-only view of this company"
                        onPress={() => navigation.navigate('CompanyInventory', { companyId: c.id, companyName: c.name })}
                        style={({ pressed }) => [styles.subRow, pressed && { backgroundColor: colors.surfaceMuted }]}
                      >
                        <LetterTile label={c.name} muted={!c.isActive} />
                        <View style={{ flex: 1, gap: 3 }}>
                          <Text style={[styles.subName, !c.isActive && { color: colors.ink2 }]} numberOfLines={1}>
                            {c.name}
                          </Text>
                          {c.isActive ? (
                            <Text style={type.small} numberOfLines={1}>
                              {stats ? `${plural(stats.itemCount, 'item')} · ` : ''}
                              {stats ? (
                                <Text style={[type.small, stats.lowStockCount > 0 && styles.lowText]}>{stats.lowStockCount} low stock</Text>
                              ) : (
                                'Active'
                              )}
                            </Text>
                          ) : (
                            <Text style={type.small}>Deactivated</Text>
                          )}
                        </View>
                        {stats && (
                          <View style={{ alignItems: 'flex-end', gap: 2 }}>
                            <Text style={styles.subMargin}>{formatMoney(Math.abs(stats.margin))}</Text>
                            <Text style={type.caption}>{stats.margin < 0 ? 'more on stock' : stats.margin > 0 ? 'more from sales' : 'sales = stock'}</Text>
                          </View>
                        )}
                        <Icon name="chev" size={18} color={colors.chevron} />
                      </Pressable>
                    </View>
                  );
                })}
              </ListCard>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 16 },
  syncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  debtRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  debtTitle: { fontFamily: fonts.semibold, fontSize: 15 },
  hero: { backgroundColor: colors.inkBg, borderRadius: 22, padding: 20, gap: 16 },
  heroHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  heroLabel: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 13, color: colors.onDarkMuted },
  heroMore: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  heroMoreText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.onInk },
  heroStack: { height: 6, flexDirection: 'row', gap: 2, borderRadius: 3, overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginTop: -6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 2 },
  legendText: { fontSize: 11, color: colors.onDarkMuted },
  heroRows: { gap: 14 },
  heroRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  heroStatLabel: { fontSize: 13, color: colors.onDarkMuted },
  heroValue: { flexShrink: 1, fontFamily: fonts.display, fontSize: 24, letterSpacing: -0.5, color: colors.onInk, fontVariant: ['tabular-nums'] },
  heroBarTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' },
  heroBar: { height: 6, borderRadius: 3 },
  heroDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
  heroDiff: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.onInk },
  heroSync: { fontSize: 11, color: colors.heroFaint },
  tiles: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 6 },
  tileDanger: { backgroundColor: colors.dangerSoft, borderColor: colors.dangerLine },
  tileLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tileLabel: { fontSize: 13, color: colors.ink3 },
  tileValue: { fontFamily: fonts.display, fontSize: 28, letterSpacing: -0.5 },
  tileHint: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink3 },
  pressed: { opacity: 0.75 },
  headerLink: { paddingVertical: 10, paddingLeft: 12 },
  link: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primary },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 14, paddingRight: 12, minHeight: 64 },
  subName: { fontFamily: fonts.semibold, fontSize: 15 },
  lowText: { color: colors.danger, fontFamily: fonts.medium },
  subMargin: { fontFamily: fonts.semibold, fontSize: 15, fontVariant: ['tabular-nums'] },
});

function barWidth(value, max) {
  if (!max || value <= 0) return 0;
  return Math.max(2, Math.round((value / max) * 100));
}

function HeroRow({ label, value, children }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.heroRowTop}>
        <Text style={styles.heroStatLabel}>{label}</Text>
        <Text style={styles.heroValue} adjustsFontSizeToFit numberOfLines={1}>
          {formatMoney(value)}
        </Text>
      </View>
      <View style={styles.heroBarTrack}>{children}</View>
    </View>
  );
}

// Plain-words result of money from sales against everything that went out and into savings, so
// the card never leads with a minus sign. Rounded to whole naira since it's a summary.
function differenceSentence(sales, spent, saved) {
  const left = sales - spent - saved;
  const amount = formatMoney(Math.round(Math.abs(left))).replace(/\.00$/, '');
  const what = saved > 0 ? 'spending and saving' : 'spending';
  if (Math.abs(left) < 0.005) return `Sales and ${what} are even so far`;
  if (left > 0) {
    const share = sales > 0 ? ` · ${Math.round((left / sales) * 100)}% of sales` : '';
    return `${amount} left from sales after ${what}${share}`;
  }
  return `${amount} more went out than came in from sales`;
}
