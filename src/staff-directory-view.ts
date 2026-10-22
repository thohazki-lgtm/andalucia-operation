import type { ConfigOption, Staff } from './domain'

export const designationLabel = (position: string, positions: ConfigOption[]) => {
  const configured = positions.find(option => option.value === position || option.id === position)
  return configured?.label.trim() || position
}

export const staffDirectorySearchText = (staff: Staff, positions: ConfigOption[]) =>
  `${staff.name} ${staff.number} ${staff.position} ${designationLabel(staff.position, positions)}`.toLowerCase()
