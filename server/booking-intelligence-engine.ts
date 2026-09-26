import { createHash } from 'node:crypto'
import type { BookingCoverLedgerEntry, BookingCoverReconciliation, BookingImportPreviewRecord, BookingIntelligenceFinding, BookingPaxSemantic, ConfigOption } from '../src/domain.js'
import { detectBookingAllergyEvidence } from '../src/booking-allergy.js'
import { interpretBookingOccasions, type BookingOccasionEvidence } from './booking-occasion-interpreter.js'

export const BOOKING_INTELLIGENCE_RULESET_VERSION = 'booking-intelligence-r1.3.1'

type Evidence = BookingOccasionEvidence
type FindingInput = Omit<BookingIntelligenceFinding, 'sourceCandidateIdentity' | 'evidenceSha256' | 'ruleVersion'>

const clean = (value: string) => value.replace(/\s+/g, ' ').trim()
const candidateIdentity = (record: BookingImportPreviewRecord) => [record.venue, record.reservationDate, record.reservationTime, record.bookingNumber || record.primaryGuest].join('|')

function evidenceFor(record: BookingImportPreviewRecord): Evidence[] {
  const evidence: Evidence[] = []
  if (record.sourceNotes.trim()) evidence.push({ location: 'booking.sourceNotes', text: record.sourceNotes.trim() })
  for (const member of record.guestMembers) if (member.guestNotes.trim()) evidence.push({ location: `guestMembers[${member.sourceRowOrder}].guestNotes`, text: member.guestNotes.trim(), memberIdentity: `source-row-${member.sourceRowOrder}` })
  return evidence
}

function firstPattern(evidence: Evidence[], expression: RegExp) {
  for (const item of evidence) {
    const match = item.text.match(expression)
    if (match) return { item, phrase: match[0] }
  }
  return undefined
}

function evidenceContaining(evidence: Evidence[], phrase: string) {
  return evidence.find(item => item.text.toLowerCase().includes(phrase.toLowerCase()))
}

function finding(record: BookingImportPreviewRecord, input: FindingInput): BookingIntelligenceFinding {
  return {
    ...input,
    sourceCandidateIdentity: candidateIdentity(record),
    evidenceSha256: createHash('sha256').update(`${input.evidenceLocation}\n${input.rawEvidence}`, 'utf8').digest('hex'),
    ruleVersion: BOOKING_INTELLIGENCE_RULESET_VERSION
  }
}

function addReview(record: BookingImportPreviewRecord, reasons: string[]) {
  if (!reasons.length || record.readiness === 'DUPLICATE') return record
  const warnings = [...new Set([...record.warnings, ...reasons])]
  return { ...record, warnings, readiness: 'REVIEW_REQUIRED' as const }
}

