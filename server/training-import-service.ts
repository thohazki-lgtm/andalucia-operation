import { randomUUID } from 'node:crypto'
import type { TrainingImportDecision, TrainingImportPreview, TrainingSession } from '../src/domain.js'
import { serviceDate } from '../src/service-date.js'
import type { TrainingRepository } from './training-repository.js'

type TrainingImportLookup = Pick<TrainingRepository, 'configuration' | 'findDuplicate'>

export const prepareTrainingImport = async (
  training: TrainingImportLookup,
  preview: TrainingImportPreview,
  decisions: TrainingImportDecision[],
  options: { replacing?: boolean; allowedDuplicateIds?: Set<string> } = {}
) => {
  const allowedDuplicateIds = options.allowedDuplicateIds || new Set<string>()
  const configuration = await training.configuration()
  const category = configuration.categories.find(option => option.active && option.value === 'other')?.value || configuration.categories.find(option => option.active)?.value || 'other'
  const pending: TrainingSession[] = []
  let skipped = 0
  let duplicates = 0

  for (const decision of decisions) {
    const original = preview.records[decision.index]
    if (!original || decision.action === 'SKIP') { skipped++; continue }

    const duplicateFromReplacedBatch = Boolean(original.duplicateTrainingId && allowedDuplicateIds.has(original.duplicateTrainingId))
    const fileHashOnlyDuplicate = Boolean(preview.duplicateFile && !original.duplicateTrainingId && !original.duplicateWithinFile)
    const replacementAllowsDuplicate = Boolean(options.replacing && (duplicateFromReplacedBatch || fileHashOnlyDuplicate))
    if (original.duplicateWithinFile || (original.readiness === 'DUPLICATE' && !replacementAllowsDuplicate)) { duplicates++; continue }

    const values = decision.action === 'EDIT_BEFORE_IMPORT' && decision.changes ? { ...original, ...decision.changes } : original
    if (!values.topic.trim() || !values.date || !values.startTime || !values.endTime) throw new Error('Training topic, date, start time and end time are required before import.')
    if (values.endTime <= values.startTime) throw new Error('End time must be after start time.')
    if (!values.trainer.trim()) throw new Error('Trainer is required before import.')
    const duplicate = await training.findDuplicate(values.date, values.topic, values.startTime, values.endTime)
    if (duplicate && !allowedDuplicateIds.has(duplicate)) { duplicates++; continue }
    const status = configuration.statuses.find(option => option.active && option.metadata?.trainingStage === (values.date >= serviceDate() ? 'upcoming' : 'planned'))?.value || configuration.statuses.find(option => option.active)?.value || 'planned'
    pending.push({ id: randomUUID(), title: values.topic.trim(), category, date: values.date, time: values.startTime, startTime: values.startTime, endTime: values.endTime, trainer: values.trainer.trim(), location: values.location.trim() || 'Andalucía', status, notes: '', description: '', active: true, attendees: [], source: 'hr_calendar', sourceFileName: preview.fileName, importBatchId: preview.batchId, importedAt: new Date().toISOString(), sourceData: original.originalValues, managerCorrected: decision.action === 'EDIT_BEFORE_IMPORT' })
  }

  return { pending, skipped, duplicates }
}
