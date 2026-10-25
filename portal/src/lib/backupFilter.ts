import type { BackupItem } from '@/admin/hooks/useAdminBackups'

export function needsAttention(item: BackupItem): boolean {
  return item.health === 'Stale' || item.health === 'Missing'
}

// "Show them" keeps only the rows that need attention. When none does (a refresh cleared the last warning while the filter
// was on) the filter has nothing left to show, so every row comes back instead of a false "nothing is protected".
export function visibleItems(items: BackupItem[], onlyAttention: boolean): BackupItem[] {
  const warned = items.filter(needsAttention)
  if (onlyAttention && warned.length > 0) {
    return warned
  }
  return items
}
