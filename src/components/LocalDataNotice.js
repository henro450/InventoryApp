import React, { useState } from 'react';
import { getSyncStatusSummary, getLastSyncedAt } from '../db/localDb';
import { runSync } from '../sync/syncEngine';
import { useOnline } from '../hooks/useOnline';
import { plural, timeAgo } from '../utils/format';
import { Text, Banner } from './ui';
import { type } from '../theme';

// Shown above figures computed from this phone's data (reports, dashboard, alerts, compare).
// - Unsynced changes: says they're included and offers Sync now.
// - Offline with nothing pending: makes clear the data is what's saved on this phone.
// - Otherwise: a quiet "last synced" line.
// `onSynced` lets the screen recompute right after a manual sync.
export default function LocalDataNotice({ user, onSynced }) {
  const online = useOnline();
  const [syncing, setSyncing] = useState(false);
  const pending = getSyncStatusSummary(user.id).total;
  const lastSynced = getLastSyncedAt(user.id);
  const syncedLabel = lastSynced ? `synced ${timeAgo(lastSynced)}` : 'not yet synced';

  async function handleSync() {
    setSyncing(true);
    try {
      await runSync(user.id);
      onSynced && onSynced();
    } finally {
      setSyncing(false);
    }
  }

  if (pending > 0) {
    return (
      <Banner
        kind="warn"
        icon="sync"
        title={`Includes ${plural(pending, 'change')} from this phone that ${pending === 1 ? "hasn't" : "haven't"} synced yet`}
        subtitle={online ? 'They’ll reach the server on the next sync.' : `Offline · ${syncedLabel}. They’ll sync when you’re back online.`}
        actionLabel={online ? 'Sync now' : undefined}
        onAction={handleSync}
        actionLoading={syncing}
      />
    );
  }

  if (!online) {
    return <Banner kind="info" icon="cloud" title="Offline · showing data saved on this phone" subtitle={lastSynced ? `Last ${syncedLabel}.` : 'Not yet synced.'} />;
  }

  return <Text style={type.caption}>{lastSynced ? `Data on this phone · ${syncedLabel}` : 'Not yet synced'}</Text>;
}
