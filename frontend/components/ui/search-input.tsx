import React from 'react';
import { TextInput, TouchableOpacity, View, type TextInputProps } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { cn } from '@/lib/cn';

type SearchInputProps = TextInputProps & {
  onClear?: () => void;
  containerClassName?: string;
};

export function SearchInput({
  value,
  onClear,
  containerClassName,
  placeholderTextColor = '#9ca3af',
  ...rest
}: SearchInputProps) {
  return (
    <View
      className={cn(
        'flex-row items-center border border-line-muted rounded-xl bg-surface-alt px-3 h-[46px]',
        containerClassName
      )}
    >
      <MaterialIcons name="search" size={20} color="#9ca3af" />
      <TextInput
        value={value}
        placeholderTextColor={placeholderTextColor}
        className="flex-1 ml-2 text-[15px] text-ink-strong"
        {...rest}
      />
      {value && value.length > 0 ? (
        <TouchableOpacity
          onPress={onClear}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="close" size={18} color="#9ca3af" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
