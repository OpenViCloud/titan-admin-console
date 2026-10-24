// A size as a person reads it. The units are the same in both languages.
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value = value / 1024
    unit = unit + 1
  }
  if (unit === 0) {
    return `${value} ${units[unit]}`
  }
  return `${value.toFixed(1)} ${units[unit]}`
}
