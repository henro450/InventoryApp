import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { api } from '../api/client';
import { Text, Screen, NavHeader, Card, SectionTitle, Field, Button, Banner, Loading } from '../components/ui';
import { type } from '../theme';

// SuperAdmin configuration: how long a paid subscription lasts, when and how often companies are
// reminded before it ends, and the account companies pay into (shown on their Subscription screen).
export default function AdminSettingsScreen({ navigation }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .adminGetSettings()
      .then(({ settings }) =>
        setForm({
          trialDays: String(settings.trialDays),
          subscriptionDays: String(settings.subscriptionDays),
          reminderDaysBefore: String(settings.reminderDaysBefore),
          remindersPerDay: String(settings.remindersPerDay),
          bankName: settings.paymentAccount.bankName || '',
          accountName: settings.paymentAccount.accountName || '',
          accountNumber: settings.paymentAccount.accountNumber || '',
          paymentInstructions: settings.paymentAccount.instructions || '',
        })
      )
      .catch((err) => setError(err.message));
  }, []);

  const set = (key) => (v) => setForm((f) => ({ ...f, [key]: v }));

  async function handleSave() {
    setSaving(true);
    try {
      await api.adminUpdateSettings({
        trialDays: Number(form.trialDays),
        subscriptionDays: Number(form.subscriptionDays),
        reminderDaysBefore: Number(form.reminderDaysBefore),
        remindersPerDay: Number(form.remindersPerDay),
        bankName: form.bankName,
        accountName: form.accountName,
        accountNumber: form.accountNumber,
        paymentInstructions: form.paymentInstructions,
      });
      Alert.alert('Settings saved', 'New subscription periods and reminders use these settings.');
      navigation.goBack();
    } catch (err) {
      Alert.alert("Couldn't save", err.status ? err.message : 'Saving settings needs an internet connection.');
    } finally {
      setSaving(false);
    }
  }

  if (!form) {
    return (
      <Screen>
        <NavHeader title="Subscription settings" />
        {error ? <Banner kind="error" title="Couldn't load settings" subtitle={`Are you offline? ${error}`} /> : <Loading />}
      </Screen>
    );
  }

  return (
    <Screen>
      <NavHeader title="Subscription settings" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Card padding={18} gap={14}>
            <SectionTitle title="Subscription period" />
            <Field
              label="Free trial (days)"
              keyboardType="number-pad"
              value={form.trialDays}
              onChangeText={set('trialDays')}
              hint="New companies use the app free for this many days from registration (0–366). Afterwards stock in and sales are paused until they pay. A price of ₦0 makes a company free."
            />
            <Field
              label="Days per payment"
              keyboardType="number-pad"
              value={form.subscriptionDays}
              onChangeText={set('subscriptionDays')}
              hint="A subscription runs this many days from the day you approve the payment (1–366)."
            />
          </Card>

          <Card padding={18} gap={14}>
            <SectionTitle title="Expiry reminders" />
            <Field
              label="Start reminding (days before expiry)"
              keyboardType="number-pad"
              value={form.reminderDaysBefore}
              onChangeText={set('reminderDaysBefore')}
              hint="Company admins start getting reminders this many days before the subscription ends (1–30)."
            />
            <Field
              label="Reminders per day"
              keyboardType="number-pad"
              value={form.remindersPerDay}
              onChangeText={set('remindersPerDay')}
              hint="How many phone notifications and pop-ups a day, spread between 9am and 6pm (1–6). Reminders continue for 3 days after expiry."
            />
          </Card>

          <Card padding={18} gap={14}>
            <SectionTitle title="Account to pay into" />
            <Text style={[type.caption, { marginTop: -6 }]}>Shown to company admins on their Subscription screen.</Text>
            <Field label="Bank" value={form.bankName} onChangeText={set('bankName')} placeholder="e.g. Zenith Bank" />
            <Field label="Account name" value={form.accountName} onChangeText={set('accountName')} placeholder="e.g. HenroTech Ltd" />
            <Field label="Account number" keyboardType="number-pad" value={form.accountNumber} onChangeText={set('accountNumber')} placeholder="10-digit NUBAN" mono />
            <Field
              label="Payment instructions"
              optional
              value={form.paymentInstructions}
              onChangeText={set('paymentInstructions')}
              placeholder="e.g. Use your company name as the narration"
              multiline
            />
          </Card>

          <View style={{ gap: 6 }}>
            <Button title="Save settings" onPress={handleSave} loading={saving} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 16 },
});
