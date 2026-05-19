import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { clusterAlerts } from '@/lib/alerts';
import type { AlertCluster, AlertWithVotes } from '@/lib/alerts';

const LOW_REP_THRESHOLD = 30;
const HIGH_REP_THRESHOLD = 80;
const LOW_REP_MIN_CONFIRMS = 2;

// Waze-style: once at least this many votes exist, remove the alert if the
// deny ratio meets or exceeds DENY_RATIO_THRESHOLD.
const MIN_VOTES_FOR_RATIO = 3;
const DENY_RATIO_THRESHOLD = 0.6; // 60 % denial

export function useAlerts(floorId: string | null) {
  const [alerts, setAlerts] = useState<AlertWithVotes[]>([]);
  const [clusters, setClusters] = useState<AlertCluster[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAlerts = useCallback(async () => {
    if (!floorId) {
      setAlerts([]);
      setClusters([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('campus_alerts')
        .select(
          `*, submitter:profiles!submitted_by(reputation_score), votes:alert_votes(vote)`,
        )
        .eq('floor_id', floorId)
        .gt('expires_at', new Date().toISOString());

      if (error || !data) return;

      const enriched: AlertWithVotes[] = (data as any[])
        .map((row) => {
          const votes: { vote: string }[] = row.votes ?? [];
          const confirmCount = votes.filter((v) => v.vote === 'confirm').length;
          const denyCount = votes.filter((v) => v.vote === 'deny').length;
          const reputation: number = row.submitter?.reputation_score ?? 50;
          return {
            ...row,
            confirm_count: confirmCount,
            deny_count: denyCount,
            _reputation: reputation,
          };
        })
        .filter((a) => {
          // Waze-style ratio check: enough votes + majority denial = remove
          const totalVotes = a.confirm_count + a.deny_count;
          if (
            totalVotes >= MIN_VOTES_FOR_RATIO &&
            a.deny_count / totalVotes >= DENY_RATIO_THRESHOLD
          ) return false;
          // High-rep submitters: always show
          if (a._reputation >= HIGH_REP_THRESHOLD) return true;
          // Low-rep submitters: require minimum independent confirmations
          if (a._reputation < LOW_REP_THRESHOLD) return a.confirm_count >= LOW_REP_MIN_CONFIRMS;
          return true;
        })
        .map(({ _reputation, ...rest }) => rest as AlertWithVotes);

      setAlerts(enriched);
      setClusters(clusterAlerts(enriched) ?? []);
    } finally {
      setLoading(false);
    }
  }, [floorId]);

  useEffect(() => {
    fetchAlerts();

    if (!floorId) return;

    const channel = supabase
      .channel(`campus-alerts-${floorId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'campus_alerts',
          filter: `floor_id=eq.${floorId}`,
        },
        fetchAlerts,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'alert_votes' },
        fetchAlerts,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAlerts, floorId]);

  return { alerts, clusters, loading, refresh: fetchAlerts };
}
