export type AgeUnit = 'minutes' | 'hours' | 'days'

export interface Age {
  unit: AgeUnit
  count: number
}

// How long ago, in the largest whole unit (null when the text is not a time); under a minute counts as 0 minutes. A time in the future reads as 0 minutes.
export function ageOf(iso: string, now: Date): Age | null {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) {
    return null
  }
  const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60000))
  if (minutes < 60) {
    return { unit: 'minutes', count: minutes }
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 48) {
    return { unit: 'hours', count: hours }
  }
  return { unit: 'days', count: Math.floor(hours / 24) }
}
