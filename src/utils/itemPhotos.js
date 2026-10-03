import { useEffect, useState } from 'react';
import { Alert, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { api, API_BASE_URL, authHeaders } from '../api/client';
import { getPendingItemPhotos, markItemPhotoSynced, dropPendingItemPhoto } from '../db/localDb';
import { MAX_UPLOAD_BYTES, readAsBase64 } from './files';

// Item photos. One picked on this phone is copied into the app's files, shown straight away and
// uploaded on a later sync once the item itself is on the server. Photos from other phones are
// downloaded once into the cache (keyed by item and photo time, so a new photo is fetched again)
// rather than on every render of the list.

const KEEP_DIR = `${FileSystem.documentDirectory}item-photos/`;
const CACHE_DIR = `${FileSystem.cacheDirectory}item-photos/`;

// Square and small: these are thumbnails and quick look-ups, not product shots.
const CAMERA_OPTIONS = { mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.4 };

async function pickItemPhoto(source) {
  if (source !== 'camera') {
    const picked = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.length) return null;
    if ((picked.assets[0].size ?? 0) > MAX_UPLOAD_BYTES) {
      Alert.alert('Image too large', 'Choose an image under 5 MB, or take a photo instead.');
      return null;
    }
    return picked.assets[0].uri;
  }
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Camera access needed', 'Allow camera access to photograph the item.', [
      { text: 'OK' },
      ...(permission.canAskAgain ? [] : [{ text: 'Open settings', onPress: () => Linking.openSettings() }]),
    ]);
    return null;
  }
  const result = await ImagePicker.launchCameraAsync(CAMERA_OPTIONS);
  if (result.canceled || !result.assets?.length) return null;
  return result.assets[0].uri;
}

// Asks camera or file, then picks. Resolves a temporary uri or null. Also used for the company logo.
export function chooseItemPhoto({ title = 'Item photo', what = 'the item' } = {}) {
  return new Promise((resolve) => {
    const pick = (source) => pickItemPhoto(source).then(resolve, (err) => {
      Alert.alert("Couldn't add the photo", err.message);
      resolve(null);
    });
    Alert.alert(title, `Take a photo of ${what} or choose an image already on this phone.`, [
      { text: 'Take photo', onPress: () => pick('camera') },
      { text: 'Choose image', onPress: () => pick('file') },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}

// Copies a picked photo into the app's files; returns the kept uri.
export async function keepItemPhoto(tempUri, localId) {
  await FileSystem.makeDirectoryAsync(KEEP_DIR, { intermediates: true }).catch(() => {});
  const extension = (tempUri.match(/\.(jpe?g|png|webp|heic)$/i)?.[1] || 'jpg').toLowerCase();
  const target = `${KEEP_DIR}${localId}-${Date.now()}.${extension}`;
  await FileSystem.copyAsync({ from: tempUri, to: target });
  return target;
}

// Called by every sync after its operations are pushed. A failed upload stays waiting for the next
// sync; one the server will never take (too big, not an image) is dropped.
export async function uploadPendingItemPhotos() {
  let done = 0;
  for (const { localId, id, photoUri, photoPending } of getPendingItemPhotos()) {
    try {
      if (photoPending === 2) {
        markItemPhotoSynced(localId, (await api.deleteItemPhoto(id)).item);
        done++;
        continue;
      }
      const info = photoUri ? await FileSystem.getInfoAsync(photoUri, { size: true }) : { exists: false };
      if (!info.exists || info.size > MAX_UPLOAD_BYTES) {
        dropPendingItemPhoto(localId);
        continue;
      }
      markItemPhotoSynced(localId, (await api.uploadItemPhoto(id, await readAsBase64(photoUri))).item);
      done++;
    } catch (err) {
      // Rejected (too big, not an image) or the item is gone from the server: give up on it.
      if (err.status === 400 || err.status === 404 || err.status === 413) dropPendingItemPhoto(localId);
      // Anything else (offline, a server error): try again next sync.
    }
  }
  return done;
}

const downloads = new Map(); // cache path -> Promise<uri | null>
const failedAt = new Map(); // cache path -> time of the last failed download

function cachePath(item) {
  const stamp = String(item.photoUpdatedAt || '').replace(/[^0-9]/g, '');
  return `${CACHE_DIR}${item.id}-${stamp}`;
}

async function downloadPhoto(item) {
  const target = cachePath(item);
  const info = await FileSystem.getInfoAsync(target).catch(() => ({ exists: false }));
  if (info.exists) return target;
  // Offline or a failed fetch: don't retry on every render, only after a minute.
  if (Date.now() - (failedAt.get(target) || 0) < 60000) return null;
  if (!downloads.has(target)) {
    downloads.set(target, (async () => {
      try {
        await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true }).catch(() => {});
        const result = await FileSystem.downloadAsync(`${API_BASE_URL}/items/${item.id}/photo`, target, { headers: await authHeaders() });
        if (result.status !== 200) {
          await FileSystem.deleteAsync(target, { idempotent: true });
          throw new Error(`HTTP ${result.status}`);
        }
        return target;
      } catch {
        failedAt.set(target, Date.now());
        return null;
      } finally {
        downloads.delete(target);
      }
    })());
  }
  return downloads.get(target);
}

// The uri to show for an item's photo, or null when it has none (or it can't be fetched yet).
export function useItemPhoto(item) {
  const local = item?.photoPending === 2 ? null : item?.photoUri || null;
  const remote = !local && item?.id && item?.photoMimeType && item?.photoPending !== 2;
  const [uri, setUri] = useState(local);

  useEffect(() => {
    if (local || !remote) {
      setUri(local);
      return undefined;
    }
    let live = true;
    downloadPhoto(item).then((u) => live && setUri(u));
    return () => {
      live = false;
    };
  }, [local, remote, item?.id, item?.photoUpdatedAt]);

  return uri;
}
