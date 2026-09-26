import { existsSync } from 'node:fs'
import type { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal, BillTipWorkflowState } from '../src/domain.js'
import { createFinancialFinalizationFingerprint, createOperationalFingerprint } from './database-backup.js'
import { DatabaseBackupAdminService, type BackupInventoryItem } from './database-backup-admin.js'
import { operationMarkerPaths, SUPPORTED_SCHEMA_VERSION, type DatabaseHealth } from './database-protection.js'
import { recoveryActive } from './database-recovery.js'
import { schedulerLockPath } from './database-scheduler.js'
import { BillTipFinalizationService, type BillTipFinalizationContext, type BillTipFinalizationInput } from './bill-tip-finalization-service.js'

const comparable = (value: unknown): unknown => Array.isArray(value)
  ? value.map(comparable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== 'generatedAt').map(([key, item]) => [key, comparable(item)]))
    : value
const same = (left: unknown, right: unknown) => JSON.stringify(comparable(left)) === JSON.stringify(comparable(right))

export type BillTipSafetyState = { ready: boolean; backupId: string | null; createdAt: string | null; blockers: string[] }

export class BillTipWorkflowService {
  readonly finalization: BillTipFinalizationService
  constructor(
    private readonly db: PGlite,
    private readonly health: DatabaseHealth,
    private readonly backupAdmin: DatabaseBackupAdminService,
    private readonly canonicalDirectory: string,
    private readonly recoveryRoot: string,
    today?: () => string
  ) {
    this.finalization = new BillTipFinalizationService(db, today, undefined, async (kind, input) => {
      const safety = await this.safety(kind === 'reopen' ? undefined : input?.backupId)
      if (!safety.ready) throw new Error(`BILL_TIP_FINALIZATION_BLOCKED:${safety.blockers.join(',')}`)
    })
  }

  async safety(requiredBackupId?: string): Promise<BillTipSafetyState> {
    const blockers: string[] = []
    if (this.health.status !== 'HEALTHY') blockers.push('DATABASE_NOT_HEALTHY')
    if (this.health.recoveryRequired) blockers.push('DATABASE_RECOVERY_REQUIRED')
    if (this.health.migrationVersion !== SUPPORTED_SCHEMA_VERSION || this.health.migrationRequired) blockers.push('CURRENT_SUPPORTED_SCHEMA_REQUIRED')
    const markers = operationMarkerPaths(this.canonicalDirectory)
    if (existsSync(markers.migration)) blockers.push('MIGRATION_IN_PROGRESS')
    if (existsSync(markers.recovery) || recoveryActive(this.canonicalDirectory, this.recoveryRoot)) blockers.push('RECOVERY_IN_PROGRESS')
    if (existsSync(schedulerLockPath(this.backupAdmin.backupRoot))) blockers.push('BACKUP_OR_REHEARSAL_IN_PROGRESS')
    if (blockers.length) return { ready: false, backupId: null, createdAt: null, blockers }
    const inventory = await this.backupAdmin.inventory()
    const candidates = inventory.filter(item => item.category === 'pre-finalization').filter(item => !requiredBackupId || item.backupId === requiredBackupId)
    const currentFingerprint = await createOperationalFingerprint(this.db)
    const currentFinancialFingerprint = await createFinancialFinalizationFingerprint(this.db)
    const selected = candidates.find(item => this.validBackup(item, currentFingerprint, currentFinancialFingerprint))
    if (!selected) {
      if (requiredBackupId && !candidates.length) blockers.push('PRE_FINALIZATION_BACKUP_NOT_FOUND')
      else blockers.push('VERIFIED_PRE_FINALIZATION_BACKUP_REQUIRED')
      return { ready: false, backupId: requiredBackupId || null, createdAt: null, blockers }
    }
    return { ready: true, backupId: selected.backupId, createdAt: selected.createdAt, blockers: [] }
  }

  private validBackup(item: BackupInventoryItem, currentFingerprint: Record<string, unknown>, currentFinancialFingerprint: Record<string, unknown>) {
    return item.verificationStatus === 'VERIFIED' && item.restoreTestStatus === 'RESTORE_TEST_PASSED' && item.protected && item.schemaVersion === SUPPORTED_SCHEMA_VERSION && Boolean(item.operationalFingerprint) && same(item.operationalFingerprint, currentFingerprint) && Boolean(item.financialFinalizationFingerprint) && same(item.financialFinalizationFingerprint, currentFinancialFingerprint)
  }

  async state(month: string, outlet: { id: string; key: string; name: string }): Promise<BillTipWorkflowState> {
    const history = (await this.finalization.history(month, outlet.id)).filter((item): item is NonNullable<typeof item> => Boolean(item))
    const backup = await this.safety()
    return { month, outlet, database: { status: this.health.status, recoveryRequired: this.health.recoveryRequired, schemaVersion: this.health.migrationVersion }, backup, history, activeCorrection: history.find(item => item.status === 'correction_in_review') || null, currentFinalized: history.find(item => item.status === 'finalized' && item.isCurrent) || null }
  }

  finalize(input: BillTipFinalizationInput, outletScopeId: string, actor: AuthPrincipal) { return this.finalization.finalizeInitial(input, { outletScopeId, actor }) }
  reopen(id: string, reason: string, correctionKey: string, context: BillTipFinalizationContext) { return this.finalization.reopen(id, reason, correctionKey, context) }
  refinalize(id: string, input: BillTipFinalizationInput, context: BillTipFinalizationContext) { return this.finalization.refinalize(id, input, context) }
}
