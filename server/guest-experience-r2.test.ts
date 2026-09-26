import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { BookingRepository } from './booking-repository.js'
import { analyzeBookingCandidates } from './booking-intelligence-engine.js'
import { GuestOccasionRepository } from './guest-occasion-repository.js'
import type { AuthPrincipal, BookingImportPreviewRecord, GuestOccasionRecord } from '../src/domain.js'

const db = new PGlite()
await db.exec(await readFile('database/schema.sql', 'utf8'))
await db.exec(await readFile('database/migrations/017_booking_intelligence_foundation.sql', 'utf8'))
const outletId = '00000000-0000-4000-8000-00000000a001'; const userId = randomUUID()
await db.query("insert into outlet_scopes(id,scope_key,display_name,active) values($1,'andalucia','Andalucía',true)", [outletId])
await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status) values($1,'r2.manager','r2.manager','R2 Manager','isolated','active')", [userId])
const bookings = new BookingRepository(db); await bookings.initialize()
const occasions = new GuestOccasionRepository(db); await occasions.initialize()
const source: BookingImportPreviewRecord = { venue:'andalucia',reservationDate:'2026-09-22',reservationTime:'19:00',bookingNumber:'R2-001',primaryGuest:'Multi Flag Guest',rooms:['501'],covers:2,sourceStatus:'confirmed',bookedBy:'HR',sourceNotes:'Birthday guest. Siyam Family. TLC. Nut allergy.',activityLabel:'Andalucía 19:00',walkIn:false,guestMembers:[{guestName:'Multi Flag Guest',roomNumber:'501',accommodationCode:'',birthDate:null,arrivalDate:null,departureDate:null,mealPlan:'',guestNotes:'Birthday guest. Siyam Family. TLC. Nut allergy.',sourceRowOrder:1}],warnings:[],readiness:'READY',coverResolution:{baseCovers:2,totalCovers:2,adults:2,kids:0,structuredKids:0,explicitKids:0,source:'base_confirmed_pax',evidence:'2 pax',diagnostics:[]} }
const analyzed = analyzeBookingCandidates([source])[0]
const preview = await bookings.prepareImportPreview({fileName:'r2.pdf',fileHash:'c'.repeat(64),reportDate:'2026-09-22',parserVersion:'isolated',summary:{bookingGroups:1,totalCovers:2,confirmed:1,pending:0,warnings:0,possibleDuplicates:0},validation:{declaredBookingGroups:1,declaredCovers:2,reconciled:true,messages:[]},bookings:[analyzed]}, 'R2 Manager')
const imported = await bookings.confirmImport(preview.batchId,[0],[],'R2 Manager',userId,outletId)
assert.equal(imported.importedBookings,1)
const bookingId = imported.importedBookingIds[0]
assert.equal(Number((await db.query<{count:number}>('select count(*)::int count from booking_intelligence_findings where booking_id=$1',[bookingId])).rows[0].count),5)
const projected = await occasions.detectForBooking(bookingId,outletId,'R2 Manager')
assert.deepEqual(projected.map(item=>item.occasionType).sort(),['birthday','siyam_family'])
assert.equal((await occasions.detectForBooking(bookingId,outletId,'R2 Manager')).length,0)
const experience = await occasions.experience('2026-09-22',outletId)
assert.equal(experience.groups.celebrations,1); assert.equal(experience.groups.vipSpecial,1); assert.equal(experience.attention.length,2); assert.equal(experience.groups.attentionNeeded,1); assert.equal(experience.groups.completed,0)
assert.deepEqual(experience.attention.map(item=>item.normalizedKey).sort(),['ALLERGY','GUEST_ATTENTION_TLC'])
const configuration = await occasions.configuration(); const birthday = configuration.types.find(item=>item.value==='birthday')!
await assert.rejects(occasions.saveConfiguration('types',{...birthday,value:'mutable_attempt',label:'Birthday Recognition'}),/display color changes only/i)
await assert.rejects(occasions.saveConfiguration('types',{...birthday,active:false}),/display color changes only/i)
const birthdayColor = await occasions.saveConfiguration('types',{...birthday,color:'#224466'})
assert.equal(birthdayColor.value,'birthday'); assert.equal(birthdayColor.label,'Birthday'); assert.equal(birthdayColor.active,true); assert.equal(birthdayColor.color,'#224466')
await assert.rejects(occasions.saveConfiguration('types',{id:randomUUID(),value:'',label:'  SEE-you soon  ',color:'#335577',active:true,metadata:{manualOnly:true}}),/reserved/i)
const manualType = await occasions.saveConfiguration('types',{id:randomUUID(),value:'',label:'Manager Welcome',color:'#335577',active:true,metadata:{defaultStatus:'pending'}})
assert.match(manualType.value,/^manual_[0-9a-f]{32}$/); assert.equal(manualType.metadata?.manualOnly,true); assert.deepEqual(manualType.metadata?.detectionKeywords,[])
const archivedManual = await occasions.saveConfiguration('types',{...manualType,label:'Manager Greeting',color:'#557799',active:false})
assert.equal(archivedManual.value,manualType.value); assert.equal(archivedManual.label,'Manager Greeting'); assert.equal(archivedManual.active,false); assert.equal(archivedManual.color,'#557799')
const pending = configuration.statuses.find(item=>item.value==='pending')!
await assert.rejects(occasions.saveConfiguration('statuses',{...pending,value:'tampered',metadata:{...pending.metadata,occasionWorkflow:'completed',countsAsOccasionAttention:false}}),/display color changes only/i)
const protectedStatus = await occasions.saveConfiguration('statuses',{...pending,color:'#663399'})
assert.equal(protectedStatus.value,'pending'); assert.equal(protectedStatus.metadata?.occasionWorkflow,'attention'); assert.equal(protectedStatus.metadata?.countsAsOccasionAttention,true); assert.equal(protectedStatus.color,'#663399')
const refreshedConfiguration = await occasions.configuration()
assert.deepEqual(refreshedConfiguration.statuses.filter(item=>item.active && ['attention','prepared','completed'].includes(String(item.metadata?.occasionWorkflow))).map(item=>item.label),['Attention','Prepared','Completed'])
assert.notEqual(refreshedConfiguration.statuses.find(item=>item.value==='preparing')?.active,true)
const manual: GuestOccasionRecord = {id:randomUUID(),occasionType:'birthday',bookingId,guestName:'Multi Flag Guest',roomNumber:'501',reservationDate:'2026-09-22',reservationTime:'19:00',tableNumber:'',waiterId:null,waiter:null,status:'pending',source:'manual',sourceText:'Manager-created occasion',notes:'',active:true}
await assert.rejects(occasions.save(manual,'R2 Manager'),/already has/i)
const allergy = (await db.query<{id:string}>("select id from booking_intelligence_findings where booking_id=$1 and normalized_key='ALLERGY'",[bookingId])).rows[0]
const principal: AuthPrincipal = {userId,displayName:'R2 Manager',sessionId:randomUUID(),loginIdentifier:'r2.manager',staffId:null,roleKeys:['owner'],permissionKeys:['manage_guest_occasions'],globalScope:true,allowedOutletScopeIds:[],isOwner:true}
await occasions.correctFinding(allergy.id,'DISMISSED_FALSE_POSITIVE','Manager confirmed no allergy.',principal,outletId)
const corrected = (await db.query<any>('select raw_evidence_text,manager_correction_reason,manager_override_payload from booking_intelligence_findings where id=$1',[allergy.id])).rows[0]
assert.match(corrected.raw_evidence_text,/allergy/i); assert.equal(corrected.manager_correction_reason,'Manager confirmed no allergy.')
assert.equal(Number((await db.query<{count:number}>('select count(*)::int count from audit_logs where entity_type=$1',[ 'booking_intelligence_finding' ])).rows[0].count),1)
console.log(JSON.stringify({normalizedPersistence:true,celebrationProjection:true,vipProjection:true,attentionProjection:true,bookingLevelKpiDeduplication:true,multiFlag:true,idempotent:true,manualDuplicateProtection:true,protectedIdentity:true,manualTypeIsolation:true,protectedWorkflow:true,correctionEvidencePreserved:true,audit:true},null,2))
await db.close()
