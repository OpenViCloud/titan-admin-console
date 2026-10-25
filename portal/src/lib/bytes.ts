// A size as a person reads it, in powers of 1024. The units are the same in both languages.
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  // Compare the rounded value, so 1048575 bytes reads "1.0 MB" and not "1024.0 KB".
  while (Number(value.toFixed(1)) >= 1024 && unit < units.length - 1) {
    value = value / 1024
    unit = unit + 1
  }
  if (unit === 0) {
    return `${value} ${units[unit]}`
  }
  return `${value.toFixed(1)} ${units[unit]}`
}
