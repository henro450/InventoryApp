import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { subscribeToSync } from '../sync/syncEngine';

// Re-runs `refresh` whenever the screen gains focus and whenever a background sync pushes or
// pulls data, so screens computed from the local database stay current without a manual
// pull-to-refresh.
export function useLocalRefresh(refresh) {
  const latest = useRef(refresh);
  latest.current = refresh;

  useFocusEffect(
    useCallback(() => {
      latest.current();
    }, [])
  );

  useEffect(() => subscribeToSync(() => latest.current()), []);
}
