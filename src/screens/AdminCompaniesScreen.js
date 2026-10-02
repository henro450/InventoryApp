import React, { useCallback, useMemo, useState } from 'react';
import { View, FlatList, StyleSheet, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { getCached, setCached } from '../db/localDb';
import { formatDate, formatDateTime, formatSubscription } from '../utils/format';
import { useAuth } from '../context/AuthContext';
import {
  Text, Screen, LargeHeader, IconButton, AccountButton, SearchField, Card, LetterTile, Pill, Button, Banner, EmptyState,
  Loading, Field, Sheet, Segmented, Stepper,
} from '../components/ui';
import { tierFor, formatFee } from '../constants/registrationPricing';
import { isValidPhone } from '../utils/phone';
import { colors, fonts, type } from '../theme';

const YES_NO = [
  { key: 'yes', label: 'Yes' },
  { key: 'no', label: 'No' },
];
const EMPTY_FORM = { email: '', companyName: '', hasSubCompanies: 'no', subCount: '1', contactName: '', phone: '', price: '' };

// Subscription price field value -> API value: blank means no price (null); otherwise a number.
function parsePrice(input) {
  const text = String(input).replace(/,/g, '').trim();
  if (text === '') return { value: null };
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return { error: 'Enter a price of zero or more, or leave it blank.' };
  return { value };
}

// Sub-company answer -> the count the registration fee is priced on (at least 1 when "Yes").
function declaredCount(hasSubs, subCount) {
  return hasSubs === 'yes' ? Math.max(1, Math.floor(Number(subCount) || 0)) : 0;
}

// "Has sub-companies?" plus, when yes, how many — which sets the registration fee shown below it.
function SubCompanyFields({ hasSubs, onHasSubs, subCount, onSubCount, note }) {
  const tier = tierFor(declaredCount(hasSubs, subCount));
  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>Has sub-companies?</Text>
        <Segmented accessibilityLabel="Has sub-companies" options={YES_NO} value={hasSubs} onChange={onHasSubs} />
        {note}
      </View>
      {hasSubs === 'yes' && <Stepper label="How many sub-companies?" value={subCount} onChange={onSubCount} />}
      {tier && (
        <Text style={type.small}>
          Registration fee: <Text style={styles.strong}>{formatFee(tier.fee)}</Text> ({tier.label.toLowerCase()})
        </Text>
      )}
    </View>
  );
}

// One line about a company's registration for its card, e.g. "₦5,000 · 3 sub-companies declared · Signed up in the app".
function registrationLine(reg) {
  if (!reg) return null;
  const declared = reg.subCompanyCount === 0 ? 'No sub-companies' : `${reg.subCompanyCount} sub-${reg.subCompanyCount === 1 ? 'company' : 'companies'} declared`;
  return `${formatFee(reg.fee)} · ${declared}${reg.source === 'self_signup' ? ' · Signed up in the app' : ''}`;
}

function SubscriptionFields({ price, onPrice }) {
  return (
    <View style={{ gap: 8 }}>
      <Field label="Subscription price" optional prefix="₦" keyboardType="decimal-pad" placeholder="e.g. 25000" value={price} onChangeText={onPrice} />
      <Text style={type.caption}>
        What this company pays for each subscription period (set the number of days in Settings). Enter 0 to make the company free. Leave blank if it
        hasn't been agreed yet.
      </Text>
    </View>
  );
}

