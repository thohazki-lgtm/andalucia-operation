import type { ConfigOption } from './domain.js'

export type DutyPolicyInput = Pick<ConfigOption, 'value' | 'label' | 'metadata'>
export type ApprovedDutyFinancialRule = {
  billTipEligible: boolean
  workedDayUnits: 0 | 1
  explanation: string
}

const annualLeaveRule: ApprovedDutyFinancialRule = { billTipEligible: false, workedDayUnits: 0, explanation: 'Annual Leave is excluded from Bill Tips and worked-day credit.' }
const automaticEligibleRule: ApprovedDutyFinancialRule = { billTipEligible: true, workedDayUnits: 1, explanation: 'This duty category is eligible for Bill Tips with one worked-day credit.' }

export const dutyDisplayIdentity = (duty: DutyPolicyInput) => {
  const code = String(duty.metadata?.displayCode || duty.value).trim().toUpperCase()
  return { code, label: duty.label.trim(), text: `${code} · ${duty.label.trim()}` }
}

export const approvedDutyFinancialRule = (duty: DutyPolicyInput): ApprovedDutyFinancialRule | null => {
  const { code } = dutyDisplayIdentity(duty)
  const classification = duty.metadata?.dutyClassification
  if (code === 'AL' || classification === 'annualLeave') return annualLeaveRule
  if (classification === 'working' || code === 'TRN') return automaticEligibleRule
  return null
}

export const resolvedBillTipEligibility = (duty: DutyPolicyInput): boolean | null => {
  const approved = approvedDutyFinancialRule(duty)
  if (approved) return approved.billTipEligible
  return typeof duty.metadata?.billTipEligible === 'boolean' ? duty.metadata.billTipEligible : null
}

export const resolvedWorkedDayUnits = (duty: DutyPolicyInput): number | null => {
  const approved = approvedDutyFinancialRule(duty)
  if (approved) return approved.workedDayUnits
  const explicit = duty.metadata?.billTipWorkedDayUnits
  if (typeof explicit === 'number' && Number.isInteger(explicit) && explicit >= 0) return explicit
  return null
}

