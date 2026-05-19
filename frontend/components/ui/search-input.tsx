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
      style={{ borderColor: '#E9E5DC' }}
      className={cn(
        'flex-row items-center border rounded-[12px] bg-white px-3 h-[44px]',
        containerClassName
      )}
    >
      <MaterialIcons name="search" size={18} color="#9A9389" />
      <TextInput
        value={value}
        placeholderTextColor={placeholderTextColor}
        className="flex-1 ml-2 text-[14.5px] text-ink-strong"
        {...rest}
      />
      {value && value.length > 0 ? (
        <TouchableOpacity
          onPress={onClear}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="close" size={16} color="#9A9389" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
