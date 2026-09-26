import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, Image, ActivityIndicator, Pressable, Modal } from 'react-native';
import { api, API_BASE_URL, authHeaders } from '../api/client';
import { downloadAndOpen } from '../utils/files';
import { formatDate, formatDateTime, formatMoney } from '../utils/format';
import Icon from '../components/Icon';
import { Text, Screen, NavHeader, Card, KV, Button, Field, Pill, Sheet, Note } from '../components/ui';
import { colors, fonts, type } from '../theme';

const STATUS = {
  pending: { kind: 'warn', label: 'Awaiting approval' },
  approved: { kind: 'ok', label: 'Approved' },
  rejected: { kind: 'danger', label: 'Rejected' },
};

// SuperAdmin: preview one proof of payment (image inline, PDF in the phone's PDF viewer) and
// approve it — the company is subscribed from today for the configured number of days — or reject.
export default function AdminPaymentDetailScreen({ route, navigation }) {
  const [payment, setPayment] = useState(route.params.payment);
  const [headers, setHeaders] = useState(null);
  const [imageError, setImageError] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [deciding, setDeciding] = useState(null); // 'approve' | 'reject'
  const [reviewNote, setReviewNote] = useState('');
  const [busy, setBusy] = useState(false);

  const fileUrl = `${API_BASE_URL}/admin/payments/${payment.id}/file`;
  const isPdf = payment.mimeType === 'application/pdf';
  const st = STATUS[payment.status];

  useEffect(() => {
    authHeaders().then(setHeaders);
  }, []);

  async function openPdf() {
    setOpening(true);
    try {
      await downloadAndOpen(fileUrl, payment.fileName, payment.mimeType);
    } catch (err) {
      Alert.alert("Couldn't open the PDF", err.message);
    } finally {
      setOpening(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      const { payment: updated } =
        deciding === 'approve' ? await api.adminApprovePayment(payment.id, reviewNote.trim() || undefined) : await api.adminRejectPayment(payment.id, reviewNote.trim() || undefined);
      setPayment({ ...payment, ...updated });
      setDeciding(null);
      Alert.alert(
        deciding === 'approve' ? 'Subscription activated' : 'Payment rejected',
        deciding === 'approve'
          ? `${payment.companyName} is subscribed until ${formatDate(updated.periodEnd)}.`
          : `${payment.companyName} will see that this proof was rejected${reviewNote.trim() ? ', with your note' : ''}.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (err) {
      Alert.alert("Couldn't update", err.status ? err.message : 'This needs an internet connection.');
    } finally {
      setBusy(false);
    }
  }

  const imageSource = headers ? { uri: fileUrl, headers } : null;

  return (
    <Screen>
      <NavHeader title={payment.companyName || 'Proof of payment'} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card padding={14} gap={12}>
          {isPdf ? (
            <View style={styles.pdfBox}>
              <View style={styles.pdfIcon}>
                <Text style={styles.pdfIconText}>PDF</Text>
              </View>
              <Text style={styles.fileName} numberOfLines={2}>
                {payment.fileName}
              </Text>
              <Button title="Open PDF" icon="download" variant="secondary" height={46} onPress={openPdf} loading={opening} />
            </View>
          ) : imageError ? (
            <Note kind="error" icon="alert">
              Couldn't load the image. Check your connection and go back to try again.
            </Note>
          ) : imageSource ? (
            <Pressable accessibilityRole="imagebutton" accessibilityLabel="View full screen" onPress={() => setFullScreen(true)}>
              <Image source={imageSource} style={styles.image} resizeMode="contain" onError={() => setImageError(true)} />
              <Text style={[type.caption, { textAlign: 'center', marginTop: 6 }]}>Tap to view full screen</Text>
            </Pressable>
          ) : (
            <ActivityIndicator color={colors.ink3} style={{ height: 320 }} />
          )}
        </Card>

        <Card padding={18} gap={8}>
          <View style={styles.statusRow}>
            <Text style={styles.company} numberOfLines={1}>
              {payment.companyName}
            </Text>
            <Pill kind={st.kind} label={st.label} />
          </View>
          <KV label="Amount stated" value={payment.amount !== null ? formatMoney(payment.amount) : 'Not given'} />
          <KV label="Uploaded" value={formatDateTime(payment.createdAt)} />
          {payment.note ? <KV label="Company's note" value={payment.note} /> : null}
          {payment.status === 'approved' && payment.periodEnd && (
            <KV label="Subscription period" value={`${formatDate(payment.periodStart)} – ${formatDate(payment.periodEnd)}`} />
          )}
          {payment.reviewNote ? <KV label="Your note" value={payment.reviewNote} /> : null}
        </Card>

        {payment.status === 'pending' && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Reject" variant="danger" height={50} style={{ flex: 1 }} onPress={() => { setReviewNote(''); setDeciding('reject'); }} />
            <Button title="Approve & subscribe" icon="check" height={50} style={{ flex: 1.6 }} onPress={() => { setReviewNote(''); setDeciding('approve'); }} />
          </View>
        )}
      </ScrollView>

      <Sheet
        visible={!!deciding}
        onClose={() => setDeciding(null)}
        title={deciding === 'approve' ? 'Approve payment?' : 'Reject payment?'}
        description={
          deciding === 'approve'
            ? `${payment.companyName} will be subscribed from today. Their new period starts now.`
            : `${payment.companyName} will see this proof as rejected and can upload another.`
        }
        footer={
          <>
            <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setDeciding(null)} />
            <Button
              title={deciding === 'approve' ? 'Approve' : 'Reject'}
              variant={deciding === 'approve' ? 'primary' : 'danger'}
              style={{ flex: 1 }}
              onPress={confirm}
              loading={busy}
            />
          </>
        }
      >
        <Field
          label="Note to the company"
          optional
          value={reviewNote}
          onChangeText={setReviewNote}
          placeholder={deciding === 'approve' ? 'e.g. Received, thank you' : 'e.g. Payment not received yet'}
        />
      </Sheet>

      <Modal visible={fullScreen} transparent animationType="fade" onRequestClose={() => setFullScreen(false)}>
        <View style={styles.viewer}>
          {imageSource && <Image source={imageSource} style={StyleSheet.absoluteFill} resizeMode="contain" />}
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setFullScreen(false)} style={styles.close}>
            <Icon name="x" size={24} color="#FFFFFF" />
          </Pressable>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 16 },
  image: { width: '100%', height: 360, borderRadius: 10, backgroundColor: colors.surfaceMuted },
  pdfBox: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  pdfIcon: { width: 64, height: 76, borderRadius: 10, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' },
  pdfIconText: { fontFamily: fonts.semibold, fontSize: 16, color: colors.danger },
  fileName: { fontFamily: fonts.semibold, fontSize: 14, textAlign: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 },
  company: { flex: 1, fontFamily: fonts.semibold, fontSize: 16 },
  viewer: { flex: 1, backgroundColor: '#000000' },
  close: { position: 'absolute', top: 48, right: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
});
