import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { shadows } from '@/constants/shadows';
import { cn } from '@/lib/cn';

export type SegmentedOption<T extends string = string> = {
  value: T;
  label: string;
  badge?: number | null;
};

type Props<T extends string> = {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  className?: string;
};

export function SegmentedTabs<T extends string>({ value, onChange, options, className }: Props<T>) {
  return (
    <View className={cn('flex-row bg-canvas-soft rounded-[12px] p-[3px]', className)}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            activeOpacity={0.75}
            onPress={() => onChange(opt.value)}
            style={active ? shadows.segmentActive : undefined}
            className={cn(
              'flex-1 py-2 rounded-lg items-center',
              active && 'bg-white'
            )}
          >
            <View className="flex-row items-center gap-1.5">
              <Text
                className={cn(
                  'text-[13px]',
                  active ? 'text-primary font-bold' : 'text-ink-subtle font-medium'
                )}
              >
                {opt.label}
              </Text>
              {typeof opt.badge === 'number' && opt.badge > 0 ? (
                <View
                  className={cn(
                    'rounded-[10px] min-w-[18px] h-[18px] px-1 items-center justify-center',
                    active ? 'bg-primary' : 'bg-ink-faint'
                  )}
                >
                  <Text className="text-[11px] font-bold text-white">{opt.badge}</Text>
                </View>
              ) : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
