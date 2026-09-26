import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal, BillTipVersionDiff, BillTipVersionSnapshot, FinancialPreviewExternalAllocation, FinancialManagerPreview } from '../src/domain.js'
import { serviceDate } from '../src/service-date.js'
import { parseFixed } from './financial-decimal.js'
import { FinancialPreviewService } from './financial-preview-service.js'
import { assertRecoveryInactive } from './database-recovery.js'

export type BillTipFinalizationInput = { month: string; totalPool: string; externalAllocations: FinancialPreviewExternalAllocation[]; idempotencyKey: string; backupId?: string }
export type BillTipFinalizationContext = { outletScopeId: string; actor: AuthPrincipal }
type MutationKind = 'finalize' | 'reopen' | 'refinalize'
const actorLabel = (actor: AuthPrincipal) => `${actor.displayName} [${actor.userId}]`
const assertKey = (value: string) => { if (!value?.trim()) throw new Error('A finalization idempotency key is required.'); return value.trim() }

export class BillTipFinalizationService {
  private readonly previewer: FinancialPreviewService
  constructor(private readonly db: PGlite, private readonly today = serviceDate, private readonly recoveryGuard = assertRecoveryInactive, private readonly mutationGuard: (kind: MutationKind, input: BillTipFinalizationInput | null, context: BillTipFinalizationContext) => Promise<void> | void = () => undefined) { this.previewer = new FinancialPreviewService(db) }

  async schemaReady() { return Boolean((await this.db.query<{ present: boolean }>("select exists(select 1 from information_schema.columns where table_name='bill_tip_distributions' and column_name='version_number') present")).rows[0]?.present) }

  private validate(preview: FinancialManagerPreview) {
    if (preview.periodStatus !== 'CLOSED') throw new Error('Month still in progress.')
    if (parseFixed(preview.billTips.totalPool, 2) <= 0n) throw new Error('The total Bill Tip pool must be greater than zero.')
    if (preview.billTips.reviewStatus !== 'READY') throw new Error('Historical roster or data-integrity blockers must be resolved before finalization.')
    const total = parseFixed(preview.billTips.regularStaffDistributed, 2) + parseFixed(preview.billTips.externalAllocationTotal, 2) + parseFixed(preview.billTips.roundingRemainder, 2)
    if (total !== parseFixed(preview.billTips.totalPool, 2)) throw new Error('Bill Tip reconciliation does not balance exactly.')
  }

