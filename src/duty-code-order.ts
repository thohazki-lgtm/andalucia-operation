import type { ConfigOption } from './domain'

export type DutyCodeDropPlacement = 'before' | 'after'

export const moveDutyCode = (options: ConfigOption[], sourceId: string, targetId: string, placement: DutyCodeDropPlacement) => {
  const source = options.findIndex(option => option.id === sourceId)
  const target = options.findIndex(option => option.id === targetId)
  if (source < 0 || target < 0 || source === target || (placement === 'before' && source === target - 1) || (placement === 'after' && source === target + 1)) return options
  const next = [...options]
  const [item] = next.splice(source, 1)
  const remainingTarget = next.findIndex(option => option.id === targetId)
  next.splice(placement === 'after' ? remainingTarget + 1 : remainingTarget, 0, item)
  return next
}
