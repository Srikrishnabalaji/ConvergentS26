import React from 'react';
import { View, Text, type ViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { shadows } from '@/constants/shadows';
import { cn } from '@/lib/cn';

type PageShellProps = ViewProps & {
  title?: string;
  right?: React.ReactNode;
  bannerClassName?: string;
  contentClassName?: string;
  edges?: readonly Edge[];
  hideBanner?: boolean;
};

export function PageShell({
  title,
  right,
  children,
  bannerClassName,
  contentClassName,
  edges = ['top'],
  hideBanner = false,
  ...rest
}: PageShellProps) {
  return (
    <SafeAreaView className="flex-1 bg-primary" edges={edges}>
      {!hideBanner && (
        <View
          style={[shadows.banner, { zIndex: 1 }]}
          className={cn('bg-primary px-5 pt-5 pb-2.5 flex-row items-end justify-between', bannerClassName)}
        >
          <Text className="text-[40px] font-extrabold text-white tracking-[-1px]">{title}</Text>
          {right ? <View className="pb-1">{right}</View> : null}
        </View>
      )}
      <View className={cn('flex-1 bg-surface-muted', contentClassName)} {...rest}>
        {children}
      </View>
    </SafeAreaView>
  );
}
