import { describe, expect, it } from 'vitest'
import { formatBytes } from './bytes'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [70_000_000, '66.8 MB'],
    [1024 ** 3, '1.0 GB'],
    [1024 ** 4 * 3, '3.0 TB'],
    [1024 ** 5, '1024.0 TB'],
    [1048575, '1.0 MB'],
    [1023.96 * 1024, '1.0 MB'],
  ])('%d is %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})
