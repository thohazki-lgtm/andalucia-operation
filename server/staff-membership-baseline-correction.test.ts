import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'
import { ANDALUCIA_SCOPE_KEY, OutletMembershipRepository } from './outlet-membership-repository.js'
import { StaffMembershipBaselineService } from './staff-membership-baseline-service.js'

const storage=await mkdtemp(join(tmpdir(),'andalucia-baseline-correction-')),path=join(storage,'postgres'),seed=new PGlite(path)
await seed.exec(await readFile('database/schema.sql','utf8'));await seed.close()
const repository=new StaffRepository(path,new PGlite(path))
try{
  await repository.initialize();const db=repository.getDatabase(),service=new StaffMembershipBaselineService(db),memberships=new OutletMembershipRepository(db);await memberships.initialize()
  const actor={userId:randomUUID(),displayName:'Isolated Platform Owner'}
  await db.query('insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status) values($1,$2,$2,$3,$4,\'active\')',[actor.userId,'isolated.owner',actor.displayName,'test-only-hash'])
  const outlet=(await memberships.findOutletByKey(ANDALUCIA_SCOPE_KEY))!,staff=(await repository.list()).filter(item=>item.employmentStatus==='active'),[a,b,c]=staff
  const first=await service.beginReview('2026-09',ANDALUCIA_SCOPE_KEY,actor)
  await service.saveSelection(first.id,{staffId:a.id,included:true,effectiveFrom:'2026-09-01',effectiveTo:'2026-09-30'},actor)
  await service.saveSelection(first.id,{staffId:b.id,included:true,effectiveFrom:'2026-09-01',effectiveTo:'2026-09-30'},actor)
  const approved1=await service.approve(first.id,actor);assert.equal(approved1.review.revisionNumber,1)
  await assert.rejects(()=>service.reopen(first.id,{outletScopeId:outlet.id,month:'2026-09',reason:'   '},actor),/correction reason/i)
  await assert.rejects(()=>service.reopen(first.id,{outletScopeId:randomUUID(),month:'2026-09',reason:'Wrong outlet'},actor),/outlet or month/i)
  const revision1Selections=JSON.stringify((await db.query('select staff_id,included,effective_from::text,effective_to::text from staff_membership_baseline_selections where review_id=$1 order by staff_id',[first.id])).rows)
  const second=await service.reopen(first.id,{outletScopeId:outlet.id,month:'2026-09',reason:'Correct opening team dates'},actor)
  assert.equal(second.revisionNumber,2);assert.equal(second.status,'correction_in_review');assert.equal(second.previousRevisionId,first.id)
  await assert.rejects(()=>service.reopen(first.id,{outletScopeId:outlet.id,month:'2026-09',reason:'Retry'},actor),/correction revision is already in review/i)
  assert.equal(JSON.stringify((await db.query('select staff_id,included,effective_from::text,effective_to::text from staff_membership_baseline_selections where review_id=$1 order by staff_id',[first.id])).rows),revision1Selections)
  await service.saveSelection(second.id,{staffId:a.id,included:false,effectiveFrom:'2026-09-01',effectiveTo:'2026-09-30'},actor)
  await service.saveSelection(second.id,{staffId:b.id,included:true,effectiveFrom:'2026-09-05',effectiveTo:'2026-09-28'},actor)
  await service.saveSelection(second.id,{staffId:c.id,included:true,effectiveFrom:'2026-09-01',effectiveTo:'2026-09-30'},actor)
  const diff=await service.diff(second.id);assert.deepEqual(diff?.summary,{added:1,removed:1,dateChanges:1,unchanged:0})
  const draftResolution=await memberships.resolveRegularStaffScope('2026-09',ANDALUCIA_SCOPE_KEY);assert.equal(draftResolution.members.some(item=>item.staffId===a.id),true);assert.equal(draftResolution.members.some(item=>item.staffId===c.id),false)
  const approved2=await service.approve(second.id,actor);assert.equal(approved2.review.revisionNumber,2);assert.equal((await service.approve(second.id,actor)).status,'BASELINE_ALREADY_APPROVED')
  const history=await service.history('2026-09',ANDALUCIA_SCOPE_KEY);assert.deepEqual(history.map(item=>[item.revisionNumber,item.status,item.isAuthoritative]),[[2,'approved',true],[1,'superseded',false]])
  const resolved=await memberships.resolveRegularStaffScope('2026-09',ANDALUCIA_SCOPE_KEY);assert.equal(resolved.members.some(item=>item.staffId===a.id),false);assert.equal(resolved.members.some(item=>item.staffId===b.id),true);assert.equal(resolved.members.some(item=>item.staffId===c.id),true)
  assert.equal((await db.query<{count:number}>('select count(*)::int count from staff_membership_history where baseline_revision_id=$1',[first.id])).rows[0].count,2)
  assert.equal((await db.query<{count:number}>("select count(*)::int count from audit_logs where entity_type='staff_membership_baseline' and after_data->>'actorUserId'=$1",[actor.userId])).rows[0].count>0,true)
  assert.equal((await db.query<{count:number}>("select count(*)::int count from staff_membership_baseline_reviews where outlet_scope_id=$1 and baseline_month='2026-09' and status='correction_in_review'",[outlet.id])).rows[0].count,0)
  const october=await service.beginReview('2026-10',ANDALUCIA_SCOPE_KEY,actor)
  await service.saveSelection(october.id,{staffId:b.id,included:true,effectiveFrom:'2026-10-01',effectiveTo:'2026-10-31'},actor)
  await service.approve(october.id,actor)
  const concurrent=await Promise.allSettled([service.reopen(october.id,{outletScopeId:outlet.id,month:'2026-10',reason:'Concurrent A'},actor),service.reopen(october.id,{outletScopeId:outlet.id,month:'2026-10',reason:'Concurrent B'},actor)])
  assert.equal(concurrent.filter(item=>item.status==='fulfilled').length,1);assert.equal(concurrent.filter(item=>item.status==='rejected').length,1)
  assert.equal((await db.query<{count:number}>("select count(*)::int count from staff_membership_baseline_reviews where outlet_scope_id=$1 and baseline_month='2026-10' and status='correction_in_review'",[outlet.id])).rows[0].count,1)
  console.log(JSON.stringify({revision1Immutable:true,revision2Draft:true,mandatoryReason:true,outletScopeChecked:true,diff:diff?.summary,draftNotAuthoritative:true,latestApprovedResolver:true,historyPreserved:true,duplicateReopenRejected:true,concurrentReopenSingleDraft:true,duplicateApprovalIdempotent:true,auditActorUuid:true},null,2))
}finally{await repository.getDatabase().close().catch(()=>undefined);await rm(storage,{recursive:true,force:true})}
