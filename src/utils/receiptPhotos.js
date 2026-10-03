import { Alert, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { api, API_BASE_URL, authHeaders } from '../api/client';
import { getPendingReceipts, markReceiptUploaded } from '../db/localDb';
import { MAX_UPLOAD_BYTES, readAsBase64 } from './files';

// Receipt photos for money out. A photo is copied into the app's own files (the camera's copy can
// be cleaned up by the phone), saved with the entry, and uploaded on a later sync once the entry
// itself is on the server. Other phones show it from the server.

const RECEIPTS_DIR = `${FileSystem.documentDirectory}receipts/`;

// From the camera, or an image already on the phone (picked with the file picker, like proof of
// payment, so no photo-library permission is needed). Resolves a temporary { uri } or null.
export async function pickReceiptPhoto(source) {
  if (source !== 'camera') {
    const picked = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.length) return null;
    if ((picked.assets[0].size ?? 0) > MAX_UPLOAD_BYTES) {
      Alert.alert('Image too large', 'Choose an image under 5 MB, or take a photo of the receipt instead.');
      return null;
    }
    return { uri: picked.assets[0].uri };
  }
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Camera access needed', 'Allow camera access to photograph the receipt.', [
      { text: 'OK' },
      ...(permission.canAskAgain ? [] : [{ text: 'Open settings', onPress: () => Linking.openSettings() }]),
    ]);
    return null;
  }
  // A lower quality keeps receipts small (well under the 5 MB limit) while staying readable.
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.5 });
  if (result.canceled || !result.assets?.length) return null;
  return { uri: result.assets[0].uri };
}

// Asks camera or file, then picks. Resolves { uri } or null.
export function chooseReceiptPhoto() {
  return new Promise((resolve) => {
    const pick = (source) => pickReceiptPhoto(source).then(resolve, (err) => {
      Alert.alert("Couldn't add the photo", err.message);
      resolve(null);
    });
    Alert.alert('Receipt photo', 'Take a photo of the receipt or choose an image already on this phone.', [
      { text: 'Take photo', onPress: () => pick('camera') },
      { text: 'Choose image', onPress: () => pick('file') },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}

// Copies a picked photo into the app's files under the entry's id; returns the kept uri.
export async function keepReceiptPhoto(tempUri, clientOutflowId) {
  await FileSystem.makeDirectoryAsync(RECEIPTS_DIR, { intermediates: true }).catch(() => {});
  const extension = (tempUri.match(/\.(jpe?g|png|webp|heic)$/i)?.[1] || 'jpg').toLowerCase();
  const target = `${RECEIPTS_DIR}${clientOutflowId}-${Date.now()}.${extension}`;
  await FileSystem.copyAsync({ from: tempUri, to: target });
  return target;
}

// Called by every sync after its operations are pushed. A photo that fails to upload stays
// waiting and is tried again next time; one the server will never take (too big) is dropped
// from the queue but kept on this phone.
export async function uploadPendingReceipts(userId) {
  let uploaded = 0;
  for (const { clientOutflowId, receiptUri } of getPendingReceipts(userId)) {
    try {
      const info = await FileSystem.getInfoAsync(receiptUri, { size: true });
      if (!info.exists || info.size > MAX_UPLOAD_BYTES) {
        markReceiptUploaded(clientOutflowId, null);
        continue;
      }
      const result = await api.uploadOutflowReceipt(clientOutflowId, await readAsBase64(receiptUri));
      markReceiptUploaded(clientOutflowId, result.mimeType);
      uploaded++;
    } catch (err) {
      if (err.status === 400 || err.status === 413) markReceiptUploaded(clientOutflowId, null);
      // Anything else (offline, the entry not on the server yet): try again next sync.
    }
  }
  return uploaded;
}

// What to show for an entry's receipt: the photo on this phone if there is one, otherwise the
// server's copy (signed in), or null when the entry has no photo.
export async function receiptImageSource(outflow) {
  if (outflow.receiptUri) {
    const info = await FileSystem.getInfoAsync(outflow.receiptUri).catch(() => ({ exists: false }));
    if (info.exists) return { uri: outflow.receiptUri };
  }
  if (!outflow.receiptMimeType) return null;
  return { uri: `${API_BASE_URL}/money-outflows/${encodeURIComponent(outflow.clientOutflowId)}/receipt`, headers: await authHeaders() };
}
