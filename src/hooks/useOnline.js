import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

// Live connectivity for UI hints ("Offline · showing data on this phone"). Starts as online so
// screens don't flash an offline notice before NetInfo reports. isInternetReachable is null
// while unknown, which counts as online.
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = (state) => setOnline(!!state.isConnected && state.isInternetReachable !== false);
    NetInfo.fetch().then(update).catch(() => {});
    return NetInfo.addEventListener(update);
  }, []);
  return online;
}
