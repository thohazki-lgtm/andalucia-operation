import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal, ConfigOption, IncentiveRule, WineSpiritCalculation, WineSpiritSale, WineSpiritSaleInput, WineSpiritSaleWriteRequest } from '../src/domain.js'
import { IncentivesCalculationService } from './incentives-calculation-service.js'

export interface WineSpiritWriteContext { outletScopeId: string; actor: AuthPrincipal }

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
const parseMetadata = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value || {}
const tierLabel = (minimum: string, maximum: string | null, rewardMode: string, rewardValue: string) => {
  const range = maximum == null ? `$${Number(minimum).toFixed(0)}+` : `$${Number(minimum).toFixed(0)}–$${Math.floor(Number(maximum))}`
  const reward = rewardMode === 'percentage' ? `${Number(rewardValue).toFixed(1)}%` : `$${Number(rewardValue).toFixed(2)}`
  return `${range} · ${reward}`
}

export class WineSpiritsRepository {
  private readonly calculator: IncentivesCalculationService
  constructor(private readonly db: PGlite) { this.calculator = new IncentivesCalculationService(db) }

  async catalog(): Promise<ConfigOption[]> {
    const rows = (await this.db.query<any>("select id,value,label,metadata,active,sort_order from configuration_options where group_key='wine_spirit_catalog' order by sort_order,label")).rows
    return rows.map((row: any) => ({ id: row.id, value: row.value, label: row.label, metadata: parseMetadata(row.metadata), active: row.active, sortOrder: row.sort_order }))
  }

