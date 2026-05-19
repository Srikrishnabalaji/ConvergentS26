import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';
import {
  ALL_ALERT_TYPES,
  ALERT_COLORS,
  ALERT_ICONS,
  ALERT_LABELS,
  ALERT_EXPIRY_MINUTES,
} from '@/lib/alerts';
import type { AlertType } from '@/lib/alerts';

type Props = {
  floorId: string;
  /** Normalized (0–1) coordinates of the long-pressed point */
  x: number;
  y: number;
  currentUserId: string | null;
  onClose: () => void;
  onSubmitted: () => void;
};

export function AlertSubmissionForm({
  floorId,
  x,
  y,
  currentUserId,
  onClose,
  onSubmitted,
}: Props) {
  const [selectedType, setSelectedType] = useState<AlertType>('crowd');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isFlagged, setIsFlagged] = useState(false);
  const [checkingFlag, setCheckingFlag] = useState(true);
  const [error, setError] = useState('');

  // Check if current user is flagged before allowing submission
  useEffect(() => {
    if (!currentUserId) {
      setCheckingFlag(false);
      return;
    }
    supabase
      .from('profiles')
      .select('flagged')
      .eq('id', currentUserId)
      .single()
      .then(({ data }) => {
        setIsFlagged(data?.flagged ?? false);
        setCheckingFlag(false);
      });
  }, [currentUserId]);

  const handleSubmit = async () => {
    if (!currentUserId || isFlagged || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const expiresAt = new Date(
        Date.now() + ALERT_EXPIRY_MINUTES[selectedType] * 60_000,
      ).toISOString();

      const { error: insertErr } = await supabase.from('campus_alerts').insert({
        type: selectedType,
        floor_id: floorId,
        x,
        y,
        description: description.trim() || null,
        submitted_by: currentUserId,
        status: 'active',
        expires_at: expiresAt,
      });

      if (insertErr) {
        console.warn('[AlertSubmission]', JSON.stringify(insertErr));
        setError(insertErr.message ?? 'Failed to submit alert. Please try again.');
        return;
      }
      onSubmitted();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.header}>
          <Text style={styles.title}>Submit an Alert</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <MaterialIcons name="close" size={22} color="#64748b" />
          </TouchableOpacity>
        </View>

        {checkingFlag ? (
          <ActivityIndicator style={{ marginVertical: 32 }} color="#0B617E" />
        ) : isFlagged ? (
          <View style={styles.flaggedNotice}>
            <MaterialIcons name="block" size={24} color="#dc2626" />
            <Text style={styles.flaggedText}>
              Your account has been flagged for abuse. Submissions are disabled.
            </Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionLabel}>Alert Type</Text>
            <View style={styles.typeGrid}>
              {ALL_ALERT_TYPES.map((type) => {
                const active = type === selectedType;
                const color = ALERT_COLORS[type];
                const icon = ALERT_ICONS[type] as any;
                return (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.typeChip,
                      active && { backgroundColor: color, borderColor: color },
                    ]}
                    onPress={() => setSelectedType(type)}
                  >
                    <MaterialIcons
                      name={icon}
                      size={16}
                      color={active ? '#fff' : color}
                    />
                    <Text
                      style={[styles.typeChipText, active && styles.typeChipTextActive]}
                    >
                      {ALERT_LABELS[type]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionLabel}>Description (optional)</Text>
            <TextInput
              style={styles.descInput}
              placeholder="Add more details…"
              placeholderTextColor="#94a3b8"
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={200}
              returnKeyType="done"
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={styles.submitBtnText}>Report</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
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
    paddingBottom: 40,
    paddingTop: 12,
    maxHeight: '80%',
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
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginTop: 4,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  typeChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  typeChipTextActive: {
    color: '#fff',
  },
  descInput: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0f172a',
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 20,
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B617E',
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  flaggedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fef2f2',
    borderRadius: 12,
    padding: 16,
    marginVertical: 24,
  },
  flaggedText: {
    flex: 1,
    fontSize: 14,
    color: '#b91c1c',
    lineHeight: 20,
  },
});
