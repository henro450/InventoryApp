import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, KeyboardAvoidingView } from 'react-native';
import { api } from '../api/client';
import { Text, Screen, NavHeader, Field, Button, Banner, Note, Segmented, Stepper } from '../components/ui';
import PriceList from '../components/PriceList';
import { FALLBACK_REGISTRATION_TIERS, tierFor, formatFee } from '../constants/registrationPricing';
import { isValidPhone } from '../utils/phone';
import { colors, fonts, type } from '../theme';

const HAS_SUBS = [
  { key: 'no', label: 'No' },
  { key: 'yes', label: 'Yes' },
];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A new company registers itself. The registration fee follows how many sub-companies it has (see
// the price list). No payment is taken here: the API records the fee for the SuperAdmin and emails
// the admin a link to set their password, the same as a company the SuperAdmin registers.
export default function SignupScreen({ navigation }) {
  const [tiers, setTiers] = useState(FALLBACK_REGISTRATION_TIERS);
  const [form, setForm] = useState({ companyName: '', address: '', hasSubs: 'no', subCount: '1', contactName: '', email: '', phone: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null); // { email, companyName, fee, emailSent }
  const scrollRef = useRef(null);

  useEffect(() => {
    api
      .registrationPricing()
      .then(({ tiers: list }) => Array.isArray(list) && list.length && setTiers(list))
      .catch(() => {}); // offline: the built-in copy of the price list stays
  }, []);

  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: null }));
  };

  const subCompanyCount = form.hasSubs === 'yes' ? Math.max(1, Number(form.subCount) || 0) : 0;
  const tier = tierFor(subCompanyCount, tiers);

  function validate() {
    const next = {};
    if (!form.companyName.trim()) next.companyName = 'Enter your company name.';
    if (form.hasSubs === 'yes' && !(Number(form.subCount) >= 1)) next.subCount = 'Enter how many sub-companies you have.';
    if (!form.contactName.trim()) next.contactName = 'Enter your full name.';
    if (!EMAIL_PATTERN.test(form.email.trim())) next.email = 'Enter a valid email address.';
    if (!isValidPhone(form.phone)) next.phone = 'Enter a valid phone number.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    setError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const { emailSent, registration } = await api.signup({
        companyName: form.companyName.trim(),
        address: form.address.trim() || undefined,
        subCompanyCount,
        contactName: form.contactName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
      });
      setDone({ email: form.email.trim(), companyName: form.companyName.trim(), fee: registration?.fee ?? tier?.fee, emailSent });
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    } catch (err) {
      setError(err.message);
      scrollRef.current?.scrollToEnd({ animated: true });
    } finally {
      setSubmitting(false);
    }
  }

  function backToLogin() {
    navigation.reset({ index: 0, routes: [{ name: 'Login', params: done ? { email: done.email } : undefined }] });
  }

  return (
    <Screen>
      <NavHeader title="" onBack={() => (navigation.canGoBack() ? navigation.goBack() : backToLogin())} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <View style={{ gap: 8 }}>
            <Text style={styles.heading} accessibilityRole="header">
              {done ? 'Check your email' : 'Register your company'}
            </Text>
            <Text style={styles.subtitle}>
              {done
                ? `${done.companyName} is registered. We've sent ${done.email} a link to set your password.`
                : 'Tell us about your business. Your registration fee depends on how many sub-companies you have.'}
            </Text>
          </View>

          {done ? (
            <View style={{ gap: 16 }}>
              {done.emailSent ? (
                <Banner kind="ok" icon="mail" title="Open the link on this phone" subtitle="Set your password, then log in. The link expires, so use it soon." />
              ) : (
                <Banner
                  kind="warn"
                  title="We couldn't send the email"
                  subtitle={`Your company is registered. Use "Forgot password" on the log in screen with ${done.email} to get the link.`}
                />
              )}
              {done.fee !== undefined && (
                <Note icon="wallet">Your registration fee is {formatFee(done.fee)}. We'll contact you about payment.</Note>
              )}
              <Button title="Back to log in" onPress={backToLogin} />
            </View>
          ) : (
            <>
              <Section title="Your company">
                <Field
                  label="Company name"
                  leadingIcon="building"
                  placeholder="e.g. Brightstar Stores"
                  value={form.companyName}
                  onChangeText={set('companyName')}
                  error={errors.companyName}
                />
                <Field label="Address" optional placeholder="Street, city" value={form.address} onChangeText={set('address')} />
              </Section>

              <Section title="Sub-companies">
                <View style={{ gap: 8 }}>
                  <Text style={type.label}>Does your company have sub-companies?</Text>
                  <Segmented accessibilityLabel="Has sub-companies" options={HAS_SUBS} value={form.hasSubs} onChange={set('hasSubs')} />
                  <Text style={type.caption}>Sub-companies are branches or outlets with their own stock that report to you.</Text>
                </View>
                {form.hasSubs === 'yes' && (
                  <View style={{ gap: 6 }}>
                    <Stepper label="How many sub-companies?" value={form.subCount} onChange={set('subCount')} />
                    {errors.subCount ? <Text style={styles.error}>{errors.subCount}</Text> : null}
                  </View>
                )}
              </Section>

              <Section title="Registration fee">
                <PriceList tiers={tiers} activeKey={tier?.key} />
                {tier && (
                  <View style={styles.total}>
                    <Text style={type.small}>You pay</Text>
                    <Text style={styles.totalFee}>{formatFee(tier.fee)}</Text>
                  </View>
                )}
              </Section>

              <Section title="Your details">
                <Field
                  label="Full name"
                  leadingIcon="user"
                  placeholder="e.g. Ada Obi"
                  autoComplete="name"
                  textContentType="name"
                  value={form.contactName}
                  onChangeText={set('contactName')}
                  error={errors.contactName}
                />
                <Field
                  label="Work email"
                  leadingIcon="mail"
                  placeholder="you@company.com"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoComplete="email"
                  value={form.email}
                  onChangeText={set('email')}
                  error={errors.email}
                  hint="You'll log in with this email. We'll send your password link here."
                />
                <Field
                  label="Phone number"
                  leadingIcon="phone"
                  placeholder="0803 123 4567"
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  value={form.phone}
                  onChangeText={set('phone')}
                  error={errors.phone}
                />
              </Section>

              {error && <Banner kind="error" title="Couldn't register your company" subtitle={error} />}
              <View style={{ gap: 12 }}>
                <Button title={tier ? `Register · ${formatFee(tier.fee)}` : 'Register'} onPress={handleSubmit} loading={submitting} />
                <Text style={[type.caption, { textAlign: 'center' }]}>No payment is taken now. We'll contact you about paying the fee.</Text>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Section({ title, children }) {
  return (
    <View style={{ gap: 14 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 24, paddingTop: 8, paddingBottom: 40, gap: 28 },
  heading: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, letterSpacing: -0.7 },
  subtitle: { fontSize: 16, lineHeight: 24, color: colors.ink2 },
  sectionTitle: { fontFamily: fonts.medium, fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.ink3 },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger },
  total: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 4 },
  totalFee: { fontFamily: fonts.display, fontSize: 28, letterSpacing: -0.6, color: colors.ink },
});
