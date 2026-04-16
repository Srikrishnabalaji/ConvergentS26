import React from 'react';
import { View, type ViewProps } from 'react-native';
import { shadows } from '@/constants/shadows';
import { cn } from '@/lib/cn';

type CardProps = ViewProps & {
  padded?: boolean;
  elevated?: boolean;
};

export function Card({ className, style, padded = false, elevated = true, children, ...rest }: CardProps) {
  return (
    <View
      style={[elevated ? shadows.card : undefined, style]}
      className={cn(
        'bg-white rounded-card border border-line overflow-hidden',
        padded && 'p-3.5',
        className
      )}
      {...rest}
    >
      {children}
    </View>
  );
}

export function Hairline({ inset = 14 }: { inset?: number }) {
  return <View style={{ height: 0.5, marginLeft: inset }} className="bg-line-faint" />;
}
