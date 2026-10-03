import React, { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../context/AuthContext';
import { getSavings, getRecentCategories } from '../reports/localReports';
import { saveLocalOutflow, saveLocalSavingsGoal, updateLocalSavingsGoal } from '../db/localDb';
import { runSync } from '../sync/syncEngine';
import { useLocalRefresh } from '../hooks/useLocalRefresh';
import { dateToYmd, formatMoney, formatYmd } from '../utils/format';
import { PAYMENT_METHODS } from '../utils/outflows';
import Icon from '../components/Icon';
import RecordOutflowSheet from '../components/RecordOutflowSheet';
import {
  Text, Screen, NavHeader, Card, ListCard, Button, Field, Segmented, Sheet, Chip, DateField, EmptyState, IconButton, Note,
} from '../components/ui';
import { colors, fonts, type } from '../theme';

const short = (n) => formatMoney(n).replace(/\.00$/, '');

// Savings goals (company admins): money set aside for rent, a generator, emergencies. Putting
// money in is recorded as money out of the till; taking it out puts it back. Balances come from
// those entries, so every phone agrees once they sync.
export default function SavingsScreen() {
  const { user, isCompanyAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [recent, setRecent] = useState({});
  const [adding, setAdding] = useState(null); // RecordOutflowSheet initial values
  const [takeOut, setTakeOut] = useState(null); // { goalId }
  const [takeAmount, setTakeAmount] = useState('');
  const [takeMethod, setTakeMethod] = useState('cash');
  const [takeError, setTakeError] = useState(null);
  const [goalSheet, setGoalSheet] = useState(false);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDate, setGoalDate] = useState('');
  const [goalErrors, setGoalErrors] = useState({});
  const [selected, setSelected] = useState(null);

  function load() {
    setData(getSavings(user.companyId));
    setRecent(getRecentCategories(user.companyId));
  }
  useLocalRefresh(load);

  if (!data) return <Screen><NavHeader title="Savings" /></Screen>;
  const active = data.goals.filter((g) => g.isActive);

  function synced(message) {
    load();
    runSync(user.id);
    if (message) Alert.alert('Saved', message);
  }

  function openTakeOut(goalId) {
    setSelected(null);
    setTakeAmount('');
    setTakeMethod('cash');
    setTakeError(null);
    setTakeOut({ goalId: goalId || data.goals.find((g) => g.saved > 0)?.clientGoalId || null });
  }

  function saveTakeOut() {
    const goal = data.goals.find((g) => g.clientGoalId === takeOut.goalId);
    const value = Math.round(Number(takeAmount) * 100) / 100;
    if (!goal) return setTakeError('Pick the goal the money comes from.');
    if (!Number.isFinite(value) || value <= 0) return setTakeError('Enter an amount greater than zero.');
    if (value > goal.saved + 0.005) return setTakeError(`${goal.name} has ${short(Math.max(0, goal.saved))}. Enter that or less.`);
    saveLocalOutflow({
      clientOutflowId: uuidv4(),
      companyId: user.companyId,
      userId: user.id,
      kind: 'savings_return',
      clientGoalId: goal.clientGoalId,
      amount: value,
      paymentMethod: takeMethod,
      occurredAt: new Date().toISOString(),
    });
    setTakeOut(null);
    synced(`${short(value)} taken out of ${goal.name} and back into ${takeMethod === 'transfer' ? 'the bank' : 'cash'}.`);
  }

  function openNewGoal() {
    setGoalName('');
    setGoalTarget('');
    setGoalDate('');
    setGoalErrors({});
    setGoalSheet(true);
  }

  function saveGoal() {
    const errors = {};
    if (!goalName.trim()) errors.name = 'Give the goal a name.';
    if (goalTarget && !(Number(goalTarget) > 0)) errors.target = 'Enter a target above zero, or leave it empty.';
    setGoalErrors(errors);
    if (Object.keys(errors).length) return;
    saveLocalSavingsGoal({
      clientGoalId: uuidv4(),
      companyId: user.companyId,
      userId: user.id,
      name: goalName.trim(),
      targetAmount: goalTarget ? Number(goalTarget) : null,
      targetDate: goalDate || null,
    });
    setGoalSheet(false);
    synced();
  }

  function closeGoal(goal) {
    Alert.alert(`Close ${goal.name}?`, 'It stops showing as a goal. Its past entries stay in Money out.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close goal',
        style: 'destructive',
        onPress: () => {
          updateLocalSavingsGoal(goal, { isActive: false }, user.id);
          setSelected(null);
          synced();
        },
      },
    ]);
  }

  return (
    <Screen>
      <NavHeader title="Savings" right={isCompanyAdmin ? <IconButton icon="plus" label="New goal" variant="ghost" onPress={openNewGoal} /> : null} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Saved across all goals</Text>
          <Text style={styles.heroValue} adjustsFontSizeToFit numberOfLines={1}>{short(data.total)}</Text>
          <Text style={styles.heroSub}>{data.addedThisMonth > 0 ? `${short(data.addedThisMonth)} added this month` : 'Nothing added this month yet'}</Text>
          {isCompanyAdmin && (
            <View style={styles.heroButtons}>
              <Pressable accessibilityRole="button" onPress={() => setAdding({ kind: 'savings' })} style={({ pressed }) => [styles.heroBtn, styles.heroBtnPrimary, pressed && { opacity: 0.85 }]}>
                <Icon name="plus" size={17} color="#FFFFFF" strokeWidth={2.2} />
                <Text style={[styles.heroBtnText, { color: '#FFFFFF' }]}>Add money</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={data.total <= 0}
                onPress={() => openTakeOut()}
                style={({ pressed }) => [styles.heroBtn, styles.heroBtnSecondary, (pressed || data.total <= 0) && { opacity: data.total <= 0 ? 0.5 : 0.85 }]}
              >
                <Icon name="upload" size={17} color={colors.ok} strokeWidth={2.2} />
                <Text style={[styles.heroBtnText, { color: colors.ok }]}>Take out</Text>
              </Pressable>
            </View>
          )}
        </View>

        <Text style={type.heading}>Goals</Text>
        {data.goals.length === 0 ? (
          <ListCard>
            <EmptyState icon="piggy" title="No savings goals yet" body="Set money aside for next year's rent, a new generator, or emergencies, and watch it add up.">
              {isCompanyAdmin && <Button title="Create a goal" icon="plus" height={46} onPress={openNewGoal} style={{ marginTop: 8 }} />}
            </EmptyState>
          </ListCard>
        ) : (
          data.goals.map((g) => (
            <Pressable key={g.clientGoalId} accessibilityRole="button" onPress={() => setSelected(g)} style={({ pressed }) => pressed && { opacity: 0.85 }}>
              <Card padding={16} gap={10}>
                <View style={styles.goalTop}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.goalName}>{g.name}{g.isActive ? '' : ' · closed'}</Text>
                    <Text style={type.caption}>
                      {g.target ? `${short(g.saved)} of ${short(g.target)}` : 'No target · keep adding'}
                      {g.targetDate ? ` · by ${formatYmd(g.targetDate)}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.goalValue}>{g.target ? `${Math.round(g.progress * 100)}%` : short(g.saved)}</Text>
                </View>
                {g.target ? (
                  <View style={styles.track}><View style={[styles.fill, { width: `${Math.max(2, g.progress * 100)}%` }]} /></View>
                ) : null}
                {g.perWeek && g.isActive ? <Note kind="ok" icon="clock">Put aside {short(g.perWeek)} a week to reach it on time.</Note> : null}
              </Card>
            </Pressable>
          ))
        )}
        {active.length === 0 && data.goals.length > 0 && <Text style={type.caption}>Closed goals show here while they still hold money.</Text>}
      </ScrollView>

      <RecordOutflowSheet
        visible={!!adding}
        initial={adding}
        onClose={() => setAdding(null)}
        onSaved={(message) => { setAdding(null); synced(message); }}
        user={user}
        isCompanyAdmin={isCompanyAdmin}
        goals={active}
        recentCategories={recent}
      />

      <Sheet
        visible={!!takeOut}
        onClose={() => setTakeOut(null)}
        title="Take money out"
        description="It goes back into cash or the bank, so it counts as money in hand again."
        footer={<Button title="Take out" style={{ flex: 1 }} onPress={saveTakeOut} />}
      >
        <View style={{ gap: 8 }}>
          <Text style={type.label}>From</Text>
          <View style={styles.chips}>
            {data.goals.filter((g) => g.saved > 0).map((g) => (
              <Chip key={g.clientGoalId} label={`${g.name} · ${short(g.saved)}`} active={takeOut?.goalId === g.clientGoalId} onPress={() => setTakeOut({ goalId: g.clientGoalId })} />
            ))}
          </View>
        </View>
        <Field label="Amount" prefix="₦" keyboardType="decimal-pad" value={takeAmount} onChangeText={setTakeAmount} error={takeError} />
        <View style={{ gap: 8 }}>
          <Text style={type.label}>Back into</Text>
          <Segmented accessibilityLabel="Back into" options={PAYMENT_METHODS.map((m) => ({ ...m, label: m.key === 'transfer' ? 'Bank' : 'Cash' }))} value={takeMethod} onChange={setTakeMethod} />
        </View>
      </Sheet>

      <Sheet
        visible={goalSheet}
        onClose={() => setGoalSheet(false)}
        title="New savings goal"
        footer={<Button title="Create goal" style={{ flex: 1 }} onPress={saveGoal} />}
      >
        <Field label="Name" placeholder="e.g. Generator fund" value={goalName} onChangeText={setGoalName} error={goalErrors.name} maxLength={120} />
        <Field label="Target" optional prefix="₦" keyboardType="decimal-pad" value={goalTarget} onChangeText={setGoalTarget} error={goalErrors.target} />
        <DateField label="Reach it by (optional)" value={goalDate} onChange={setGoalDate} minimumDate={dateToYmd(new Date())} />
      </Sheet>

      <Sheet visible={!!selected} onClose={() => setSelected(null)} title={selected?.name || ''} description={selected ? `${short(selected.saved)} saved${selected.target ? ` of ${short(selected.target)}` : ''}` : undefined}>
        {selected && isCompanyAdmin && (
          <View style={{ gap: 10 }}>
            {selected.isActive && <Button title="Add money" icon="plus" height={48} onPress={() => { const goalId = selected.clientGoalId; setSelected(null); setAdding({ kind: 'savings', clientGoalId: goalId }); }} />}
            {selected.saved > 0 && <Button title="Take money out" variant="secondary" icon="upload" height={48} onPress={() => openTakeOut(selected.clientGoalId)} />}
            {selected.isActive && <Button title="Close goal" variant="danger" icon="x" height={48} onPress={() => closeGoal(selected)} />}
          </View>
        )}
        <Button title="Done" variant="ghost" height={44} onPress={() => setSelected(null)} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 14 },
  hero: { backgroundColor: colors.okSoft, borderWidth: 1, borderColor: '#BFE0CC', borderRadius: 22, padding: 18, gap: 4 },
  heroLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.ok },
  heroValue: { fontFamily: fonts.display, fontSize: 34, letterSpacing: -0.8, color: '#0F5434', fontVariant: ['tabular-nums'] },
  heroSub: { fontSize: 13, color: '#2F6B4C' },
  heroButtons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  heroBtn: { flex: 1, height: 46, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  heroBtnPrimary: { backgroundColor: colors.ok },
  heroBtnSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: '#BFE0CC' },
  heroBtnText: { fontFamily: fonts.semibold, fontSize: 14 },
  goalTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  goalName: { fontFamily: fonts.semibold, fontSize: 15.5 },
  goalValue: { fontFamily: fonts.display, fontSize: 20, color: colors.ok, fontVariant: ['tabular-nums'] },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.track, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.ok },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
