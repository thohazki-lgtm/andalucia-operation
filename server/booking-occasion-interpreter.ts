export type BookingOccasionEvidence = { location: string; text: string; memberIdentity?: string }
export type BookingOccasionInterpretation = BookingOccasionEvidence & { value: string; normalizedKey: string; label: string; ruleKey: string; detectedPhrase: string }

const occasionRules: Array<{ value: string; normalizedKey: string; label: string; ruleKey: string; expression: RegExp }> = [
  { value: 'honeymoon', normalizedKey: 'HONEYMOON', label: 'HONEYMOON', ruleKey: 'occasion.honeymoon', expression: /\b(?:honeymoon(?:\s+couple)?|hm(?:\s+(?:table|deco(?:ration)?|celebration))?)\b/i },
  { value: 'birthday', normalizedKey: 'BIRTHDAY', label: 'BIRTHDAY', ruleKey: 'occasion.birthday', expression: /\bbirthday(?:\s+(?:celebration|package))?\b/i },
  { value: 'anniversary', normalizedKey: 'ANNIVERSARY', label: 'ANNIVERSARY', ruleKey: 'occasion.anniversary', expression: /\b(?:wedding\s+)?anniversary\b/i },
  { value: 'see_you_soon', normalizedKey: 'SEE_YOU_SOON', label: 'SEE YOU SOON', ruleKey: 'occasion.see-you-soon', expression: /\b(?:see\s+you\s+soon(?:\s+tables?)?|sys(?:\s+(?:tables?|deco(?:ration)?s?))?|tables?\s+see\s+you\s+soon)\b/i },
  { value: 'famtrip', normalizedKey: 'FAMTRIP', label: 'FAM TRIP', ruleKey: 'occasion.famtrip', expression: /\bfam\s*trip\b/i },
  { value: 'presstrip', normalizedKey: 'PRESSTRIP', label: 'PRESS TRIP', ruleKey: 'occasion.presstrip', expression: /\bpress\s*trip\b/i },
  { value: 'siyam_family', normalizedKey: 'SIYAM_FAMILY', label: 'SIYAM FAMILY', ruleKey: 'occasion.siyam-family', expression: /\b(?:siyam\s+world\s+family(?:\s+members?)?|siyam\s+family|repeat(?:er|\s+guest)?)\b/i }
]

export function interpretBookingOccasions(evidence: BookingOccasionEvidence[]): BookingOccasionInterpretation[] {
  const matches: BookingOccasionInterpretation[] = []
  for (const rule of occasionRules) {
    for (const item of evidence) {
      const match = item.text.match(rule.expression)
      if (!match) continue
      matches.push({ ...item, value: rule.value, normalizedKey: rule.normalizedKey, label: rule.label, ruleKey: rule.ruleKey, detectedPhrase: match[0] })
      break
    }
  }
  return matches
}
