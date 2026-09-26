export type WorkflowIntent = 'booking-add' | 'booking-import' | 'chargeable-add' | 'maintenance-add'

let pendingIntent: WorkflowIntent | null = null

export function requestWorkflow(intent: WorkflowIntent) {
  pendingIntent = intent
}

export function consumeWorkflow(intent: WorkflowIntent) {
  if (pendingIntent !== intent) return false
  pendingIntent = null
  return true
}
