import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, Image, KeyboardAvoidingView } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api, API_BASE_URL, authHeaders } from '../api/client';
import { getLocalCompany, upsertLocalCompany } from '../db/localDb';
import { fingerprintAvailable } from '../auth/biometrics';
import { APPEARANCES, getAppearancePref, setAppearancePref, needsRestartFor } from '../theme/scheme';
import { chooseItemPhoto } from '../utils/itemPhotos';
import { readAsBase64 } from '../utils/files';
import { appVersionLabel, canRestartApp, checkForAppUpdate, restartApp } from '../utils/appUpdates';
import { formatPhone } from '../utils/phone';
import {
  Text, Screen, NavHeader, Card, SectionTitle, Field, Button, Segmented, Note, Checkbox, IconButton, LetterTile,
} from '../components/ui';
import { colors, fonts, type } from '../theme';

const MIN_PASSWORD = 8;

// Account and settings: the user's own name and password, how the app looks, fingerprint login,
// and (for company admins) the company details printed on receipts. Saving needs the internet;
// appearance and fingerprint are kept on this phone.
export default function AccountScreen({ navigation }) {
  const { user, isCompanyAdmin, logout, fingerprintEnabled, enableFingerprint, turnOffFingerprint, forgetFingerprint, updateUser } = useAuth();

  return (
    <Screen>
      <NavHeader title="Account and settings" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <ProfileSection user={user} updateUser={updateUser} />
          {isCompanyAdmin && <CompanySection user={user} updateUser={updateUser} />}
          <AppearanceSection />
          <PasswordSection forgetFingerprint={forgetFingerprint} fingerprintEnabled={fingerprintEnabled} />
          <FingerprintSection enabled={fingerprintEnabled} onEnable={enableFingerprint} onDisable={turnOffFingerprint} />
          <AboutSection />
          {isCompanyAdmin && (
            <View style={{ gap: 10 }}>
              <Button title="Subscription" variant="secondary" icon="wallet" height={48} onPress={() => navigation.navigate('Subscription')} />
              <Button title="Manage users" variant="secondary" icon="user" height={48} onPress={() => navigation.navigate('CompanyUsers')} />
            </View>
          )}
          <Button title="Log out" variant="danger" icon="x" onPress={logout} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function ProfileSection({ user, updateUser }) {
  const [name, setName] = useState(user.name || '');
  const [saving, setSaving] = useState(false);
  const changed = name.trim() !== (user.name || '') && name.trim() !== '';

  async function save() {
    setSaving(true);
    try {
      const { user: fresh } = await api.updateProfile(name.trim());
      await updateUser({ name: fresh?.name ?? name.trim() });
      Alert.alert('Name saved');
    } catch (err) {
      Alert.alert("Couldn't save your name", err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.section}>
      <SectionTitle title="You" />
      <Card>
        <Field label="Your name" value={name} onChangeText={setName} placeholder="e.g. Ada Obi" autoCapitalize="words" maxLength={100} />
        <View style={{ gap: 4 }}>
          <Text style={type.label}>Email</Text>
          <Text style={styles.readOnly}>{user.email}</Text>
          <Text style={type.caption}>Ask your company admin if your email needs changing.</Text>
        </View>
        {changed && <Button title="Save name" height={48} loading={saving} onPress={save} />}
      </Card>
    </View>
  );
}

function CompanySection({ user, updateUser }) {
  const local = getLocalCompany(user.companyId) || {};
  const start = { ...local, ...(user.company || {}) };
  const [name, setName] = useState(start.name || '');
  const [phone, setPhone] = useState(start.phone ? formatPhone(start.phone) : '');
  const [address, setAddress] = useState(start.address || '');
  const [saving, setSaving] = useState(false);
  const [logo, setLogo] = useState({ mimeType: start.logoMimeType || null, updatedAt: start.logoUpdatedAt || null });
  const [logoBusy, setLogoBusy] = useState(false);

  const changed =
    name.trim() !== (start.name || '') ||
    phone.replace(/\D/g, '') !== String(start.phone || '').replace(/\D/g, '') ||
    address.trim() !== (start.address || '');

  async function applyCompany(company) {
    if (!company) return;
    upsertLocalCompany(company);
    await updateUser({
      company: {
        name: company.name, phone: company.phone, address: company.address,
        logoMimeType: company.logoMimeType, logoUpdatedAt: company.logoUpdatedAt,
      },
    });
  }

  async function save() {
    if (!name.trim()) {
      Alert.alert('Company name', 'Enter the company name.');
      return;
    }
    setSaving(true);
    try {
      const { company } = await api.updateCompanyDetails({ name: name.trim(), phone: phone.trim(), address: address.trim() });
      await applyCompany(company);
      Alert.alert('Company details saved', 'New receipts show these details.');
    } catch (err) {
      Alert.alert("Couldn't save company details", err.message);
    } finally {
      setSaving(false);
    }
  }

  async function changeLogo() {
    const picked = await chooseItemPhoto({ title: 'Company logo', what: 'your logo or sign' });
    if (!picked) return;
    setLogoBusy(true);
    try {
      const { company } = await api.uploadCompanyLogo(await readAsBase64(picked));
      await applyCompany(company);
      setLogo({ mimeType: company.logoMimeType, updatedAt: company.logoUpdatedAt });
    } catch (err) {
      Alert.alert("Couldn't save the logo", err.message);
    } finally {
      setLogoBusy(false);
    }
  }

  function removeLogo() {
    Alert.alert('Remove the logo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setLogoBusy(true);
          try {
            const { company } = await api.deleteCompanyLogo();
            await applyCompany(company);
            setLogo({ mimeType: null, updatedAt: null });
          } catch (err) {
            Alert.alert("Couldn't remove the logo", err.message);
          } finally {
            setLogoBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.section}>
      <SectionTitle title="Company" />
      <Card>
        <View style={styles.logoRow}>
          <CompanyLogo companyId={user.companyId} name={name} logo={logo} />
          <View style={{ flex: 1, gap: 8 }}>
            <Text style={type.label}>Logo <Text style={type.caption}>(optional)</Text></Text>
            <View style={styles.row}>
              <Button title={logo.mimeType ? 'Change' : 'Add logo'} variant="secondary" icon="camera" height={40} loading={logoBusy} onPress={changeLogo} />
              {logo.mimeType && !logoBusy && <Button title="Remove" variant="ghost" height={40} onPress={removeLogo} />}
            </View>
          </View>
        </View>
        <Field label="Company name" value={name} onChangeText={setName} placeholder="Your shop or business name" maxLength={100} />
        <Field
          label="Phone"
          optional
          value={phone}
          onChangeText={setPhone}
          placeholder="e.g. 0803 123 4567"
          keyboardType="phone-pad"
          grouping={false}
          leadingIcon="phone"
        />
        <Field label="Address" optional value={address} onChangeText={setAddress} placeholder="e.g. 12 Market Road, Ibadan" maxLength={200} />
        <Text style={type.caption}>The name, phone and address appear at the top of the receipts you share.</Text>
        {changed && <Button title="Save company details" height={48} loading={saving} onPress={save} />}
      </Card>
    </View>
  );
}

// The company's logo from the server (signed in), or its first letter.
function CompanyLogo({ companyId, name, logo }) {
  const [source, setSource] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    if (!logo.mimeType) {
      setSource(null);
      return undefined;
    }
    authHeaders().then((headers) => {
      // The time in the address makes a new logo load instead of a remembered one.
      const stamp = encodeURIComponent(logo.updatedAt || '');
      if (live) setSource({ uri: `${API_BASE_URL}/companies/${companyId}/logo?v=${stamp}`, headers });
    });
    return () => {
      live = false;
    };
  }, [companyId, logo.mimeType, logo.updatedAt]);

  if (!source || failed) return <LetterTile label={name} size={64} />;
  return <Image source={source} style={styles.logo} resizeMode="cover" onError={() => setFailed(true)} accessibilityLabel="Company logo" />;
}

function AppearanceSection() {
  const [pref, setPref] = useState(getAppearancePref);
  const restart = needsRestartFor(pref);

  function choose(value) {
    setPref(value);
    setAppearancePref(value);
  }

  return (
    <View style={styles.section}>
      <SectionTitle title="Appearance" />
      <Card>
        <Segmented options={APPEARANCES} value={pref} onChange={choose} accessibilityLabel="Appearance" />
        <Text style={type.caption}>
          {pref === 'system' ? 'Light or dark, following your phone’s dark mode setting.' : `Always ${pref}, whatever your phone is set to.`}
        </Text>
        {restart &&
          (canRestartApp() ? (
            <View style={{ gap: 10 }}>
              <Note icon="info">The app needs to restart to show the change.</Note>
              <Button title="Restart now" variant="secondary" height={44} onPress={() => restartApp().catch(() => {})} />
            </View>
          ) : (
            <Note icon="info">Close and reopen the app to see the change.</Note>
          ))}
      </Card>
    </View>
  );
}

function PasswordSection({ forgetFingerprint, fingerprintEnabled }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready = current && next.length >= MIN_PASSWORD && confirm === next;

  async function save() {
    if (next === current) {
      Alert.alert('Choose a new password', 'The new password is the same as the current one.');
      return;
    }
    setSaving(true);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      if (fingerprintEnabled) await forgetFingerprint();
      Alert.alert(
        'Password changed',
        fingerprintEnabled
          ? 'Use the new password next time you log in. Fingerprint login was turned off; you can turn it on again below.'
          : 'Use the new password next time you log in.'
      );
    } catch (err) {
      Alert.alert("Couldn't change the password", err.message);
    } finally {
      setSaving(false);
    }
  }

  const eye = (
    <IconButton icon={show ? 'eyeoff' : 'eye'} label={show ? 'Hide passwords' : 'Show passwords'} variant="ghost" size={40} onPress={() => setShow((v) => !v)} />
  );

  return (
    <View style={styles.section}>
      <SectionTitle title="Password" />
      <Card>
        <Field
          label="Current password"
          value={current}
          onChangeText={setCurrent}
          secureTextEntry={!show}
          textContentType="password"
          autoComplete="password"
          autoCapitalize="none"
          trailing={eye}
        />
        <Field
          label="New password"
          value={next}
          onChangeText={setNext}
          secureTextEntry={!show}
          textContentType="newPassword"
          autoComplete="password-new"
          autoCapitalize="none"
          error={tooShort ? `At least ${MIN_PASSWORD} characters` : undefined}
          hint={tooShort ? undefined : `At least ${MIN_PASSWORD} characters.`}
        />
        <Field
          label="New password again"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry={!show}
          textContentType="newPassword"
          autoCapitalize="none"
          error={mismatch ? "Doesn't match the new password" : undefined}
        />
        <Button title="Change password" height={48} disabled={!ready} loading={saving} onPress={save} />
      </Card>
    </View>
  );
}

function FingerprintSection({ enabled, onEnable, onDisable }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    fingerprintAvailable().then(setAvailable);
  }, []);
  if (!available && !enabled) return null;
  return (
    <View style={styles.section}>
      <SectionTitle title="Fingerprint login" />
      <Card>
        <Checkbox
          label="Log in with my fingerprint on this phone"
          hint="Turning it on needs the internet."
          checked={enabled}
          onChange={(on) => (on ? onEnable() : onDisable())}
        />
      </Card>
    </View>
  );
}

