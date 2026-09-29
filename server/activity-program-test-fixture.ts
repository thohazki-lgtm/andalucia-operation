// Deterministic, fictional Activity Program PDFs for parser/import regression tests.
// No production or guest data is represented here.
type Row = { room?: string; name: string; birth?: string; notes?: string; booking?: string; status?: string; bookedBy?: string }

const escapePdf = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')

function pdf(lines: Array<Array<[number, string]>>) {
  const stream = lines.map((line, index) => line.map(([x, value]) => `BT /F1 9 Tf 1 0 0 1 ${x} ${1100 - index * 16} Tm (${escapePdf(value)}) Tj ET`).join('\n')).join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 1200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ]
  let output = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(output)
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(output, 'latin1'))
}

const bookingLine = (row: Row): Array<[number, string]> => [
  ...(row.room ? [[40, row.room] as [number, string]] : []), [120, row.name],
  ...(row.birth ? [[235, row.birth] as [number, string]] : []),
  ...(row.notes ? [[460, row.notes] as [number, string]] : []),
  ...(row.booking ? [[605, row.booking] as [number, string]] : []),
  ...(row.status ? [[660, row.status] as [number, string]] : []),
  ...(row.bookedBy ? [[780, row.bookedBy] as [number, string]] : [])
]

export function syntheticActivityProgramPdf(kind: 'import' | 'intelligence' = 'import') {
  const date = kind === 'import' ? '31.08.2026' : '20.09.2026'
  const rows: Row[] = kind === 'import' ? [
    { room: '211', name: 'Fictional Guest Alpha', notes: '2 adults + 1 child', booking: '9000001', status: 'Confirmed (2 pax)', bookedBy: 'Test Agent' },
    { room: '212', name: 'Fictional Guest Beta' },
    { room: '320', name: 'Fictional Guest Gamma', booking: '9000002', status: 'Confirmed (2 pax)', bookedBy: 'Test Agent' },
    { room: '321', name: 'Fictional Guest Delta', booking: '9000003', status: 'Pending (1 pax)', bookedBy: 'Test Agent' },
    { name: 'Fictional Review Guest', booking: '9000004', status: 'Confirmed (1 pax)', bookedBy: 'Test Agent' }
  ] : [
    { room: '501', name: 'Fictional Group Guest', notes: 'Joining with 6 pax', booking: '9100001', status: 'Confirmed (2 pax)', bookedBy: 'Test Agent' },
    { room: '502', name: 'Fictional Birthday Guest', notes: 'Birthday celebration', booking: '9100002', status: 'Confirmed (2 pax)', bookedBy: 'Test Agent' },
    { room: '503', name: 'Fictional Return Guest', notes: 'SYS table requested', booking: '9100003', status: 'Confirmed (2 pax)', bookedBy: 'Test Agent' },
    { room: '504', name: 'Fictional Attention Guest', notes: 'TLC - peanut allergy', booking: '9100004', status: 'Confirmed (2 pax)', bookedBy: 'Test Agent' },
    { name: 'Blocked Blocked', notes: 'Blocked capacity', booking: '9100005', status: 'Confirmed (2 pax)', bookedBy: 'Test Agent' },
    { room: '505', name: 'Fictional Single Guest', booking: '9100006', status: 'Confirmed (1 pax)', bookedBy: 'Test Agent' }
  ]
  const declared = kind === 'import' ? { bookings: 4, covers: 7 } : { bookings: 6, covers: 11 }
  return pdf([
    [[35, `Activity Program - ${date}`]],
    [[35, `18:30 Dinner / Andalucia ${declared.bookings} Bookings ${declared.covers} Guests`]],
    ...rows.map(bookingLine)
  ])
}
