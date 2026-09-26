export interface BookingAllergyEvidence {
  label: string
  detectedPhrase: string
}

const firstMatch = (text: string, expression: RegExp) => text.match(expression)?.[0] || ''

export function detectBookingAllergyEvidence(note: string): BookingAllergyEvidence[] {
  const normalized = note.toLowerCase()
  if (!normalized.trim()) return []
  const alerts: BookingAllergyEvidence[] = []
  const add = (label: string, expression: RegExp) => {
    const detectedPhrase = firstMatch(note, expression)
    if (detectedPhrase && !alerts.some(alert => alert.label === label)) alerts.push({ label, detectedPhrase })
  }
  const riskContext = /\b(allerg(?:y|ic|ies)|intoleran(?:ce|t)|no|avoid|restriction|cannot|only)\b/i.test(note)
  if (riskContext) {
    add('Nuts', /\b(?:peanut|tree nut|nuts?)\b/i)
    add('Shellfish', /\b(?:shellfish|shrimp|prawn|crab|lobster)\b/i)
    add('Dairy', /\b(?:dairy|milk allergy|lactose)\b/i)
    add('Gluten', /\b(?:gluten|coeliac|celiac)\b/i)
    add('Seafood', /\bseafood\b/i)
  }
  if (/(allerg|reaction|intoleran).*(\bmg\b|medication|medicine|drug|antibiotic|sefaleksin|cefalexin)/i.test(note)) {
    const phrase = firstMatch(note, /\b(?:medication|medicine|drug|antibiotic|sefaleksin|cefalexin|\d+\s*mg)\b/i)
    alerts.push({ label: 'Medication Allergy', detectedPhrase: phrase || 'medication allergy' })
  }
  add('Dietary Restriction', /\b(?:halal|no pork|no alcohol|vegetarian|vegan|kosher|dietary restriction)\b/i)
  if (!alerts.length && /\b(allerg(?:y|ic|ies)|intoleran(?:ce|t)|dietary|must avoid)\b/i.test(note)) {
    alerts.push({ label: 'ALLERGY / DIETARY ALERT', detectedPhrase: firstMatch(note, /\b(?:allerg(?:y|ic|ies)|intoleran(?:ce|t)|dietary|must avoid)\b/i) })
  }
  return alerts
}
