import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { AlertCluster, AlertVoteValue } from '@/lib/alerts';

const CONFIRM_EXTENSION_MS = 30 * 60_000;

export function useAlertVoting(currentUserId: string | null) {
  const [voting, setVoting] = useState<string | null>(null); // cluster id being voted on

  const castClusterVote = useCallback(
    async (cluster: AlertCluster, vote: AlertVoteValue) => {
      if (!currentUserId || voting) return;
      setVoting(cluster.id);
      try {
        // Cast the same vote on every member alert so the deny-ratio filter
        // applies uniformly and any member can trigger cluster removal.
        for (const member of cluster.members) {
          await supabase.from('alert_votes').upsert(
            { alert_id: member.id, user_id: currentUserId, vote },
            { onConflict: 'alert_id,user_id' },
          );
        }

        if (vote === 'confirm') {
          // Extend the lead alert's expiry (best-effort, requires RLS UPDATE policy)
          const currentExpiry = new Date(cluster.expires_at).getTime();
          const extended = new Date(
            Math.max(currentExpiry, Date.now()) + CONFIRM_EXTENSION_MS,
          ).toISOString();
          await supabase
            .from('campus_alerts')
            .update({ expires_at: extended })
            .eq('id', cluster.id);
        }

        // Distribute reputation to every unique submitter in the cluster,
        // skipping the voter's own submissions to prevent score farming.
        for (const submitterId of cluster.submitter_ids) {
          if (submitterId === currentUserId) continue;
          await supabase.rpc('recalculate_reputation', { p_user_id: submitterId });
          await supabase.rpc('check_abuse_threshold', { p_user_id: submitterId });
        }
      } finally {
        setVoting(null);
      }
    },
    [currentUserId, voting],
  );

  const confirmCluster = useCallback(
    (cluster: AlertCluster) => castClusterVote(cluster, 'confirm'),
    [castClusterVote],
  );

  const denyCluster = useCallback(
    (cluster: AlertCluster) => castClusterVote(cluster, 'deny'),
    [castClusterVote],
  );

  return { confirmCluster, denyCluster, voting };
}