function AboutSection() {
  const [status, setStatus] = useState(null); // null | 'checking' | 'ready' | 'none' | 'error'
  if (!canRestartApp()) {
    return <Text style={[type.caption, { textAlign: 'center' }]}>Version {appVersionLabel()}</Text>;
  }

  async function check() {
    setStatus('checking');
    setStatus(await checkForAppUpdate());
  }

  return (
    <View style={styles.section}>
      <SectionTitle title="App version" />
      <Card>
        <Text style={type.body}>{appVersionLabel()}</Text>
        {status === 'ready' ? (
          <>
            <Text style={type.caption}>An update is ready. It's used next time the app opens, or restart now.</Text>
            <Button title="Restart now" height={44} onPress={() => restartApp().catch(() => {})} />
          </>
        ) : (
          <>
            {status === 'none' && <Text style={type.caption}>You have the latest version.</Text>}
            {status === 'error' && <Text style={type.caption}>Couldn't check. Connect to the internet and try again.</Text>}
            <Button title="Check for updates" variant="secondary" height={44} loading={status === 'checking'} onPress={check} />
          </>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 12, paddingBottom: 40, gap: 24 },
  section: { gap: 10 },
  readOnly: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  logo: { width: 64, height: 64, borderRadius: 14, backgroundColor: colors.surfaceMuted },
});
