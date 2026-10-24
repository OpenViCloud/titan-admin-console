import { describe, expect, it } from 'vitest'
import type { BackupItem, BackupHealth } from '@/admin/hooks/useAdminBackups'
import { needsAttention, visibleItems } from './backupFilter'

const item = (name: string, health: BackupHealth): BackupItem => ({
  kind: 'postgres', name, tenantId: null, takenAt: null, sizeBytes: null, health, reason: null, lastWalAt: null,
})

describe('backup filter', () => {
  it.each([['Ok', false], ['Stale', true], ['Missing', true], ['Unknown', false]] as const)('%s needs attention: %s', (health, expected) => {
    expect(needsAttention(item('a', health))).toBe(expected)
  })

  it('shows every row when the filter is off', () => {
    const items = [item('a', 'Stale'), item('b', 'Ok')]
    expect(visibleItems(items, false)).toEqual(items)
  })

  it('shows only the warned rows when the filter is on', () => {
    expect(visibleItems([item('a', 'Stale'), item('b', 'Ok'), item('c', 'Missing')], true).map(i => i.name)).toEqual(['a', 'c'])
  })

  it('shows every row again when the filter is on and nothing is warned any more', () => {
    const items = [item('a', 'Ok'), item('b', 'Unknown')]
    expect(visibleItems(items, true)).toEqual(items)
  })
})
