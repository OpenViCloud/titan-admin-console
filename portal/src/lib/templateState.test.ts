import { describe, expect, it } from 'vitest'
import { pollWhileASyncWaits, templateClusterLabel, type TemplateClusterFields } from './templateState'
import { POLL_MS } from '@/hooks/pollUntilSettled'

function cluster(status: string): TemplateClusterFields {
  return { status }
}

describe('templateClusterLabel', () => {
  it('names each status the server sends', () => {
    expect(templateClusterLabel(cluster('Syncing'))).toBe('Syncing')
    expect(templateClusterLabel(cluster('Available'))).toBe('Available')
    expect(templateClusterLabel(cluster('NotFound'))).toBe('Not found')
    expect(templateClusterLabel(cluster('Failed'))).toBe('Failed')
  })

  // A status this page does not know yet shows as the server spelled it rather than as nothing.
  it('shows a status it does not know as the server spelled it', () => {
    expect(templateClusterLabel(cluster('Quarantined'))).toBe('Quarantined')
  })
})

describe('pollWhileASyncWaits', () => {
  it('does not poll without data', () => {
    expect(pollWhileASyncWaits(undefined)).toBe(false)
    expect(pollWhileASyncWaits([])).toBe(false)
  })

  it('keeps polling while a sync waits in any cluster', () => {
    expect(pollWhileASyncWaits([cluster('Available'), cluster('Syncing')])).toBe(POLL_MS)
  })

  it('stops once nothing waits — a failed or lost cluster will not change on its own', () => {
    expect(pollWhileASyncWaits([cluster('Available'), cluster('Failed'), cluster('NotFound')])).toBe(false)
  })
})
