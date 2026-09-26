import { Alert, Linking, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { authHeaders } from '../api/client';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function withSize(file) {
  return FileSystem.getInfoAsync(file.uri, { size: true }).then((info) => ({ ...file, size: file.size ?? info.size ?? 0 }));
}

// A photo taken now with the camera. Resolves { uri, name, mimeType, size } or null.
export async function takeProofPhoto() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Camera access needed', 'Allow camera access to photograph the receipt, or choose a file instead.', [
      { text: 'OK' },
      ...(permission.canAskAgain ? [] : [{ text: 'Open settings', onPress: () => Linking.openSettings() }]),
    ]);
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  return withSize({ uri: asset.uri, name: asset.fileName || `receipt-${Date.now()}.jpg`, mimeType: asset.mimeType || 'image/jpeg', size: asset.fileSize });
}

// An existing image (e.g. a bank app screenshot) or PDF from the phone.
export async function chooseProofFile() {
  const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  return withSize({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType || 'application/octet-stream', size: asset.size });
}

export function readAsBase64(uri) {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

// Downloads a signed-in file (e.g. a proof of payment) into the cache and opens it in the phone's
// viewer — used for PDFs, which can't be shown inline. Android opens the default PDF app; iOS
// shows its preview/share sheet.
export async function downloadAndOpen(url, fileName, mimeType) {
  const safeName = String(fileName || 'file').replace(/[^\w.\-]+/g, '_');
  const target = `${FileSystem.cacheDirectory}${Date.now()}-${safeName}`;
  const { uri, status } = await FileSystem.downloadAsync(url, target, { headers: await authHeaders() });
  if (status !== 200) throw new Error(`Download failed (${status})`);
  if (Platform.OS === 'android') {
    const contentUri = await FileSystem.getContentUriAsync(uri);
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: contentUri, flags: 1, type: mimeType });
      return;
    } catch {
      // No app for this type: fall back to the share sheet.
    }
  }
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: safeName, UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : undefined });
}