// SuperAdmin home: profile new Main Companies (email + company name + whether they have Sub
// Companies). The API emails the company's admin a link to set their password.
export default function AdminCompaniesScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState('');
  const [editSubs, setEditSubs] = useState('no');
  const [editSubCount, setEditSubCount] = useState('1');
  const [editContactName, setEditContactName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editPrice, setEditPrice] = useState('');
  // Subscription sheet: renew (add one period) or expire now.
  const [subCompany, setSubCompany] = useState(null);
  const [subAction, setSubAction] = useState(null); // 'renew' | 'expire' while a request runs
  const [subscriptionDays, setSubscriptionDays] = useState(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [resendingId, setResendingId] = useState(null);
  const [savedAt, setSavedAt] = useState(null); // showing the saved offline copy

  const load = useCallback(() => {
    setError(null);
    return api
      .adminListCompanies()
      .then(({ companies: list }) => {
        setCompanies(list);
        setSavedAt(null);
        setCached('adminCompanies', list);
      })
      .catch((err) => {
        const saved = getCached('adminCompanies');
        if (saved) {
          setCompanies(saved.data);
          setSavedAt(saved.savedAt);
        } else {
          setError(err.message);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const setField = (key) => (v) => setForm((f) => ({ ...f, [key]: v }));

  async function handleCreate() {
    const email = form.email.trim();
    const companyName = form.companyName.trim();
    if (!email || !companyName) {
      Alert.alert('Missing info', 'Email and company name are both required.');
      return;
    }
    if (form.phone.trim() && !isValidPhone(form.phone)) {
      Alert.alert('Check the phone number', 'Enter a valid phone number, or leave it blank.');
      return;
    }
    setSubmitting(true);
    try {
      const price = parsePrice(form.price);
      if (price.error) {
        Alert.alert('Check the price', price.error);
        setSubmitting(false);
        return;
      }
      const { emailSent } = await api.adminCreateCompany({
        email,
        companyName,
        allowSubCompanies: form.hasSubCompanies === 'yes',
        subCompanyCount: declaredCount(form.hasSubCompanies, form.subCount),
        contactName: form.contactName.trim() || undefined,
        phone: form.phone.trim() || undefined,
        ...(price.value !== null ? { subscriptionPrice: price.value } : {}),
      });
      setForm(EMPTY_FORM);
      setCreating(false);
      load();
      if (emailSent) {
        Alert.alert('Company registered', `We've emailed ${email} a link to set their password. They can log in once that's done.`);
      } else {
        Alert.alert(
          'Registered, email not sent',
          `${companyName} was registered, but the email to ${email} couldn't be sent. Use "Resend invite" to try again.`
        );
      }
    } catch (err) {
      Alert.alert('Could not register company', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(company) {
    setEditing(company);
    setEditName(company.name);
    const reg = company.registration;
    setEditSubs((reg ? reg.subCompanyCount > 0 : company.allowSubCompanies) ? 'yes' : 'no');
    setEditSubCount(String(Math.max(1, reg ? reg.subCompanyCount : company.subCompanyCount || 0)));
    setEditContactName(reg?.contactName || '');
    setEditPhone(reg?.phone || '');
    setEditPrice(company.subscription?.price !== null && company.subscription?.price !== undefined ? String(company.subscription.price) : '');
  }

  async function handleEditSave() {
    if (!editName.trim()) {
      Alert.alert('Name required', 'Please enter a company name.');
      return;
    }
    const price = parsePrice(editPrice);
    if (price.error) {
      Alert.alert('Check the price', price.error);
      return;
    }
    if (editPhone.trim() && !isValidPhone(editPhone)) {
      Alert.alert('Check the phone number', 'Enter a valid phone number, or leave it blank.');
      return;
    }
    setEditSubmitting(true);
    try {
      await api.adminUpdateCompany(editing.id, {
        companyName: editName.trim(),
        allowSubCompanies: editSubs === 'yes',
        subscriptionPrice: price.value,
        // Saving the edit sheet prices the registration too, including for companies registered
        // before sign-up existed. Blank contact fields clear them.
        subCompanyCount: declaredCount(editSubs, editSubCount),
        contactName: editContactName.trim() || null,
        phone: editPhone.trim() || null,
      });
      setEditing(null);
      load();
    } catch (err) {
      Alert.alert('Could not update company', err.message);
    } finally {
      setEditSubmitting(false);
    }
  }

  function openSubscription(company) {
    setSubCompany(company);
    if (subscriptionDays === null) {
      api
        .adminGetSettings()
        .then(({ settings }) => setSubscriptionDays(settings.subscriptionDays))
        .catch(() => {}); // the sheet falls back to "one subscription period"
    }
  }

  async function runSubscriptionAction(action) {
    const company = subCompany;
    setSubAction(action);
    try {
      if (action === 'renew') await api.adminRenewSubscription(company.id);
      else await api.adminExpireSubscription(company.id);
      setSubCompany(null);
      load();
    } catch (err) {
      Alert.alert("Couldn't update subscription", err.status ? err.message : 'This needs an internet connection.');
    } finally {
      setSubAction(null);
    }
  }

  function confirmExpire() {
    Alert.alert(
      'Expire subscription now?',
      `Stock in and sales stop straight away for ${subCompany.name} and its sub-companies, until the subscription is renewed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Expire now', style: 'destructive', onPress: () => runSubscriptionAction('expire') },
      ]
    );
  }

  async function handleResend(company) {
    setResendingId(company.id);
    try {
      const { email, emailSent } = await api.adminResendInvite(company.id);
      if (emailSent) Alert.alert('Invite sent', `A new link has been emailed to ${email}. Earlier links no longer work.`);
      else Alert.alert('Email not sent', "The invite couldn't be sent. Please try again in a moment.");
    } catch (err) {
      Alert.alert('Could not resend invite', err.message);
    } finally {
      setResendingId(null);
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.admin?.email || '').toLowerCase().includes(q) ||
        (c.registration?.contactName || '').toLowerCase().includes(q) ||
        (c.registration?.phone || '').includes(q)
    );
  }, [companies, query]);

  const pendingCount = companies.filter((c) => c.status === 'pending').length;
  const pendingTotal = companies.reduce((n, c) => n + (c.pendingPayments || 0), 0);

  const header = (
    <LargeHeader
      eyebrow="SuperAdmin"
      title="Companies"
      right={
        <>
          <IconButton icon="wallet" label="Proofs of payment" dot={pendingTotal > 0} onPress={() => navigation.navigate('AdminPayments')} />
          <IconButton icon="more" label="Subscription settings" onPress={() => navigation.navigate('AdminSettings')} />
          <IconButton icon="plus" label="Register a company" variant="soft" iconSize={22} onPress={() => setCreating(true)} />
          <AccountButton user={user} onLogout={logout} />
        </>
      }
    />
  );

  if (loading) {
    return (
      <Screen>
        {header}
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen>
      {header}
      <FlatList
        data={visible}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 14, paddingBottom: 14 }}>
            <Text style={type.small}>
              {companies.length === 1 ? '1 company' : `${companies.length} companies`} registered
              {pendingCount > 0 ? ` · ${pendingCount} waiting to set a password` : ''}.
            </Text>
            {error && <Banner kind="error" title="Couldn't load companies" subtitle={`Are you offline? ${error}`} actionLabel="Retry" onAction={handleRefresh} />}
            {savedAt && (
              <Banner
                kind="info"
                icon="cloud"
                title="Offline · registering or editing companies needs a connection"
                subtitle={`Showing the list saved ${formatDateTime(savedAt)}.`}
                actionLabel="Retry"
                onAction={handleRefresh}
              />
            )}
            {companies.length > 3 && <SearchField value={query} onChangeText={setQuery} placeholder="Search by company, email or contact" />}
          </View>
        }
        ListEmptyComponent={
          companies.length === 0 ? (
            <Card>
              <EmptyState icon="building" title="No companies yet" body="Register a company with its admin's email. They'll get a link to set their password.">
                <Button title="Register a company" icon="plus" height={48} onPress={() => setCreating(true)} style={{ marginTop: 8 }} />
              </EmptyState>
            </Card>
          ) : (
            <EmptyState icon="search" title="No matches" body="Try a different name or email." />
          )
        }
        renderItem={({ item }) => (
          <Card padding={16}>
            <View style={styles.topRow}>
              <LetterTile label={item.name} muted={!item.isActive} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.name} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={type.small} numberOfLines={1}>
                  {item.admin?.email || 'No admin'}
                </Text>
              </View>
              {!item.isActive ? (
                <Pill kind="muted" label="Deactivated" />
              ) : item.status === 'pending' ? (
                <Pill kind="warn" label="Invite pending" />
              ) : (
                <Pill kind="ok" label="Active" />
              )}
            </View>
            <View style={styles.subRow}>
              <Text style={[type.small, { flex: 1 }]}>
                Subscription:{' '}
                <Text style={[styles.strong, item.subscription?.status === 'expired' && { color: colors.danger }]}>{formatSubscription(item.subscription)}</Text>
              </Text>
              {item.pendingPayments > 0 && <Pill kind="warn" label={`${item.pendingPayments} to review`} />}
            </View>
            <Text style={type.small}>
              Registration:{' '}
              {item.registration ? (
                <Text style={styles.strong}>{registrationLine(item.registration)}</Text>
              ) : (
                <Text style={{ color: colors.ink3 }}>Not set. Use Edit to add the sub-company count.</Text>
              )}
            </Text>
            {item.registration && (item.registration.contactName || item.registration.phone) ? (
              <Text style={type.small} numberOfLines={1}>
                Contact: <Text style={styles.strong}>{[item.registration.contactName, item.registration.phone].filter(Boolean).join(' · ')}</Text>
              </Text>
            ) : null}
            <Text style={type.small}>
              Sub-companies: <Text style={styles.strong}>{item.allowSubCompanies ? 'Yes' : 'No'}</Text>
              {item.subCompanyCount > 0 ? ` · ${item.subCompanyCount} linked` : ''}
              {' · '}
              {item.userCount === 1 ? '1 user' : `${item.userCount || 0} users`}
            </Text>
            <View style={styles.actions}>
              <Button title="Edit" variant="secondary" icon="pencil" height={44} style={{ flex: 1 }} onPress={() => openEdit(item)} />
              <Button
                title="Subscription"
                variant="secondary"
                icon="calendar"
                height={44}
                style={{ flex: 1 }}
                onPress={() => openSubscription(item)}
              />
              <Button
                title="Users"
                variant="secondary"
                icon="user"
                height={44}
                style={{ flex: 1 }}
                onPress={() => navigation.navigate('AdminCompanyDetail', { companyId: item.id, companyName: item.name })}
              />
              {item.status === 'pending' && item.isActive && (
                <Button
                  title="Resend invite"
                  variant="secondary"
                  icon="mail"
                  height={44}
                  style={{ flex: 1 }}
                  loading={resendingId === item.id}
                  onPress={() => handleResend(item)}
                />
              )}
            </View>
          </Card>
        )}
      />

      <Sheet
        visible={creating}
        onClose={() => setCreating(false)}
        title="Register a company"
        description="We'll email the admin a link that opens the app so they can set their password."
        footer={
          <>
            <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setCreating(false)} />
            <Button title="Register & send" style={{ flex: 1 }} onPress={handleCreate} loading={submitting} />
          </>
        }
      >
        <Field
          label="Admin email"
          leadingIcon="mail"
          placeholder="admin@company.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={form.email}
          onChangeText={setField('email')}
        />
        <Field label="Company name" leadingIcon="building" placeholder="e.g. Brightstar Stores" value={form.companyName} onChangeText={setField('companyName')} />
        <Field label="Contact name" optional leadingIcon="user" placeholder="e.g. Ada Obi" value={form.contactName} onChangeText={setField('contactName')} />
        <Field label="Phone" optional leadingIcon="phone" placeholder="0803 123 4567" keyboardType="phone-pad" value={form.phone} onChangeText={setField('phone')} />
        <SubCompanyFields
          hasSubs={form.hasSubCompanies}
          onHasSubs={setField('hasSubCompanies')}
          subCount={form.subCount}
          onSubCount={setField('subCount')}
          note={<Text style={type.caption}>Only companies with sub-companies can add and manage them. You can change this later.</Text>}
        />
        <SubscriptionFields price={form.price} onPrice={setField('price')} />
      </Sheet>

      <Sheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title="Edit company"
        footer={
          <>
            <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setEditing(null)} />
            <Button title="Save" style={{ flex: 1 }} onPress={handleEditSave} loading={editSubmitting} />
          </>
        }
      >
        <Field label="Company name" leadingIcon="building" value={editName} onChangeText={setEditName} placeholder="Company name" />
        <Field label="Contact name" optional leadingIcon="user" placeholder="e.g. Ada Obi" value={editContactName} onChangeText={setEditContactName} />
        <Field label="Phone" optional leadingIcon="phone" placeholder="0803 123 4567" keyboardType="phone-pad" value={editPhone} onChangeText={setEditPhone} />
        <SubCompanyFields
          hasSubs={editSubs}
          onHasSubs={setEditSubs}
          subCount={editSubCount}
          onSubCount={setEditSubCount}
          note={
            editing && editSubs === 'no' && editing.subCompanyCount > 0 ? (
              <Text style={type.caption}>
                Its {editing.subCompanyCount} existing sub-{editing.subCompanyCount === 1 ? 'company stays' : 'companies stay'} viewable, but no new ones can be added.
              </Text>
            ) : null
          }
        />
        <SubscriptionFields price={editPrice} onPrice={setEditPrice} />
      </Sheet>

      <SubscriptionSheet
        company={subCompany}
        days={subscriptionDays}
        busy={subAction}
        onRenew={() => runSubscriptionAction('renew')}
        onExpire={confirmExpire}
        onClose={() => setSubCompany(null)}
      />
    </Screen>
  );
}

// Renew adds one subscription period: a running paid period is extended from its end (no days are
// lost), otherwise the period starts today. Expire ends the paid period and/or free trial now.
function SubscriptionSheet({ company, days, busy, onRenew, onExpire, onClose }) {
  const sub = company?.subscription;
  const status = sub?.status;
  const running = status === 'active' || status === 'trial';
  const period = days ? `${days} day${days === 1 ? '' : 's'}` : 'one subscription period';
  const paidEnd = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  const extending = status === 'active' && paidEnd && paidEnd > new Date();
  const newEnd = days ? new Date((extending ? paidEnd : new Date()).getTime() + days * 86400000) : null;
  const renewNote = extending
    ? `Adds ${period} to the current period${newEnd ? `, so it ends ${formatDate(newEnd)}` : ''}.`
    : `Starts a paid period today${newEnd ? ` that ends ${formatDate(newEnd)}` : ` for ${period}`}.`;
  return (
    <Sheet visible={!!company} onClose={onClose} title="Subscription" description={company?.name}>
      <Card padding={14} gap={6}>
        <Text style={type.small}>Current status</Text>
        <Text style={[styles.strong, { fontSize: 15 }, status === 'expired' && { color: colors.danger }]}>{formatSubscription(sub)}</Text>
      </Card>
      <View style={{ gap: 8 }}>
        <Button title={`Renew for ${period}`} icon="check" onPress={onRenew} loading={busy === 'renew'} disabled={!!busy} />
        <Text style={type.caption}>{renewNote} Use this when payment was confirmed without an uploaded proof.</Text>
      </View>
      {sub?.free ? (
        <Text style={type.caption}>This company is free (₦0), so it never expires. Set a price with Edit to be able to expire it.</Text>
      ) : running ? (
        <View style={{ gap: 8 }}>
          <Button title="Expire now" variant="danger" icon="x" onPress={onExpire} loading={busy === 'expire'} disabled={!!busy} />
          <Text style={type.caption}>
            Ends the {status === 'trial' ? 'free trial' : 'subscription'} now. Stock in and sales stop for this company and its sub-companies until it's renewed.
          </Text>
        </View>
      ) : (
        <Text style={type.caption}>Nothing is running, so there's nothing to expire.</Text>
      )}
      <Button title="Close" variant="secondary" height={48} onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontFamily: fonts.semibold, fontSize: 16 },
  strong: { fontFamily: fonts.semibold, color: colors.ink },
  label: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  actions: { flexDirection: 'row', gap: 8 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
