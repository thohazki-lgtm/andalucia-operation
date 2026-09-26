const decimalPattern = /^\d+(?:\.\d+)?$/

export const parseFixed = (value: string, scale: number, label = 'Amount'): bigint => {
  const normalized = value.trim()
  if (!decimalPattern.test(normalized)) throw new Error(`${label} must be a non-negative decimal.`)
  const [whole, fraction = ''] = normalized.split('.')
  if (fraction.length > scale) throw new Error(`${label} supports no more than ${scale} decimal places.`)
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0')
}

export const formatFixed = (value: bigint, scale: number): string => {
  const negative = value < 0n
  const absolute = negative ? -value : value
  const divisor = 10n ** BigInt(scale)
  const whole = absolute / divisor
  const fraction = (absolute % divisor).toString().padStart(scale, '0')
  return `${negative ? '-' : ''}${whole}${scale ? `.${fraction}` : ''}`
}

export const divideRoundHalfUp = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n) throw new Error('Division requires a positive denominator.')
  if (numerator < 0n) return -divideRoundHalfUp(-numerator, denominator)
  return (numerator + denominator / 2n) / denominator
}

export const roundMicroDollarsToCents = (microDollars: bigint): bigint => divideRoundHalfUp(microDollars, 10_000n)

export const eligibleNetFromGrossUnit = (grossUnitCents: bigint, quantity: number, serviceChargeRate: string, gstRate: string) => {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Quantity must be a whole number of at least 1.')
  const serviceRate = parseFixed(serviceChargeRate, 4, 'Service Charge rate')
  const gst = parseFixed(gstRate, 4, 'GST rate')
  const oneHundredPercent = 1_000_000n
  const eligibleNetUnitCents = divideRoundHalfUp(grossUnitCents * oneHundredPercent * oneHundredPercent, (oneHundredPercent + serviceRate) * (oneHundredPercent + gst))
  return { grossTotalCents: grossUnitCents * BigInt(quantity), eligibleNetTotalCents: eligibleNetUnitCents * BigInt(quantity) }
}

export const percentageMicroDollars = (amountCents: bigint, ratePercent: string) => divideRoundHalfUp(amountCents * parseFixed(ratePercent, 4, 'Percentage rate'), 100n)

export const billTipShares = (remainingPoolCents: bigint, eligibleDays: number[]) => {
  const totalEligibleDays = eligibleDays.reduce((sum, days) => sum + days, 0)
  if (totalEligibleDays <= 0) throw new Error('At least one eligible roster day is required.')
  let valuePerDayMicro = remainingPoolCents * 10_000n / BigInt(totalEligibleDays)
  let calculatedMicro = eligibleDays.map(days => valuePerDayMicro * BigInt(days))
  let finalCents = calculatedMicro.map(roundMicroDollarsToCents)
  let allocated = finalCents.reduce((sum, value) => sum + value, 0n)
  while (allocated > remainingPoolCents) {
    valuePerDayMicro -= 1n
    calculatedMicro = eligibleDays.map(days => valuePerDayMicro * BigInt(days))
    finalCents = calculatedMicro.map(roundMicroDollarsToCents)
    allocated = finalCents.reduce((sum, value) => sum + value, 0n)
  }
  return { totalEligibleDays, valuePerDayMicro, calculatedMicro, finalCents, remainderCents: remainingPoolCents - allocated }
}
