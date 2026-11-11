import type { AuthPrincipal } from '../src/domain.js'

export const canManageRosterMonthLock = (principal: Pick<AuthPrincipal, 'isOwner' | 'roleKeys'>) =>
  principal.isOwner || principal.roleKeys.includes('outlet_manager')
