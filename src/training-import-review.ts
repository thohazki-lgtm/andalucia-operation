import type { TrainingImportDecision, TrainingImportRecord, TrainingImportResult } from './domain'

export const defaultTrainingImportAction = (record: TrainingImportRecord): TrainingImportDecision['action'] => record.readiness === 'READY' ? 'IMPORT_ANYWAY' : record.readiness === 'REVIEW_REQUIRED' ? 'EDIT_BEFORE_IMPORT' : 'SKIP'

export const defaultTrainingReplacementAction = (record: TrainingImportRecord, replacedSessionIds = new Set<string>()): TrainingImportDecision['action'] => record.duplicateWithinFile || Boolean(record.duplicateTrainingId && !replacedSessionIds.has(record.duplicateTrainingId)) ? 'SKIP' : record.warnings.length ? 'EDIT_BEFORE_IMPORT' : 'IMPORT_ANYWAY'

export const trainingImportSelectionSummary = (records: TrainingImportRecord[], decisions: Record<number, TrainingImportDecision['action']>) => {
  const selected = records.filter((record, index) => record.readiness !== 'DUPLICATE' && decisions[index] !== 'SKIP')
  const skipped = records.filter((record, index) => record.readiness !== 'DUPLICATE' && decisions[index] === 'SKIP').length
  const invalidSelected = selected.filter(record => !record.topic.trim() || !record.date || !record.startTime || !record.endTime || !record.trainer.trim()).length
  return { selected: selected.length, selectedReady: selected.filter(record => record.readiness === 'READY').length, approvedReview: selected.filter(record => record.readiness === 'REVIEW_REQUIRED').length, skipped, duplicates: records.filter(record => record.readiness === 'DUPLICATE').length, invalidSelected }
}

export const trainingImportResultMessage = (result: TrainingImportResult) => result.removed
  ? `HR Training Calendar removed successfully. ${result.removed} imported training session${result.removed === 1 ? '' : 's'} were removed.`
  : result.previousImportRemoved !== undefined
    ? `Previous HR import replaced successfully. ${result.imported} training session${result.imported === 1 ? '' : 's'} imported. ${result.failed || 0} failed.`
    : result.imported === 0 && result.skipped > 0 && result.duplicates === 0
      ? 'No training sessions were imported because all detected records were skipped.'
      : `${result.imported} training${result.imported === 1 ? '' : 's'} imported. ${result.skipped} skipped by manager, ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'}, ${result.failed || 0} failed.`
