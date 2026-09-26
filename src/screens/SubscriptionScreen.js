import React, { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, RefreshControl, Pressable, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { api, API_BASE_URL } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { loadSubscription } from '../subscription/reminders';
import { takeProofPhoto, chooseProofFile, readAsBase64, downloadAndOpen, MAX_UPLOAD_BYTES } from '../utils/files';
import { formatDate, formatDateTime, formatMoney } from '../utils/format';
import Icon from '../components/Icon';
import { Text, Screen, NavHeader, Card, SectionTitle, Divider, Button, Field, Banner, Note, Pill, InlineEmpty, KV, Loading } from '../components/ui';
import { colors, fonts, type } from '../theme';

const STATUS = {
  active: { kind: 'ok', label: 'Active' },
  trial: { kind: 'primary', label: 'Free trial' },
  free: { kind: 'ok', label: 'Free' },
  expired: { kind: 'danger', label: 'Expired' },
  none: { kind: 'muted', label: 'Not subscribed' },
};
const PAYMENT_STATUS = {
  pending: { kind: 'warn', label: 'Awaiting approval' },
  approved: { kind: 'ok', label: 'Approved' },
  rejected: { kind: 'danger', label: 'Rejected' },
};

function sizeLabel(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Company admins: their subscription status, the account to pay into, and uploading proof of
// payment for the SuperAdmin to approve. Approval starts a new subscription period from that day.
// A Sub Company's admins see their Main Company's subscription (it covers them) but don't upload.
export default function SubscriptionScreen() {
  const { user, isCompanyAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [file, setFile] = useState(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const result = await loadSubscription(user);
    setData(result.data);
    setSavedAt(result.savedAt);
  }, [user]);

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

  async function pick(source) {
    try {
      const picked = source === 'camera' ? await takeProofPhoto() : await chooseProofFile();
      if (!picked) return;
      if (picked.size > MAX_UPLOAD_BYTES) {
        Alert.alert('File too large', `That file is ${sizeLabel(picked.size)}. Use an image or PDF under 5 MB.`);
        return;
      }
      setFile(picked);
    } catch (err) {
      Alert.alert("Couldn't open the file", err.message);
    }
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    try {
      const dataBase64 = await readAsBase64(file.uri);
      await api.uploadSubscriptionPayment({ fileName: file.name, dataBase64, amount: amount.trim() || undefined, note: note.trim() || undefined });
      setFile(null);
      setAmount('');
      setNote('');
      await load();
      Alert.alert('Proof of payment sent', "We'll let you know here once it's approved. Your new subscription period starts on the day it's approved.");
    } catch (err) {
      Alert.alert("Couldn't upload", err.status ? err.message : 'Uploading needs an internet connection. Try again when you are online.');
    } finally {
      setUploading(false);
    }
  }

  async function viewOwnProof(p) {
    try {
      await downloadAndOpen(`${API_BASE_URL}/subscription/payments/${p.id}/file`, p.fileName, p.mimeType);
    } catch (err) {
      Alert.alert("Couldn't open the file", err.message);
    }
  }

  async function copy(text) {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', text);
  }

  if (!data) {
    return (
      <Screen>
        <NavHeader title="Subscription" />
        {savedAt === null ? <Loading /> : <InlineEmpty>Subscription details load when you're online.</InlineEmpty>}
      </Screen>
    );
  }

  const sub = data.subscription;
  const status = STATUS[sub.status];
  const account = data.paymentAccount;
  const hasAccount = account.bankName || account.accountName || account.accountNumber;
  const canUpload = data.canUpload && isCompanyAdmin;

  return (
    <Screen>
      <NavHeader title="Subscription" />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
      >
        {savedAt && <Banner kind="info" icon="cloud" title="Offline · saved copy" subtitle={`From ${formatDateTime(savedAt)}.`} actionLabel="Retry" onAction={handleRefresh} />}

        <Card padding={18} gap={10}>
          <View style={styles.statusRow}>
            <Text style={styles.company} numberOfLines={1}>
              {data.company.name}
            </Text>
            <Pill kind={status.kind} label={status.label} />
          </View>
          {sub.status === 'free' ? (
            <Text style={type.small}>Your company uses the app free of charge. No payment is needed.</Text>
          ) : sub.status === 'active' || sub.status === 'trial' ? (
            <>
              <Text style={[styles.big, sub.daysLeft <= data.reminders.daysBefore && { color: colors.danger }]}>
                {sub.daysLeft === 1 ? '1 day left' : `${sub.daysLeft} days left`}
              </Text>
              <Text style={type.small}>
                {sub.status === 'trial' ? 'Free trial ends' : 'Ends'} on {formatDate(sub.endsAt)}
                {sub.status === 'trial' ? '. Pay before then so stock in and sales keep working.' : ''}
              </Text>
            </>
          ) : sub.status === 'expired' ? (
            <Text style={[type.small, { color: colors.danger }]}>
              {sub.currentPeriodEnd ? 'Subscription' : 'Free trial'} ended on {formatDate(sub.endsAt)}. Stock in and sales are paused for everyone in
              your company until the subscription is paid.
            </Text>
          ) : (
            <Text style={type.small}>No active subscription yet. Pay and upload proof of payment below.</Text>
          )}
          <Divider />
          <KV label="Price" value={sub.price !== null ? `${formatMoney(sub.price)} per ${data.subscriptionDays} days` : 'Not set yet'} />
          {sub.currentPeriodStart && <KV label="Current period started" value={formatDate(sub.currentPeriodStart)} />}
          <Text style={type.caption}>
            Each payment covers {data.subscriptionDays} days from the day it's approved. You'll be reminded {data.reminders.daysBefore} days before it
            ends.
          </Text>
        </Card>

        {sub.status === 'free' ? null : data.managedByParent ? (
          <Note>This subscription belongs to your main company, {data.company.name}. Its admin pays and uploads the proof of payment.</Note>
        ) : (
          <>
            <Card padding={18} gap={10}>
              <SectionTitle title="Pay into" />
              {hasAccount ? (
                <>
                  {account.bankName && <KV label="Bank" value={account.bankName} />}
                  {account.accountName && <KV label="Account name" value={account.accountName} />}
                  {account.accountNumber && (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Copy account number ${account.accountNumber}`} onPress={() => copy(account.accountNumber)} style={styles.accountRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={type.caption}>Account number</Text>
                        <Text style={styles.accountNumber}>{account.accountNumber}</Text>
                      </View>
                      <Text style={styles.link}>Copy</Text>
                    </Pressable>
                  )}
                  {sub.price !== null && <KV label="Amount" value={formatMoney(sub.price)} strong />}
                  {account.instructions && <Note>{account.instructions}</Note>}
                </>
              ) : (
                <InlineEmpty>Payment details haven't been set up yet. Contact HenroTech support.</InlineEmpty>
              )}
            </Card>

            {canUpload && (
              <Card padding={18} gap={12}>
                <SectionTitle title="Upload proof of payment" />
                <Text style={[type.caption, { marginTop: -6 }]}>A photo or screenshot of the receipt, or a PDF (max 5 MB).</Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button title="Take photo" variant="secondary" icon="camera" height={46} style={{ flex: 1 }} onPress={() => pick('camera')} />
                  <Button title="Choose file" variant="secondary" icon="upload" height={46} style={{ flex: 1 }} onPress={() => pick('file')} />
                </View>
                {file && (
                  <View style={styles.fileRow}>
                    {file.mimeType.startsWith('image/') ? (
                      <Image source={{ uri: file.uri }} style={styles.thumb} />
                    ) : (
                      <View style={[styles.thumb, styles.pdfThumb]}>
                        <Text style={styles.pdfText}>PDF</Text>
                      </View>
                    )}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.fileName} numberOfLines={1}>
                        {file.name}
                      </Text>
                      <Text style={type.caption}>{sizeLabel(file.size)}</Text>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel="Remove file" hitSlop={10} onPress={() => setFile(null)}>
                      <Icon name="x" size={20} color={colors.ink3} />
                    </Pressable>
                  </View>
                )}
                <Field label="Amount paid" optional prefix="₦" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder={sub.price !== null ? String(sub.price) : '0.00'} />
                <Field label="Note" optional value={note} onChangeText={setNote} placeholder="e.g. Transfer reference" />
                <Button title="Send proof of payment" icon="upload" onPress={handleUpload} loading={uploading} disabled={!file} />
              </Card>
            )}
          </>
        )}

        <Card padding={18} gap={8}>
          <SectionTitle title="Payment history" />
          {data.payments.length === 0 ? (
            <InlineEmpty>No proofs of payment uploaded yet.</InlineEmpty>
          ) : (
            data.payments.map((p, i) => {
              const ps = PAYMENT_STATUS[p.status];
              return (
                <View key={p.id}>
                  {i > 0 && <Divider />}
                  <View style={styles.paymentRow}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={styles.fileName}>{p.amount !== null ? formatMoney(p.amount) : p.fileName}</Text>
                      <Text style={type.caption}>Uploaded {formatDateTime(p.createdAt)}</Text>
                      {p.status === 'approved' && p.periodEnd && (
                        <Text style={type.caption}>
                          Covers {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                        </Text>
                      )}
                      {p.reviewNote ? <Text style={[type.caption, { color: colors.ink2 }]}>“{p.reviewNote}”</Text> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      <Pill kind={ps.kind} label={ps.label} />
                      <Pressable accessibilityRole="button" onPress={() => viewOwnProof(p)} hitSlop={8}>
                        <Text style={styles.link}>View</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 16 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  company: { flex: 1, fontFamily: fonts.semibold, fontSize: 16 },
  big: { fontFamily: fonts.display, fontSize: 30, letterSpacing: -0.6 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: colors.surfaceMuted },
  accountNumber: { fontFamily: fonts.mono, fontSize: 20, letterSpacing: 1, color: colors.ink },
  link: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primary },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.line },
  thumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: colors.surfaceMuted },
  pdfThumb: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerSoft },
  pdfText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.danger },
  fileName: { fontFamily: fonts.semibold, fontSize: 14 },
  paymentRow: { flexDirection: 'row', gap: 10, paddingVertical: 10 },
});
