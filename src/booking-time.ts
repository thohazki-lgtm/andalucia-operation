export const bookingTimeWindow = (time: string) => {
  const match = time.match(/^(\d{2}):(\d{2})$/)
  if (!match) return time || 'Time not set'
  const start = Number(match[1]) * 60 + Number(match[2])
  const end = (start + 30) % (24 * 60)
  return `${time} – ${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
}
