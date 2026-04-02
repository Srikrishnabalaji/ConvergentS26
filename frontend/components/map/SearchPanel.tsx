import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { type SearchItem } from '@/lib/services/geocoding';

export type { SearchItem };

type Props = {
  recentSearches: SearchItem[];
  searchResults: SearchItem[];
  query: string;
  loading: boolean;
  onSelect: (item: SearchItem) => void;
  onClearRecents: () => void;
};

export function SearchPanel({
  recentSearches,
  searchResults,
  query,
  loading,
  onSelect,
  onClearRecents,
}: Props) {
  const isSearching = query.length > 0;
  const items = isSearching ? searchResults : recentSearches;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>
          {isSearching ? 'Results' : 'Recent'}
        </Text>
        {!isSearching && recentSearches.length > 0 && (
          <TouchableOpacity onPress={onClearRecents}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading && (
        <ActivityIndicator
          style={styles.loader}
          size="small"
          color="#999"
        />
      )}

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {items.map((item, index) => (
          <TouchableOpacity
            key={`${item.id}-${index}`}
            style={styles.item}
            onPress={() => onSelect(item)}
            activeOpacity={0.7}
          >
            <MaterialIcons
              name={isSearching ? 'place' : 'schedule'}
              size={20}
              color="#999"
              style={styles.itemIcon}
            />
            <View style={styles.itemText}>
              <Text style={styles.itemName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.itemAddress} numberOfLines={1}>
                {item.address}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
        {!loading && items.length === 0 && isSearching && (
          <Text style={styles.emptyText}>No results found</Text>
        )}
        {!isSearching && recentSearches.length === 0 && (
          <Text style={styles.emptyText}>No recent searches</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000',
  },
  clearText: {
    fontSize: 14,
    color: '#999',
  },
  loader: {
    paddingVertical: 12,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  itemIcon: {
    marginRight: 14,
  },
  itemText: {
    flex: 1,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#000',
  },
  itemAddress: {
    fontSize: 13,
    color: '#999',
    marginTop: 2,
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    fontSize: 15,
    paddingTop: 40,
  },
});