  private async insertSnapshot(tx: any, id: string, version: number, status: 'draft'|'correction_in_review', preview: FinancialManagerPreview, input: BillTipFinalizationInput, context: BillTipFinalizationContext, previousId: string|null, reason: string|null, correctionKey: string|null) {
    const who=actorLabel(context.actor)
    await tx.query(`insert into bill_tip_distributions(id,outlet_scope_id,team_membership_revision_id,distribution_month,version_number,status,is_current,previous_version_id,correction_reason,reopened_at,reopened_by_user_id,reopened_by_name,pool_amount,external_allocation_total,remaining_team_pool,total_eligible_days,eligible_staff_count,value_per_eligible_day,regular_staff_distributed,undistributed_remainder,reconciliation_total,policy_version,policy_metadata,calculated_at,calculated_by,finalization_key,correction_key,created_by,updated_by)
      values($1,$2,$3,$4,$5,$6,false,$7::uuid,$8,case when $7::uuid is null then null else now() end,case when $7::uuid is null then null else $9::uuid end,case when $7::uuid is null then null else $10 end,$11,$12,$13,$14,$15,$16,$17,$18,$11,'bill-tip-v1',$19,now(),$10,$20,$21,$10,$10)`,
      [id,context.outletScopeId,preview.membership.revisionId,input.month,version,status,previousId,reason,context.actor.userId,context.actor.displayName,preview.billTips.totalPool,preview.billTips.externalAllocationTotal,preview.billTips.remainingRegularTeamPool,preview.billTips.totalEligibleRecordedDays,preview.billTips.staff.length,preview.billTips.valuePerEligibleDay,preview.billTips.regularStaffDistributed,preview.billTips.roundingRemainder,JSON.stringify({membershipRevisionNumber:preview.membership.revisionNumber,asOfDate:preview.asOfDate}),status==='draft'?assertKey(input.idempotencyKey):null,correctionKey])
    for(const staff of preview.billTips.staff) await tx.query(`insert into bill_tip_staff_allocations(id,distribution_id,staff_id,staff_name_snapshot,staff_number_snapshot,designation_snapshot,membership_effective_from,membership_effective_to,eligible_days,excluded_al_days,other_excluded_days,missing_roster_days,requires_roster_review,value_per_eligible_day,calculated_amount,final_amount,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)`,[randomUUID(),id,staff.staffId,staff.staffName,staff.staffNumber,staff.designation,staff.membershipFrom,staff.membershipTo,staff.eligibleRecordedDays,staff.alDaysExcluded,staff.otherExcludedDays,staff.historicalMissingRosterDays,staff.reviewStatus!=='READY',preview.billTips.valuePerEligibleDay,staff.calculatedBillTip,staff.calculatedBillTip,who])
    for(const item of preview.billTips.externalAllocations) await tx.query(`insert into bill_tip_manual_allocations(id,distribution_id,linked_staff_id,helper_name,staff_reference,department,outlet,fixed_amount,reason,notes,idempotency_key,created_by,updated_by) values($1,$2,null,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,[randomUUID(),id,item.name,item.staffReference||null,item.departmentOutlet||null,item.departmentOutlet||null,item.fixedAmount,'External/support allocation',item.remarks||'',item.id,who])
  }

  async finalizeInitial(input: BillTipFinalizationInput, context: BillTipFinalizationContext) {
    this.recoveryGuard()
    assertKey(input.idempotencyKey)
    const existing=(await this.db.query<any>('select id,status from bill_tip_distributions where outlet_scope_id=$1 and distribution_month=$2 and finalization_key=$3',[context.outletScopeId,input.month,input.idempotencyKey])).rows[0]
    if(existing) return this.version(existing.id)
    await this.mutationGuard('finalize', input, context)
    const preview=await this.previewer.preview({...input,outletScopeId:context.outletScopeId,asOfDate:this.today()}); this.validate(preview)
    const id=randomUUID(),who=actorLabel(context.actor)
    await this.db.transaction(async tx=>{
      const conflict=(await tx.query("select id from bill_tip_distributions where outlet_scope_id=$1 and distribution_month=$2 and (is_current=true or status in ('draft','correction_in_review')) for update",[context.outletScopeId,input.month])).rows[0]
      if(conflict) throw new Error('A Bill Tip version already exists for this outlet and month.')
      await this.insertSnapshot(tx,id,1,'draft',preview,input,context,null,null,null)
      await tx.query("update bill_tip_distributions set status='finalized',is_current=true,finalized_at=now(),finalized_by=$2,finalized_by_user_id=$3,finalized_by_name=$4,updated_by=$2,updated_at=now() where id=$1 and status='draft'",[id,who,context.actor.userId,context.actor.displayName])
      await tx.query('insert into audit_logs(id,entity_type,entity_id,action,after_data,actor) values($1,$2,$3,$4,$5,$6)',[randomUUID(),'bill_tip_distribution',id,'finalization_completed',JSON.stringify({outletScopeId:context.outletScopeId,month:input.month,version:1,actorUserId:context.actor.userId}),who])
    })
    return this.version(id)
  }

  async reopen(id:string,reason:string,correctionKey:string,context:BillTipFinalizationContext){
    this.recoveryGuard()
    if(!reason.trim())throw new Error('A correction reason is required.');assertKey(correctionKey)
    const retry=(await this.db.query<any>('select id from bill_tip_distributions where correction_key=$1 and outlet_scope_id=$2',[correctionKey,context.outletScopeId])).rows[0];if(retry)return this.version(retry.id)
    await this.mutationGuard('reopen', null, context)
    const source=await this.version(id);if(!source||source.outletScopeId!==context.outletScopeId||source.status!=='finalized'||!source.isCurrent)throw new Error('Only the current finalized Bill Tip version may be reopened.')
    const draftId=randomUUID(),who=actorLabel(context.actor)
    await this.db.transaction(async tx=>{
      const active=(await tx.query("select id from bill_tip_distributions where outlet_scope_id=$1 and distribution_month=$2 and status='correction_in_review' for update",[context.outletScopeId,source.month])).rows[0];if(active)throw new Error('A Bill Tip correction is already in review.')
      await tx.query(`insert into bill_tip_distributions(id,outlet_scope_id,team_membership_revision_id,distribution_month,version_number,status,is_current,previous_version_id,correction_reason,reopened_at,reopened_by_user_id,reopened_by_name,pool_amount,external_allocation_total,remaining_team_pool,total_eligible_days,eligible_staff_count,value_per_eligible_day,regular_staff_distributed,undistributed_remainder,reconciliation_total,policy_version,policy_metadata,calculated_at,calculated_by,correction_key,created_by,updated_by) select $1,outlet_scope_id,team_membership_revision_id,distribution_month,version_number+1,'correction_in_review',false,id,$2,now(),$3,$4,pool_amount,external_allocation_total,remaining_team_pool,total_eligible_days,eligible_staff_count,value_per_eligible_day,regular_staff_distributed,undistributed_remainder,reconciliation_total,policy_version,policy_metadata,now(),$5,$6,$5,$5 from bill_tip_distributions where id=$7`,[draftId,reason.trim(),context.actor.userId,context.actor.displayName,who,correctionKey,id])
      await tx.query('insert into bill_tip_staff_allocations(id,distribution_id,staff_id,staff_name_snapshot,staff_number_snapshot,designation_snapshot,membership_effective_from,membership_effective_to,eligible_days,excluded_al_days,other_excluded_days,missing_roster_days,requires_roster_review,value_per_eligible_day,calculated_amount,final_amount,created_by,updated_by) select gen_random_uuid(),$1,staff_id,staff_name_snapshot,staff_number_snapshot,designation_snapshot,membership_effective_from,membership_effective_to,eligible_days,excluded_al_days,other_excluded_days,missing_roster_days,requires_roster_review,value_per_eligible_day,calculated_amount,final_amount,$2,$2 from bill_tip_staff_allocations where distribution_id=$3',[draftId,who,id])
      await tx.query('insert into bill_tip_manual_allocations(id,distribution_id,linked_staff_id,helper_name,staff_reference,department,outlet,fixed_amount,reason,notes,idempotency_key,created_by,updated_by) select gen_random_uuid(),$1,linked_staff_id,helper_name,staff_reference,department,outlet,fixed_amount,reason,notes,idempotency_key,$2,$2 from bill_tip_manual_allocations where distribution_id=$3',[draftId,who,id])
      await tx.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),'bill_tip_distribution',draftId,'correction_created',JSON.stringify(source),JSON.stringify({reason:reason.trim(),sourceVersion:id,actorUserId:context.actor.userId}),who])
    });return this.version(draftId)
  }

  async refinalize(id:string,input:BillTipFinalizationInput,context:BillTipFinalizationContext){
    this.recoveryGuard()
    const current=await this.version(id);if(!current)throw new Error('Bill Tip correction version not found.');if(current.status==='finalized')return current;if(current.status!=='correction_in_review'||current.outletScopeId!==context.outletScopeId)throw new Error('Only an active correction may be re-finalized.')
    await this.mutationGuard('refinalize', input, context)
    const preview=await this.previewer.preview({...input,month:current.month,outletScopeId:context.outletScopeId,asOfDate:this.today()});this.validate(preview);const who=actorLabel(context.actor)
    await this.db.transaction(async tx=>{
      await tx.query('delete from bill_tip_staff_allocations where distribution_id=$1',[id]);await tx.query('delete from bill_tip_manual_allocations where distribution_id=$1',[id])
      await tx.query(`update bill_tip_distributions set team_membership_revision_id=$2,pool_amount=$3,external_allocation_total=$4,remaining_team_pool=$5,total_eligible_days=$6,eligible_staff_count=$7,value_per_eligible_day=$8,regular_staff_distributed=$9,undistributed_remainder=$10,reconciliation_total=$3,policy_metadata=$11,calculated_at=now(),calculated_by=$12,updated_by=$12,updated_at=now() where id=$1 and status='correction_in_review'`,[id,preview.membership.revisionId,preview.billTips.totalPool,preview.billTips.externalAllocationTotal,preview.billTips.remainingRegularTeamPool,preview.billTips.totalEligibleRecordedDays,preview.billTips.staff.length,preview.billTips.valuePerEligibleDay,preview.billTips.regularStaffDistributed,preview.billTips.roundingRemainder,JSON.stringify({membershipRevisionNumber:preview.membership.revisionNumber,asOfDate:preview.asOfDate}),who])
      for(const s of preview.billTips.staff)await tx.query(`insert into bill_tip_staff_allocations(id,distribution_id,staff_id,staff_name_snapshot,staff_number_snapshot,designation_snapshot,membership_effective_from,membership_effective_to,eligible_days,excluded_al_days,other_excluded_days,missing_roster_days,requires_roster_review,value_per_eligible_day,calculated_amount,final_amount,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13,$14,$14,$15,$15)`,[randomUUID(),id,s.staffId,s.staffName,s.staffNumber,s.designation,s.membershipFrom,s.membershipTo,s.eligibleRecordedDays,s.alDaysExcluded,s.otherExcludedDays,s.historicalMissingRosterDays,preview.billTips.valuePerEligibleDay,s.calculatedBillTip,who])
      for(const e of preview.billTips.externalAllocations)await tx.query(`insert into bill_tip_manual_allocations(id,distribution_id,helper_name,staff_reference,department,outlet,fixed_amount,reason,notes,idempotency_key,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,[randomUUID(),id,e.name,e.staffReference||null,e.departmentOutlet||null,e.departmentOutlet||null,e.fixedAmount,'External/support allocation',e.remarks||'',e.id,who])
      await tx.query("update bill_tip_distributions set status='superseded',is_current=false,updated_by=$2,updated_at=now() where id=$1 and status='finalized' and is_current=true",[current.previousVersionId,who])
      await tx.query("update bill_tip_distributions set status='finalized',is_current=true,finalized_at=now(),finalized_by=$2,finalized_by_user_id=$3,finalized_by_name=$4,finalization_key=$5,updated_by=$2,updated_at=now() where id=$1 and status='correction_in_review'",[id,who,context.actor.userId,context.actor.displayName,assertKey(input.idempotencyKey)])
      await tx.query('insert into audit_logs(id,entity_type,entity_id,action,after_data,actor) values($1,$2,$3,$4,$5,$6)',[randomUUID(),'bill_tip_distribution',id,'correction_finalized',JSON.stringify({outletScopeId:context.outletScopeId,month:current.month,version:current.version,actorUserId:context.actor.userId}),who])
    });return this.version(id)
  }

  async version(id:string):Promise<BillTipVersionSnapshot|null>{
    const r=(await this.db.query<any>(`select id,outlet_scope_id,distribution_month,version_number,status,is_current,previous_version_id,correction_reason,team_membership_revision_id,pool_amount::text,external_allocation_total::text,remaining_team_pool::text,total_eligible_days,eligible_staff_count,value_per_eligible_day::text,regular_staff_distributed::text,undistributed_remainder::text,reconciliation_total::text,finalized_at::text,finalized_by_user_id,finalized_by_name,reopened_at::text,reopened_by_name,created_at::text,created_by,policy_metadata from bill_tip_distributions where id=$1`,[id])).rows[0]
    if(!r)return null
    const staff=(await this.db.query<any>(`select staff_id,staff_name_snapshot,staff_number_snapshot,designation_snapshot,membership_effective_from::text,membership_effective_to::text,eligible_days,excluded_al_days,other_excluded_days,missing_roster_days,value_per_eligible_day::text,final_amount::text from bill_tip_staff_allocations where distribution_id=$1 order by staff_name_snapshot,staff_number_snapshot`,[id])).rows
    const external=(await this.db.query<any>(`select id,helper_name,staff_reference,coalesce(department,outlet) department_outlet,fixed_amount::text,notes from bill_tip_manual_allocations where distribution_id=$1 order by helper_name,id`,[id])).rows
    const metadata=typeof r.policy_metadata==='string'?JSON.parse(r.policy_metadata):r.policy_metadata||{}
    return{id:r.id,outletScopeId:r.outlet_scope_id,month:r.distribution_month,version:Number(r.version_number),status:r.status,isCurrent:r.is_current,previousVersionId:r.previous_version_id,correctionReason:r.correction_reason,membershipRevisionId:r.team_membership_revision_id,membershipRevisionNumber:Number(metadata.membershipRevisionNumber)||null,pool:r.pool_amount,external:r.external_allocation_total,regularPool:r.remaining_team_pool,eligibleDays:Number(r.total_eligible_days),staffCount:Number(r.eligible_staff_count),valuePerDay:r.value_per_eligible_day,distributed:r.regular_staff_distributed,remainder:r.undistributed_remainder,reconciliation:r.reconciliation_total,finalizedAt:r.finalized_at,finalizedByUserId:r.finalized_by_user_id,finalizedByName:r.finalized_by_name,reopenedAt:r.reopened_at,reopenedByName:r.reopened_by_name,createdAt:r.created_at,createdBy:r.created_by,staff:staff.map(s=>({staffId:s.staff_id,staffName:s.staff_name_snapshot,staffNumber:s.staff_number_snapshot,designation:s.designation_snapshot,membershipFrom:s.membership_effective_from,membershipTo:s.membership_effective_to,eligibleDays:Number(s.eligible_days),alExcluded:Number(s.excluded_al_days),otherExcluded:Number(s.other_excluded_days),historicalMissing:Number(s.missing_roster_days),valuePerDay:s.value_per_eligible_day,finalAmount:s.final_amount})),externalAllocations:external.map(e=>({id:e.id,name:e.helper_name,staffReference:e.staff_reference,departmentOutlet:e.department_outlet,fixedAmount:e.fixed_amount,remarks:e.notes||''}))}
  }
  async history(month:string,outletScopeId:string){const ids=(await this.db.query<{id:string}>('select id from bill_tip_distributions where outlet_scope_id=$1 and distribution_month=$2 order by version_number desc',[outletScopeId,month])).rows;return Promise.all(ids.map(row=>this.version(row.id)))}
  async diff(id:string):Promise<BillTipVersionDiff|null>{const next=await this.version(id);if(!next?.previousVersionId)return null;const previous=await this.version(next.previousVersionId);if(!previous)return null;const ids=[...new Set([...previous.staff,...next.staff].map(x=>x.staffId))];return{previousVersion:previous.version,correctionVersion:next.version,totalPool:{before:previous.pool,after:next.pool},external:{before:previous.external,after:next.external},eligibleDays:{before:previous.eligibleDays,after:next.eligibleDays},valuePerDay:{before:previous.valuePerDay,after:next.valuePerDay},rounding:{before:previous.remainder,after:next.remainder},membershipRevision:{before:previous.membershipRevisionId,after:next.membershipRevisionId},staff:ids.map(staffId=>{const before=previous.staff.find(x=>x.staffId===staffId),after=next.staff.find(x=>x.staffId===staffId);return{staffId,staffName:after?.staffName||before?.staffName||'Unknown staff',staffNumber:after?.staffNumber||before?.staffNumber||'',change:!before?'ADDED':!after?'REMOVED':before.finalAmount!==after.finalAmount||before.eligibleDays!==after.eligibleDays?'CHANGED':'UNCHANGED',before:before?.finalAmount||null,after:after?.finalAmount||null}})}}
}