  async saveCatalog(option: ConfigOption, context: WineSpiritWriteContext): Promise<ConfigOption> {
    const existingRow = (await this.db.query<any>("select id,value,label,metadata,active,sort_order from configuration_options where id=$1 and group_key='wine_spirit_catalog'", [option.id])).rows[0]
    const before = existingRow ? { id: existingRow.id, value: existingRow.value, label: existingRow.label, metadata: parseMetadata(existingRow.metadata), active: existingRow.active, sortOrder: existingRow.sort_order } : null
    const metadata = option.metadata as Record<string, unknown> | undefined
    const sellingPrice = metadata?.sellingPrice
    const eligiblePrice = metadata?.eligiblePrice
    const ruleKey = String(metadata?.incentiveRuleKey || '').trim()
    if (!option.label.trim()) throw new Error('Bottle / item display name is required.')
    if (sellingPrice != null && (!Number.isFinite(Number(sellingPrice)) || Number(sellingPrice) < 0)) throw new Error('Selling price must be a valid non-negative amount.')
    if (eligiblePrice != null && (!Number.isFinite(Number(eligiblePrice)) || Number(eligiblePrice) < 0)) throw new Error('Eligible price must be a valid non-negative amount.')
    if (ruleKey) {
      const rule = (await this.db.query<any>('select id from incentive_rules where outlet_scope_id=$1 and rule_key=$2 and active=true', [context.outletScopeId, ruleKey])).rows[0]
      if (!rule) throw new Error('Select an existing approved Wine/Spirits incentive rule association.')
    }
    const value = before?.value || option.value || `WINE_${randomUUID().replaceAll('-', '').toUpperCase()}`
    const result = (await this.db.query<any>("insert into configuration_options(id,group_key,value,label,metadata,active,sort_order) values($1,'wine_spirit_catalog',$2,$3,$4,$5,$6) on conflict(id) do update set label=excluded.label,metadata=excluded.metadata,active=excluded.active,updated_at=now() returning id,value,label,metadata,active,sort_order", [option.id || randomUUID(), value, option.label.trim(), JSON.stringify(metadata || {}), option.active, before?.sortOrder ?? option.sortOrder ?? 100])).rows[0]
    const saved: ConfigOption = { id: result.id, value: result.value, label: result.label, metadata: parseMetadata(result.metadata), active: result.active, sortOrder: result.sort_order }
    await this.db.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'wine_spirit_catalog', saved.id, before ? 'configuration_updated' : 'configuration_created', before ? JSON.stringify(before) : null, JSON.stringify({ ...saved, outletScopeId: context.outletScopeId }), `${context.actor.displayName} [${context.actor.userId}]`])
    return saved
  }

  private select() { return `select w.id,w.outlet_scope_id,w.service_date::text,w.check_invoice_number,w.item_name,w.room_number,w.table_number,w.waiter_id,w.gross_unit_price::text,w.gross_total::text,w.financial_rate_version_id,fr.version financial_rate_version,w.service_charge_rate::text,w.gst_rate::text,w.incentive_eligible_net_unit_price::text,w.incentive_eligible_net_total::text,w.incentive_rule_id,w.incentive_rule_version,w.incentive_tier_minimum::text,w.incentive_tier_maximum::text,w.incentive_reward_mode,w.incentive_reward_value::text,w.incentive_per_bottle::text,w.quantity,w.total_beverage_incentive::text,w.status,w.notes,w.archived_at::text,w.archived_by_name,w.created_by_name,w.updated_by_name,w.created_at::text,w.updated_at::text,coalesce((select al.after_data->'waiter'->>'name' from audit_logs al where al.entity_type='wine_spirit_sale' and al.entity_id=w.id and al.after_data->'waiter'->>'name' is not null order by al.created_at asc limit 1),s.full_name) waiter_name,coalesce((select al.after_data->'waiter'->>'number' from audit_logs al where al.entity_type='wine_spirit_sale' and al.entity_id=w.id and al.after_data->'waiter'->>'number' is not null order by al.created_at asc limit 1),s.staff_number) waiter_number,s.position_key waiter_position,s.employment_status_key waiter_status from wine_spirit_sales w join staff s on s.id=w.waiter_id join financial_rate_versions fr on fr.id=w.financial_rate_version_id` }

  private map(row: any): WineSpiritSale {
    return {
      id: row.id, outletScopeId: row.outlet_scope_id, serviceDate: row.service_date,
      checkInvoiceNumber: row.check_invoice_number, itemName: row.item_name, roomNumber: row.room_number,
      tableNumber: row.table_number, waiterId: row.waiter_id,
      waiter: { name: row.waiter_name, number: row.waiter_number, position: row.waiter_position, employmentStatus: row.waiter_status },
      grossUnitPrice: row.gross_unit_price, grossTotal: row.gross_total,
      netUnitPrice: row.incentive_eligible_net_unit_price, netTotal: row.incentive_eligible_net_total,
      serviceChargeRate: row.service_charge_rate, gstRate: row.gst_rate,
      financialRateVersion: Number(row.financial_rate_version_id ? row.financial_rate_version || 0 : 0),
      appliedTier: tierLabel(row.incentive_tier_minimum, row.incentive_tier_maximum, row.incentive_reward_mode, row.incentive_reward_value),
      tierMinimum: row.incentive_tier_minimum, tierMaximum: row.incentive_tier_maximum,
      incentivePerBottle: row.incentive_per_bottle, totalIncentive: row.total_beverage_incentive,
      incentiveRuleVersion: Number(row.incentive_rule_version), quantity: Number(row.quantity), status: row.status,
      notes: row.notes || '', archived: Boolean(row.archived_at), archivedAt: row.archived_at,
      archivedBy: row.archived_by_name, createdAt: row.created_at, updatedAt: row.updated_at,
      createdBy: row.created_by_name, updatedBy: row.updated_by_name,
    }
  }

  async list(input: { start: string; end: string; outletScopeId: string }): Promise<WineSpiritSale[]> {
    if (!validDate(input.start) || !validDate(input.end) || input.start > input.end) throw new Error('Select a valid Wine/Spirits date range.')
    const result = await this.db.query<any>(`${this.select()} where w.outlet_scope_id=$1 and w.service_date between $2 and $3 order by w.service_date desc,w.created_at desc`, [input.outletScopeId, input.start, input.end])
    return result.rows.map(row => this.map(row))
  }

  async find(id: string, outletScopeId: string): Promise<WineSpiritSale | null> {
    const result = await this.db.query<any>(`${this.select()} where w.id=$1 and w.outlet_scope_id=$2`, [id, outletScopeId])
    return result.rows[0] ? this.map(result.rows[0]) : null
  }

  private async ruleAndRate(serviceDate: string, outletScopeId: string) {
    const rate = (await this.db.query<any>(`select id,version,service_charge_rate::text,gst_rate::text from financial_rate_versions where outlet_scope_id=$1 and active=true and effective_from<=$2 and (effective_to is null or effective_to>=$2) order by effective_from desc,version desc limit 1`, [outletScopeId, serviceDate])).rows[0]
    if (!rate) throw new Error(`No Andalucía financial rate resolves for ${serviceDate}.`)
    const ruleRow = (await this.db.query<any>(`select id,rule_key,source_key,rule_family,version,effective_from::text,effective_to::text,rate_percent::text,active from incentive_rules where outlet_scope_id=$1 and source_key='wine_spirits' and rule_family='wine_spirits_tier' and active=true and effective_from<=$2 and (effective_to is null or effective_to>=$2) order by effective_from desc,version desc limit 1`, [outletScopeId, serviceDate])).rows[0]
    if (!ruleRow) throw new Error(`No approved Wine/Spirits incentive rule resolves for ${serviceDate}.`)
    const tiers = (await this.db.query<any>('select id,minimum_amount::text,maximum_amount::text,reward_mode,reward_value::text from incentive_rule_tiers where rule_id=$1 order by sort_order', [ruleRow.id])).rows
    const rule: IncentiveRule = { id: ruleRow.id, ruleKey: ruleRow.rule_key, sourceKey: ruleRow.source_key, ruleFamily: ruleRow.rule_family, version: Number(ruleRow.version), effectiveFrom: ruleRow.effective_from, effectiveTo: ruleRow.effective_to, ratePercent: ruleRow.rate_percent, active: ruleRow.active, tiers: tiers.map((tier: any) => ({ id: tier.id, minimumAmount: tier.minimum_amount, maximumAmount: tier.maximum_amount, rewardMode: tier.reward_mode, rewardValue: tier.reward_value })) }
    return { rate, rule }
  }

  async calculate(input: Pick<WineSpiritSaleInput, 'serviceDate' | 'grossUnitPrice' | 'quantity'>, outletScopeId: string): Promise<WineSpiritCalculation> {
    if (!validDate(input.serviceDate)) throw new Error('Select a valid Service Date.')
    if (!Number.isInteger(Number(input.quantity)) || Number(input.quantity) < 1) throw new Error('Quantity must be a whole number of at least 1.')
    const { rate, rule } = await this.ruleAndRate(input.serviceDate, outletScopeId)
    const calculation = this.calculator.calculateIncentive(rule, input.grossUnitPrice, Number(input.quantity), rate.service_charge_rate, rate.gst_rate)
    const netUnit = this.calculator.calculateIncentive(rule, input.grossUnitPrice, 1, rate.service_charge_rate, rate.gst_rate)
    const tier = rule.tiers.find(item => item.minimumAmount === calculation.appliedTierMinimum && item.maximumAmount === calculation.appliedTierMaximum)
    if (!tier) throw new Error('The approved Wine/Spirits tier could not be resolved.')
    const incentivePerBottle = this.calculator.calculateIncentive(rule, input.grossUnitPrice, 1, rate.service_charge_rate, rate.gst_rate).finalAmount
    return { grossUnitPrice: Number(input.grossUnitPrice).toFixed(2), grossTotal: calculation.grossTotal, netUnitPrice: netUnit.eligibleNetTotal, netTotal: calculation.eligibleNetTotal, serviceChargeRate: rate.service_charge_rate, gstRate: rate.gst_rate, financialRateVersion: Number(rate.version), appliedTier: tierLabel(tier.minimumAmount, tier.maximumAmount, tier.rewardMode, tier.rewardValue), tierMinimum: tier.minimumAmount, tierMaximum: tier.maximumAmount, incentivePerBottle, totalIncentive: calculation.finalAmount, incentiveRuleVersion: rule.version }
  }

  private async validateWaiter(waiterId: string, previousWaiterId?: string) {
    const waiter = (await this.db.query<any>(`select s.id,s.employment_status_key,
      coalesce((select (c.metadata->>'eligibleForAssignments')::boolean from configuration_options c where c.group_key='employment_statuses' and c.value=s.employment_status_key),s.employment_status_key='active') assignment_eligible,
      coalesce((select (p.metadata->>'serviceAssignmentEligible')::boolean from configuration_options p where p.group_key='staff_positions' and p.value=s.position_key),lower(s.position_key) in ('venue manager','assistant restaurant manager','restaurant supervisor','f&b attendant','waiter')) service_eligible
      from staff s where s.id=$1`, [waiterId])).rows[0]
    if (!waiter) throw new Error('The selected waiter no longer exists.')
    if (waiterId !== previousWaiterId && (!waiter.assignment_eligible || !waiter.service_eligible)) throw new Error('This staff member is not eligible for new Wine/Spirits assignments.')
  }

  async duplicateWarnings(input: WineSpiritSaleInput, outletScopeId: string) {
    const result = await this.db.query<any>(`select id,check_invoice_number,item_name from wine_spirit_sales where outlet_scope_id=$1 and service_date=$2 and check_invoice_number=$3 and room_number=$4 and item_name=$5 and waiter_id=$6 and gross_unit_price=$7 and quantity=$8 and table_number=$9 and archived_at is null and status<>'void' and id<>$10 order by created_at`, [outletScopeId, input.serviceDate, input.checkInvoiceNumber, input.roomNumber, input.itemName, input.waiterId, input.grossUnitPrice, input.quantity, input.tableNumber, input.id])
    return result.rows.map((row: any) => ({ id: row.id, checkInvoiceNumber: row.check_invoice_number, itemName: row.item_name }))
  }

  private sameBusinessValues(input: WineSpiritSaleWriteRequest, previous: WineSpiritSale, status = input.status) {
    return input.serviceDate === previous.serviceDate && input.checkInvoiceNumber.trim() === previous.checkInvoiceNumber
      && input.itemName.trim() === previous.itemName && input.roomNumber.trim() === previous.roomNumber
      && input.tableNumber.trim() === previous.tableNumber && input.waiterId === previous.waiterId
      && Number(input.grossUnitPrice) === Number(previous.grossUnitPrice) && Number(input.quantity) === previous.quantity
      && status === previous.status && (input.notes || '').trim() === previous.notes
  }

  async save(input: WineSpiritSaleWriteRequest, context: WineSpiritWriteContext): Promise<WineSpiritSale> {
    const previous = await this.find(input.id, context.outletScopeId)
    if (previous?.archived) throw new Error('Archived Wine/Spirits records cannot be edited.')
    if (previous && ['charged', 'cancelled', 'void'].includes(previous.status)) {
      if (this.sameBusinessValues(input, previous)) return previous
      const correctionOnly = this.sameBusinessValues(input, previous, previous.status)
      const correctionReason = input.correctionReason?.trim() || ''
      if (previous.status === 'charged' && ['cancelled', 'void'].includes(input.status) && correctionOnly) {
        if (correctionReason.length < 8) throw new Error('A clear correction reason is required to cancel a realized Wine/Spirits transaction.')
        await this.db.query('update wine_spirit_sales set status=$3,updated_by_user_id=$4,updated_by_name=$5,updated_at=now() where id=$1 and outlet_scope_id=$2', [input.id, context.outletScopeId, input.status, context.actor.userId, context.actor.displayName])
        const corrected = await this.find(input.id, context.outletScopeId)
        if (!corrected) throw new Error('The Wine/Spirits correction could not be saved.')
        await this.audit(input.id, 'corrected', previous, { ...corrected, correctionReason }, context)
        return corrected
      }
      throw new Error('Realized and cancelled Wine/Spirits transactions are immutable. Use the audited correction workflow.')
    }
    if (!validDate(input.serviceDate) || !input.checkInvoiceNumber.trim() || !input.roomNumber.trim() || !input.tableNumber.trim() || !input.itemName.trim() || !input.waiterId) throw new Error('Service Date, Check / Invoice Number, Room, Table, exact Bottle / Item and Waiter are required.')
    if (!['pending', 'charged', 'cancelled', 'void'].includes(input.status)) throw new Error('Select a valid Wine/Spirits status.')
    await this.validateWaiter(input.waiterId, previous?.waiterId)
    const calculation = await this.calculate(input, context.outletScopeId)
    const { rate, rule } = await this.ruleAndRate(input.serviceDate, context.outletScopeId)
    const tier = rule.tiers.find(item => item.minimumAmount === calculation.tierMinimum && item.maximumAmount === calculation.tierMaximum)!
    const actorName = context.actor.displayName
    if (previous) {
      await this.db.query(`update wine_spirit_sales set service_date=$3,check_invoice_number=$4,item_name=$5,room_number=$6,table_number=$7,waiter_id=$8,gross_unit_price=$9,financial_rate_version_id=$10,service_charge_rate=$11,gst_rate=$12,incentive_eligible_net_unit_price=$13,incentive_rule_id=$14,incentive_rule_version=$15,incentive_tier_minimum=$16,incentive_tier_maximum=$17,incentive_reward_mode=$18,incentive_reward_value=$19,incentive_per_bottle=$20,quantity=$21,status=$22,notes=$23,updated_by_user_id=$24,updated_by_name=$25,updated_at=now() where id=$1 and outlet_scope_id=$2`, [input.id, context.outletScopeId, input.serviceDate, input.checkInvoiceNumber, input.itemName, input.roomNumber, input.tableNumber, input.waiterId, calculation.grossUnitPrice, rate.id, calculation.serviceChargeRate, calculation.gstRate, calculation.netUnitPrice, rule.id, rule.version, tier.minimumAmount, tier.maximumAmount, tier.rewardMode, tier.rewardValue, calculation.incentivePerBottle, input.quantity, input.status, input.notes || '', context.actor.userId, actorName])
    } else {
      await this.db.query(`insert into wine_spirit_sales(id,outlet_scope_id,service_date,check_invoice_number,item_name,room_number,table_number,waiter_id,gross_unit_price,financial_rate_version_id,service_charge_rate,gst_rate,incentive_eligible_net_unit_price,incentive_rule_id,incentive_rule_version,incentive_tier_minimum,incentive_tier_maximum,incentive_reward_mode,incentive_reward_value,incentive_per_bottle,quantity,status,notes,created_by_user_id,created_by_name,updated_by_user_id,updated_by_name) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$24,$25)`, [input.id, context.outletScopeId, input.serviceDate, input.checkInvoiceNumber, input.itemName, input.roomNumber, input.tableNumber, input.waiterId, calculation.grossUnitPrice, rate.id, calculation.serviceChargeRate, calculation.gstRate, calculation.netUnitPrice, rule.id, rule.version, tier.minimumAmount, tier.maximumAmount, tier.rewardMode, tier.rewardValue, calculation.incentivePerBottle, input.quantity, input.status, input.notes || '', context.actor.userId, actorName])
    }
    const saved = await this.find(input.id, context.outletScopeId)
    if (!saved) throw new Error('The Wine/Spirits sale could not be saved.')
    const warnings = await this.duplicateWarnings(input, context.outletScopeId)
    const after = { ...saved, duplicateWarnings: warnings, outletScopeId: context.outletScopeId }
    await this.audit(input.id, previous ? 'updated' : 'created', previous, after, context)
    if (previous && previous.status !== saved.status) await this.audit(input.id, 'status_changed', { status: previous.status }, { status: saved.status }, context)
    return after
  }

  async archive(id: string, context: WineSpiritWriteContext, correctionReason = ''): Promise<WineSpiritSale> {
    const previous = await this.find(id, context.outletScopeId)
    if (!previous) throw new Error('Wine/Spirits sale not found.')
    if (previous.archived) return previous
    if (previous.status === 'charged' && correctionReason.trim().length < 8) throw new Error('A clear correction reason is required to void a realized Wine/Spirits transaction.')
    await this.db.query(`update wine_spirit_sales set status='void',archived_at=now(),archived_by_user_id=$3,archived_by_name=$4,updated_by_user_id=$3,updated_by_name=$4,updated_at=now() where id=$1 and outlet_scope_id=$2`, [id, context.outletScopeId, context.actor.userId, context.actor.displayName])
    const saved = await this.find(id, context.outletScopeId)
    if (!saved) throw new Error('The Wine/Spirits sale could not be archived.')
    await this.audit(id, previous.status === 'charged' ? 'corrected' : 'archived', previous, { ...saved, correctionReason: correctionReason.trim() || undefined }, context)
    return saved
  }

  async auditHistory(id: string, outletScopeId: string) {
    const exists = await this.find(id, outletScopeId)
    if (!exists) throw new Error('Wine/Spirits sale not found.')
    return (await this.db.query<any>(`select id,action,before_data,after_data,actor,created_at::text from audit_logs where entity_type='wine_spirit_sale' and entity_id=$1 order by created_at desc`, [id])).rows.map((row: any) => ({ id: row.id, action: row.action, before: parseMetadata(row.before_data), after: parseMetadata(row.after_data), actor: row.actor, createdAt: row.created_at }))
  }

  private async audit(id: string, action: string, before: unknown, after: unknown, context: WineSpiritWriteContext) {
    await this.db.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'wine_spirit_sale', id, action, before ? JSON.stringify(before) : null, JSON.stringify({ ...(after as object), outletScopeId: context.outletScopeId }), `${context.actor.displayName} [${context.actor.userId}]`])
  }
}