function analyzeOne(record: BookingImportPreviewRecord, _occasionTypes: ConfigOption[]) {
  const evidence = evidenceFor(record)
  const findings: BookingIntelligenceFinding[] = []
  const reviews: string[] = []
  const push = (input: FindingInput) => findings.push(finding(record, input))

  const occasionInterpretations = interpretBookingOccasions(evidence)
  for (const match of occasionInterpretations) {
    const visit = match.value === 'siyam_family' ? match.text.match(/\b(\d{1,3})(?:st|nd|rd|th)\s+visit\b/i) : null
    push({ memberIdentity: match.memberIdentity, findingType: 'guest_occasion', normalizedKey: match.normalizedKey, displayLabel: match.label, rawEvidence: match.text, detectedPhrase: match.detectedPhrase, evidenceLocation: match.location, ruleKey: match.ruleKey, sourceValue: match.text, detectedValue: visit ? { occasion: match.value, visitNumber: Number(visit[1]) } : match.value, effectiveCandidate: match.value, resolutionMethod: 'normalized_occasion_interpreter', confidence: 0.98, reviewState: 'NOT_REQUIRED' })
  }

  const tlc = firstPattern(evidence, /\bTLC\b/i)
  if (tlc) push({ memberIdentity: tlc.item.memberIdentity, findingType: 'guest_attention', normalizedKey: 'GUEST_ATTENTION_TLC', displayLabel: 'TLC', rawEvidence: tlc.item.text, detectedPhrase: tlc.phrase, evidenceLocation: tlc.item.location, ruleKey: 'attention.tlc', sourceValue: tlc.item.text, detectedValue: 'TLC', effectiveCandidate: 'TLC', resolutionMethod: 'bounded_token_match', confidence: 0.99, reviewState: 'NOT_REQUIRED' })

  for (const item of evidence) for (const alert of detectBookingAllergyEvidence(item.text)) {
    push({ memberIdentity: item.memberIdentity, findingType: 'allergy', normalizedKey: 'ALLERGY', displayLabel: 'ALLERGY', rawEvidence: item.text, detectedPhrase: alert.detectedPhrase, evidenceLocation: item.location, ruleKey: `allergy.${alert.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, sourceValue: item.text, detectedValue: alert.label, effectiveCandidate: alert.label, resolutionMethod: 'supported_allergy_heuristic', confidence: 0.95, reviewState: 'NOT_REQUIRED' })
  }

  const blockedIdentity = !record.rooms.length && /^(?:blocked)(?:\s+blocked)+$/i.test(clean(record.primaryGuest))
    ? { item: { location: 'booking.primaryGuest', text: record.primaryGuest } as Evidence, phrase: record.primaryGuest }
    : undefined
  const blockedCapacity = firstPattern(evidence, /\b(?:blocked\s+(?:capacity|table|tables|restaurant|seats?)|capacity\s+blocked|blocked\s+for\s+(?:capacity|restaurant|dinner|service))\b/i) || blockedIdentity
  const ambiguousBlocked = !blockedCapacity ? firstPattern(evidence, /\bblocked\b/i) : undefined
  if (blockedCapacity) push({ memberIdentity: blockedCapacity.item.memberIdentity, findingType: 'blocked_capacity', normalizedKey: 'BLOCKED_CAPACITY', displayLabel: 'BLOCKED', rawEvidence: blockedCapacity.item.text, detectedPhrase: blockedCapacity.phrase, evidenceLocation: blockedCapacity.item.location, ruleKey: 'capacity.blocked', sourceValue: record.coverResolution?.baseCovers ?? record.covers, detectedValue: 0, effectiveCandidate: 0, resolutionMethod: blockedIdentity ? 'blocked_identity_sentinel' : 'explicit_capacity_context', confidence: 0.99, reviewState: 'NOT_REQUIRED' })
  if (ambiguousBlocked) {
    const reason = 'Ambiguous BLOCKED wording requires manager review before any zero-cover treatment.'
    reviews.push(reason)
    push({ memberIdentity: ambiguousBlocked.item.memberIdentity, findingType: 'blocked_review', normalizedKey: 'BLOCKED_REVIEW_REQUIRED', displayLabel: 'BLOCKED', rawEvidence: ambiguousBlocked.item.text, detectedPhrase: ambiguousBlocked.phrase, evidenceLocation: ambiguousBlocked.item.location, ruleKey: 'capacity.blocked-ambiguous', sourceValue: record.coverResolution?.baseCovers ?? record.covers, detectedValue: null, effectiveCandidate: record.covers, resolutionMethod: 'ambiguous_context', confidence: 0.5, reviewState: 'REVIEW_REQUIRED' })
  }

  const resolution = record.coverResolution
  const sourcePax = resolution?.baseCovers ?? record.covers
  const detectedPax = resolution?.totalCovers ?? record.covers
  const effectiveCandidatePax = blockedCapacity ? 0 : detectedPax
  if (sourcePax === 1 && detectedPax === 1) {
    const reason = 'Source PAX is 1 with no stronger deterministic evidence; manager review is required.'
    reviews.push(reason)
    push({ findingType: 'pax_review', normalizedKey: 'PAX_REVIEW_REQUIRED', displayLabel: 'PAX REVIEW', rawEvidence: `${record.sourceStatus || 'Source'} (1 pax)`, detectedPhrase: '1 pax', evidenceLocation: 'booking.sourceStatus', ruleKey: 'pax.single-source-review', sourceValue: 1, detectedValue: 1, effectiveCandidate: 1, resolutionMethod: 'single_pax_without_stronger_evidence', confidence: 0.5, reviewState: 'REVIEW_REQUIRED' })
  } else if (sourcePax !== detectedPax && detectedPax !== null) {
    const phrase = resolution?.evidence || `${detectedPax} pax`
    const item = evidenceContaining(evidence, phrase) || evidence[0]
    push({ memberIdentity: item?.memberIdentity, findingType: 'pax_resolution', normalizedKey: 'PAX_RESOLVED', displayLabel: 'PAX', rawEvidence: item?.text || phrase, detectedPhrase: phrase, evidenceLocation: item?.location || 'booking.coverResolution', ruleKey: `pax.${resolution?.source || 'resolved'}`, sourceValue: sourcePax, detectedValue: detectedPax, effectiveCandidate: effectiveCandidatePax, resolutionMethod: resolution?.source || 'existing_pax_resolver', confidence: 0.98, reviewState: 'NOT_REQUIRED' })
  }

  if (resolution?.groupTotal) {
    const phrase = resolution.evidence
    const item = evidenceContaining(evidence, phrase) || evidence[0]
    push({ memberIdentity: item?.memberIdentity, findingType: 'group', normalizedKey: 'GROUP', displayLabel: 'GROUP', rawEvidence: item?.text || phrase, detectedPhrase: phrase, evidenceLocation: item?.location || 'booking.coverResolution', ruleKey: 'pax.group-total', sourceValue: sourcePax, detectedValue: resolution.groupTotal, effectiveCandidate: detectedPax, resolutionMethod: resolution.source, confidence: 0.96, reviewState: 'NOT_REQUIRED' })
  }
  const ambiguousGroup = !resolution?.groupTotal ? firstPattern(evidence, /\b(?:joining\s+(?:another|other)\s+room|joining\s+(?:family|group)(?!\s+(?:with\s+)?\d+\s*pax)|joining\s+with(?!\s+(?:family\s*[,\-]?\s*)?\d+\s*pax)|dinner\s+together(?!\s*\d))\b/i) : undefined
  if (ambiguousGroup) {
    const reason = 'Group linkage or allocation is ambiguous and requires manager review.'
    reviews.push(reason)
    push({ memberIdentity: ambiguousGroup.item.memberIdentity, findingType: 'group_review', normalizedKey: 'GROUP_REVIEW_REQUIRED', displayLabel: 'GROUP REVIEW', rawEvidence: ambiguousGroup.item.text, detectedPhrase: ambiguousGroup.phrase, evidenceLocation: ambiguousGroup.item.location, ruleKey: 'pax.group-ambiguous', sourceValue: sourcePax, detectedValue: null, effectiveCandidate: detectedPax, resolutionMethod: 'ambiguous_group_semantics', confidence: 0.5, reviewState: 'REVIEW_REQUIRED' })
  }
  for (const diagnostic of resolution?.diagnostics || []) if (/conflicting|require manager review|cannot be safely allocated/i.test(diagnostic)) {
    const normalizedKey = /child/i.test(diagnostic) ? 'KIDS_REVIEW_REQUIRED' : /group|linked/i.test(diagnostic) ? 'GROUP_REVIEW_REQUIRED' : 'PAX_REVIEW_REQUIRED'
    const reason = diagnostic
    reviews.push(reason)
    push({ findingType: normalizedKey === 'KIDS_REVIEW_REQUIRED' ? 'kids_review' : normalizedKey === 'GROUP_REVIEW_REQUIRED' ? 'group_review' : 'pax_review', normalizedKey, displayLabel: normalizedKey === 'KIDS_REVIEW_REQUIRED' ? 'KIDS REVIEW' : normalizedKey === 'GROUP_REVIEW_REQUIRED' ? 'GROUP REVIEW' : 'PAX REVIEW', rawEvidence: evidence[0]?.text || resolution?.evidence || diagnostic, detectedPhrase: resolution?.evidence || '', evidenceLocation: evidence[0]?.location || 'booking.coverResolution', ruleKey: 'pax.resolver-diagnostic', sourceValue: sourcePax, detectedValue: detectedPax, effectiveCandidate: effectiveCandidatePax, resolutionMethod: 'resolver_diagnostic', confidence: 0.5, reviewState: 'REVIEW_REQUIRED' })
  }

  const explicitKids = resolution?.explicitKids || 0
  const structuredKids = resolution?.structuredKids || 0
  const resolvedKids = resolution?.kids || 0
  if (resolvedKids > 0) push({ findingType: 'kids', normalizedKey: 'KIDS', displayLabel: 'KIDS', rawEvidence: evidence[0]?.text || `${structuredKids} structured child guest(s)`, detectedPhrase: resolution?.evidence || `${resolvedKids} kids`, evidenceLocation: evidence[0]?.location || 'booking.guestMembers.birthDate', ruleKey: 'kids.reconcile', sourceValue: { structuredKids, explicitKids }, detectedValue: resolvedKids, effectiveCandidate: resolvedKids, resolutionMethod: structuredKids ? explicitKids ? 'structured_and_text_maximum' : 'structured_birth_date' : 'explicit_adults_kids_arithmetic', confidence: 0.97, reviewState: 'NOT_REQUIRED' })
  if (structuredKids > 0 && explicitKids > 0 && structuredKids !== explicitKids) {
    const reason = 'Structured birth-date evidence conflicts with explicit child wording.'
    reviews.push(reason)
    push({ findingType: 'kids_review', normalizedKey: 'KIDS_REVIEW_REQUIRED', displayLabel: 'KIDS REVIEW', rawEvidence: evidence[0]?.text || resolution?.evidence || reason, detectedPhrase: resolution?.evidence || '', evidenceLocation: evidence[0]?.location || 'booking.guestMembers.birthDate', ruleKey: 'kids.conflicting-evidence', sourceValue: { structuredKids, explicitKids }, detectedValue: resolvedKids, effectiveCandidate: resolvedKids, resolutionMethod: 'conflicting_kids_evidence', confidence: 0.5, reviewState: 'REVIEW_REQUIRED' })
  } else if (!resolvedKids) {
    const genericKids = firstPattern(evidence, /\b(?:child|children|kids?|infants?)\b/i)
    if (genericKids) {
      const reason = 'Child wording is present without a deterministic child count.'
      reviews.push(reason)
      push({ memberIdentity: genericKids.item.memberIdentity, findingType: 'kids_review', normalizedKey: 'KIDS_REVIEW_REQUIRED', displayLabel: 'KIDS REVIEW', rawEvidence: genericKids.item.text, detectedPhrase: genericKids.phrase, evidenceLocation: genericKids.item.location, ruleKey: 'kids.generic-wording', sourceValue: 0, detectedValue: null, effectiveCandidate: 0, resolutionMethod: 'generic_child_wording', confidence: 0.5, reviewState: 'REVIEW_REQUIRED' })
    }
  }

  const deduped = [...new Map(findings.map(item => [`${item.findingType}|${item.normalizedKey}|${item.evidenceSha256}|${item.ruleVersion}`, item])).values()]
  const newOccasionKeys = [...new Set(occasionInterpretations.map(item => item.value))].sort()
  const legacyOccasionKeys = [...newOccasionKeys]
  const occasionDiscrepancies: string[] = []
  const paxSemantic: BookingPaxSemantic = blockedCapacity ? 'BLOCKED_CAPACITY'
    : reviews.some(reason => /PAX|group|cover|blocked/i.test(reason)) ? 'MANAGER_REVIEW'
    : resolution?.groupTotal ? 'GROUP_TOTAL'
    : resolution?.source === 'incremental_addition' ? 'INCREMENTAL_ADDITION'
    : resolution?.source === 'structured_member_count' ? 'STRUCTURED_MEMBER_COUNT'
    : 'SOURCE_PAX'
  const operationalContributionPax = Number(effectiveCandidatePax || 0)
  const coverReason = blockedCapacity ? 'Deterministic BLOCKED capacity record contributes zero guest covers.'
    : paxSemantic === 'MANAGER_REVIEW' ? reviews.find(reason => /PAX|group|cover|blocked/i.test(reason)) || 'Cover evidence requires manager review.'
    : resolution?.groupTotal ? `Explicit total-party PAX ${resolution.groupTotal} replaces source PAX for this booking.`
    : resolution?.source === 'incremental_addition' ? `${resolution.evidence} is an explicit incremental addition.`
    : resolution?.source === 'structured_member_count' ? 'No source PAX was present; structured guest rows provide the candidate total.'
    : 'Source/header PAX remains authoritative for this booking.'
  const updated = addReview(record, reviews)
  return {
    ...updated,
    intelligence: {
      rulesetVersion: BOOKING_INTELLIGENCE_RULESET_VERSION,
      findings: deduped,
      sourcePax,
      detectedPax,
      effectiveCandidatePax,
      showPaxComparison: Boolean(reviews.length || blockedCapacity || sourcePax !== detectedPax),
      reviewRequired: reviews.length > 0,
      highPriorityReasons: [...new Set(reviews)],
      legacyOccasionKeys,
      newOccasionKeys,
      occasionDiscrepancies,
      paxSemantic,
      operationalContributionPax,
      coverDelta: operationalContributionPax - Number(sourcePax || 0),
      groupIdentity: resolution?.groupId || null,
      coverReason
    }
  }
}

export function analyzeBookingCandidates(records: BookingImportPreviewRecord[], occasionTypes: ConfigOption[] = []) {
  return records.map(record => analyzeOne(record, occasionTypes))
}

export function reconcileAnalyzedBookingCovers(records: BookingImportPreviewRecord[], rawSectionHeaderTotal: number): BookingCoverReconciliation {
  const ledger: BookingCoverLedgerEntry[] = records.map((record, index) => {
    const intelligence = record.intelligence
    const sourcePax = Number(intelligence?.sourcePax ?? record.coverResolution?.baseCovers ?? record.covers ?? 0)
    const effectiveOperationalPax = Number(intelligence?.operationalContributionPax ?? intelligence?.effectiveCandidatePax ?? record.covers ?? 0)
    return {
      index,
      bookingNumber: record.bookingNumber,
      reservationTime: record.reservationTime,
      rooms: record.rooms,
      sourcePax,
      structuredMemberCount: record.guestMembers.length,
      commentPaxEvidence: record.coverResolution?.evidence || '',
      paxSemantic: intelligence?.paxSemantic || 'SOURCE_PAX',
      effectiveOperationalPax,
      delta: effectiveOperationalPax - sourcePax,
      groupIdentity: intelligence?.groupIdentity || null,
      bookingState: record.readiness === 'DUPLICATE' ? 'EXISTING' : 'NEW',
      reason: intelligence?.coverReason || 'Source/header PAX remains authoritative for this booking.',
      reviewRequired: Boolean(intelligence?.reviewRequired && intelligence.findings.some(item => ['pax_review', 'group_review', 'blocked_review'].includes(item.findingType)))
    }
  })
  const sourceBookingTotal = ledger.reduce((sum, item) => sum + item.sourcePax, 0)
  const positiveAdjustments = ledger.reduce((sum, item) => sum + Math.max(0, item.delta), 0)
  const exclusions = ledger.reduce((sum, item) => sum + Math.max(0, -item.delta), 0)
  const effectiveOperationalTotal = sourceBookingTotal + positiveAdjustments - exclusions
  const arithmeticDifference = effectiveOperationalTotal - (rawSectionHeaderTotal + positiveAdjustments - exclusions)
  const unresolvedRecords = ledger.filter(item => item.reviewRequired).length
  return { rawSectionHeaderTotal, sourceBookingTotal, positiveAdjustments, exclusions, effectiveOperationalTotal, arithmeticDifference, unresolvedRecords, reconciled: sourceBookingTotal === rawSectionHeaderTotal && arithmeticDifference === 0, ledger }
}
