export type ProtectedZeroCoverEvidence = {
  findingType: 'blocked_capacity'
  normalizedKey: 'BLOCKED_CAPACITY'
  validated: true
  sourcePax: number
  effectiveOperationalPax: 0
  reviewRequired: false
}

export const validatedBlockedCapacity = (evidence: ProtectedZeroCoverEvidence | undefined) => Boolean(
  evidence
  && evidence.findingType === 'blocked_capacity'
  && evidence.normalizedKey === 'BLOCKED_CAPACITY'
  && evidence.validated === true
  && Number.isInteger(evidence.sourcePax)
  && evidence.sourcePax > 0
  && evidence.effectiveOperationalPax === 0
  && evidence.reviewRequired === false
)

export const validateOperationalCovers = (covers: number, evidence?: ProtectedZeroCoverEvidence) => {
  if (Number.isInteger(covers) && covers > 0) return
  if (covers === 0 && validatedBlockedCapacity(evidence)) return
  throw new Error('Covers must be a positive whole number unless validated BLOCKED-capacity evidence explicitly resolves operational covers to zero.')
}
