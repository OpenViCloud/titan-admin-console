import { describe, expect, it } from 'vitest'
import { ageOf } from './age'

const now = new Date('2026-10-25T12:00:00Z')

describe('ageOf', () => {
  it.each([
    ['2026-10-25T12:00:00Z', 'minutes', 0],
    ['2026-10-25T11:59:30Z', 'minutes', 0],
    ['2026-10-25T11:01:00Z', 'minutes', 59],
    ['2026-10-25T11:00:00Z', 'hours', 1],
    ['2026-10-23T12:01:00Z', 'hours', 47],
    ['2026-10-23T12:00:00Z', 'days', 2],
    ['2026-10-20T12:00:00Z', 'days', 5],
    ['2026-10-25T13:00:00Z', 'minutes', 0],
  ])('%s is %s %d', (iso, unit, count) => {
    expect(ageOf(iso, now)).toEqual({ unit, count })
  })

  it('is null for text that is not a time', () => {
    expect(ageOf('not a time', now)).toBeNull()
  })
})
