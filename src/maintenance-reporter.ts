import type { Staff } from './domain'

const normalizedOutlet = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

export const isActiveAndaluciaStaff = (person: Staff) => person.employmentStatus === 'active' && normalizedOutlet(person.outlet).includes('andalucia')

export const defaultMaintenanceReporterId = (staff: Staff[], authenticatedStaffId: string | null) => {
  if (!authenticatedStaffId) return null
  const linked = staff.find(person => person.id === authenticatedStaffId)
  return linked && isActiveAndaluciaStaff(linked) ? linked.id : null
}
