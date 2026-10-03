import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import Icon from './Icon';
import { Text, Sheet, Button, Field, Chip, Segmented, DateField, Checkbox, Note } from './ui';
import { saveLocalOutflow } from '../db/localDb';
import { OUTFLOW_KINDS } from '../reports/outflowMath';
import { KIND_META, PAYMENT_METHODS } from '../utils/outflows';
import { dateToYmd, formatMoney, ymdToDate } from '../utils/format';
import { colors, fonts, outflowColors, type } from '../theme';

const OTHER = '__other__';
const NEW_GOAL = '__new__';

// Record money going out: pick the kind first, then the amount and what it was for. Saved on the
// phone first (works offline) and synced like a sale. Regular users can record expenses only.
// `initial` pre-fills the form, e.g. from a "rent is due" reminder.
export default function RecordOutflowSheet({ visible, onClose, onSaved, user, isCompanyAdmin, goals = [], recentCategories = {}, initial }) {
  const kinds = isCompanyAdmin ? OUTFLOW_KINDS : ['expense'];
  const [kind, setKind] = useState('expense');
  const [amount, setAmount] = useState('');
  const [choice, setChoice] = useState(null); // chosen category chip, OTHER, a goal id, or NEW_GOAL
  const [custom, setCustom] = useState('');
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState(dateToYmd(new Date()));
  const [note, setNote] = useState('');
  const [repeats, setRepeats] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!visible) return;
    const start = initial?.kind && kinds.includes(initial.kind) ? initial.kind : 'expense';
    setKind(start);
    setAmount(initial?.amount ? String(initial.amount) : '');
    setMethod(initial?.paymentMethod || 'cash');
    setDate(dateToYmd(new Date()));
    setNote('');
    setRepeats(!!initial?.repeatsMonthly);
    setGoalName('');
    setGoalTarget('');
    setErrors({});
    pickDefaultChoice(start, initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function chipsFor(k) {
    const seen = new Set();
    return [...(KIND_META[k].presets || []), ...(recentCategories[k] || [])].filter((c) => {
      const key = c.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function pickDefaultChoice(k, from) {
    setCustom('');
    if (k === 'savings') {
      const goalId = from?.clientGoalId && goals.some((g) => g.clientGoalId === from.clientGoalId) ? from.clientGoalId : goals[0]?.clientGoalId;
      setChoice(goalId || NEW_GOAL);
      return;
    }
    const chips = chipsFor(k);
    const wanted = from?.category?.trim();
    const match = wanted && chips.find((c) => c.toLowerCase() === wanted.toLowerCase());
    if (match) setChoice(match);
    else if (wanted) {
      setChoice(OTHER);
      setCustom(wanted);
    } else setChoice(chips.length ? null : OTHER);
  }

  function changeKind(k) {
    if (k === kind) return;
    setKind(k);
    setErrors({});
    if (k !== 'expense' && k !== 'loan') setRepeats(false);
    pickDefaultChoice(k);
  }

  const meta = KIND_META[kind];
  const value = Math.round(Number(amount) * 100) / 100;
  const category = kind === 'savings' ? null : choice === OTHER ? custom.trim() : choice;
  const canRepeat = kind === 'expense' || kind === 'loan' || kind === 'tax';

  function save() {
    const next = {};
    if (!Number.isFinite(value) || value <= 0) next.amount = 'Enter an amount greater than zero.';
    if (kind === 'expense' && !category) next.category = 'Pick what the expense was for.';
    if (kind === 'savings' && choice === NEW_GOAL && !goalName.trim()) next.goal = 'Give the goal a name.';
    if (kind === 'savings' && choice === NEW_GOAL && goalTarget && !(Number(goalTarget) > 0)) next.goalTarget = 'Enter a target above zero, or leave it empty.';
    setErrors(next);
    if (Object.keys(next).length) return;

    const today = dateToYmd(new Date());
    // Today's entries keep the time they were recorded; a past date is stored at midday so it
    // stays on that day in every time zone near Nigeria's.
    const occurredAt = !date || date === today ? new Date().toISOString() : new Date(ymdToDate(date).setHours(12)).toISOString();
    const newGoal = kind === 'savings' && choice === NEW_GOAL
      ? { clientGoalId: uuidv4(), companyId: user.companyId, userId: user.id, name: goalName.trim(), targetAmount: goalTarget ? Number(goalTarget) : null }
      : null;
    saveLocalOutflow(
      {
        clientOutflowId: uuidv4(),
        companyId: user.companyId,
        userId: user.id,
        kind,
        category,
        clientGoalId: kind === 'savings' ? newGoal?.clientGoalId || choice : null,
        amount: value,
        paymentMethod: method,
        note,
        repeatsMonthly: canRepeat && repeats,
        occurredAt,
      },
      { newGoal }
    );
    onSaved?.(`Recorded ${formatMoney(value)} ${meta.noun}.`);
  }

  const chips = kind === 'savings' ? null : chipsFor(kind);
  const buttonLabel = value > 0 ? `Record ${formatMoney(value).replace(/\.00$/, '')} ${meta.noun}` : `Record ${meta.noun}`;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={isCompanyAdmin ? 'Record money out' : 'Record an expense'}
      footer={<Button title={buttonLabel} icon="check" style={{ flex: 1 }} onPress={save} />}
    >
      {kinds.length > 1 && (
        <View style={{ gap: 8 }}>
          <Text style={type.label}>What kind?</Text>
          <View style={styles.kindGrid}>
            {kinds.map((k) => {
              const active = k === kind;
              const tint = outflowColors[k];
              return (
                <Pressable
                  key={k}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => changeKind(k)}
                  style={({ pressed }) => [
                    styles.kind,
                    active && { borderColor: tint.ink, backgroundColor: tint.soft },
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <Icon name={KIND_META[k].icon} size={20} color={active ? tint.ink : colors.ink2} />
                  <Text style={[styles.kindText, active && { color: tint.ink }]}>{KIND_META[k].short}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      <Field label="Amount" prefix="₦" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} error={errors.amount} />

      {kind === 'savings' ? (
        <View style={{ gap: 8 }}>
          <Text style={type.label}>Which goal?</Text>
          <View style={styles.chips}>
            {goals.map((g) => (
              <Chip key={g.clientGoalId} label={g.name} active={choice === g.clientGoalId} onPress={() => setChoice(g.clientGoalId)} />
            ))}
            <Chip label="New goal" icon="plus" active={choice === NEW_GOAL} onPress={() => setChoice(NEW_GOAL)} />
          </View>
          {choice === NEW_GOAL && (
            <View style={{ gap: 12, marginTop: 4 }}>
              <Field label="Goal name" placeholder="e.g. Generator fund" value={goalName} onChangeText={setGoalName} error={errors.goal} />
              <Field label="Target" optional prefix="₦" keyboardType="decimal-pad" value={goalTarget} onChangeText={setGoalTarget} error={errors.goalTarget} />
            </View>
          )}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={type.label}>{meta.categoryLabel}</Text>
          {chips.length > 0 && (
            <View style={styles.chips}>
              {chips.map((c) => (
                <Chip key={c} label={c} active={choice === c} onPress={() => setChoice(c)} />
              ))}
              <Chip label="Other" active={choice === OTHER} onPress={() => setChoice(OTHER)} />
            </View>
          )}
          {choice === OTHER && (
            <Field
              placeholder={kind === 'withdrawal' ? 'Name' : kind === 'loan' ? 'e.g. LAPO loan' : kind === 'refund' ? 'Customer name' : 'What was it for?'}
              value={custom}
              onChangeText={setCustom}
              accessibilityLabel={meta.categoryLabel}
            />
          )}
          {errors.category ? <Text style={styles.error}>{errors.category}</Text> : null}
        </View>
      )}

      {meta.hint ? <Note kind="info">{meta.hint}</Note> : null}
      {kind === 'savings' ? <Note kind="ok" icon="piggy">Savings leave the till but aren't counted as spending.</Note> : null}

      <View style={{ gap: 8 }}>
        <Text style={type.label}>Paid with</Text>
        <Segmented accessibilityLabel="Paid with" options={PAYMENT_METHODS} value={method} onChange={setMethod} />
      </View>
      <DateField label="Date" value={date} onChange={setDate} maximumDate={dateToYmd(new Date())} />
      <Field label="Note" optional placeholder="e.g. 25 litres for the shop generator" value={note} onChangeText={setNote} maxLength={500} />
      {canRepeat && (
        <Checkbox
          label="Repeats every month"
          hint="You'll see a reminder on the Overview a few days before it's due again."
          checked={repeats}
          onChange={setRepeats}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kind: {
    flexBasis: '31%', flexGrow: 1, minHeight: 64, borderWidth: 1, borderColor: colors.line, borderRadius: 14,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8,
  },
  kindText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  error: { fontSize: 12, color: colors.danger, fontFamily: fonts.medium },
});
