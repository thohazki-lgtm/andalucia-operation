import {
  CORE_DUTY_CODES,
  EMPLOYEE_OVERRIDE_LEAVE_CLASSIFICATIONS,
  type EmployeeOverrideLeaveClassification,
  type StaffEntitlementBalance,
  type StaffLeaveEntitlementBalanceLine,
  type StaffLeaveEntitlementOverrides,
} from './domain'

export const normalizedLeaveOverrides = (value: StaffLeaveEntitlementOverrides | null | undefined): StaffLeaveEntitlementOverrides => value && typeof value === 'object' ? value : {}

export const normalizedAdditionalLeave = (value: StaffEntitlementBalance['additionalLeave'] | null | undefined): StaffLeaveEntitlementBalanceLine[] => {
  const existing = new Map((Array.isArray(value) ? value : []).map(line => [line.classification, line]))
  return EMPLOYEE_OVERRIDE_LEAVE_CLASSIFICATIONS.map(classification => existing.get(classification) || unconfiguredLine(classification))
}

const unconfiguredLine = (classification: EmployeeOverrideLeaveClassification): StaffLeaveEntitlementBalanceLine => {
  const definition = CORE_DUTY_CODES.find(item => item.classification === classification)!
  return {
    classification,
    code: definition.code,
    label: definition.label,
    entitlement: null,
    used: 0,
    remaining: null,
    bookedFuture: null,
    availableAfterBooked: null,
  }
}
