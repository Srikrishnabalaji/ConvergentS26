import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';
import { useAlertVoting } from '@/lib/useAlertVoting';
import { ALERT_COLORS, ALERT_ICONS, ALERT_LABELS } from '@/lib/alerts';
import type { AlertCluster, AlertVoteValue } from '@/lib/alerts';

type Props = {
  cluster: AlertCluster;
  currentUserId: string | null;
  onClose: () => void;
  onVoted: () => void;
};

function reportedAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Reported just now';
  if (mins < 60) return `Reported ${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Reported ${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `Reported ${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? '' : 's'} ago`;
}

export function AlertDetailSheet({ cluster, currentUserId, onClose, onVoted }: Props) {
  const { confirmCluster, denyCluster, voting } = useAlertVoting(currentUserId);
  const color = ALERT_COLORS[cluster.type];
  const icon = ALERT_ICONS[cluster.type] as any;

  // True if the current user submitted any alert in this cluster
  const isOwnCluster = !!currentUserId && cluster.submitter_ids.includes(currentUserId);

  const [existingVote, setExistingVote] = useState<AlertVoteValue | null>(null);
  const [checkingVote, setCheckingVote] = useState(true);

  // Check for an existing vote on the lead alert (cluster.id === seed alert id)
  useEffect(() => {
    if (!currentUserId) { setCheckingVote(false); return; }
    supabase
      .from('alert_votes')
      .select('vote')
      .eq('alert_id', cluster.id)
      .eq('user_id', currentUserId)
      .maybeSingle()
      .then(({ data }) => {
        setExistingVote((data?.vote as AlertVoteValue) ?? null);
        setCheckingVote(false);
      });
  }, [cluster.id, currentUserId]);

  const hasVoted = !checkingVote && existingVote !== null;
  const reportCount = cluster.members.length;

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.header}>
          <View style={[styles.iconBadge, { backgroundColor: color }]}>
            <MaterialIcons name={icon} size={20} color="#fff" />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.type}>{ALERT_LABELS[cluster.type]}</Text>
            {reportCount > 1 && (
              <Text style={styles.reportCount}>{reportCount} reports in this area</Text>
            )}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <MaterialIcons name="close" size={22} color="#64748b" />
          </TouchableOpacity>
        </View>

        <Text style={styles.reportedAt}>{reportedAgo(cluster.created_at)}</Text>

        {cluster.description ? (
          <Text style={styles.description}>{cluster.description}</Text>
        ) : null}

        {checkingVote ? (
          <ActivityIndicator style={{ marginVertical: 20 }} color="#0B617E" />
        ) : isOwnCluster ? (
          <Text style={styles.ownAlertNote}>You reported this alert</Text>
        ) : hasVoted ? (
          <View style={styles.submittedRow}>
            <MaterialIcons name="check-circle" size={20} color="#64748b" />
            <Text style={styles.submittedText}>
              You responded: {existingVote === 'confirm' ? 'Still there' : 'Gone'}
            </Text>
          </View>
        ) : (
          <View style={styles.voteRow}>
            <TouchableOpacity
              style={[styles.voteBtn, styles.confirmBtn]}
              onPress={() => { confirmCluster(cluster); onVoted(); }}
              disabled={!!voting}
            >
              {voting === cluster.id ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <MaterialIcons name="thumb-up" size={18} color="#fff" />
                  <Text style={styles.voteBtnText}>Still there</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.voteBtn, styles.denyBtn]}
              onPress={() => { denyCluster(cluster); onVoted(); }}
              disabled={!!voting}
            >
              {voting === cluster.id ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <MaterialIcons name="thumb-down" size={18} color="#fff" />
                  <Text style={styles.voteBtnText}>Gone</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e2e8f0',
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 6,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  type: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  reportCount: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    marginTop: 2,
  },
  reportedAt: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 14,
    fontStyle: 'italic',
  },
  description: {
    fontSize: 15,
    color: '#334155',
    marginBottom: 16,
    lineHeight: 22,
  },
  voteRow: {
    flexDirection: 'row',
    gap: 12,
  },
  voteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  confirmBtn: {
    backgroundColor: '#16a34a',
  },
  denyBtn: {
    backgroundColor: '#dc2626',
  },
  voteBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  submittedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  submittedText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748b',
  },
  ownAlertNote: {
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 14,
    fontStyle: 'italic',
  },
});
