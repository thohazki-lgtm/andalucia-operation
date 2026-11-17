import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/import-preview.css', import.meta.url), 'utf8')
const confirmationCss = readFileSync(new URL('../src/import-confirm.css', import.meta.url), 'utf8')

assert.match(
  css,
  /\.activity-import-modal \.import-preview-card>header input\[type=checkbox\]\{[\s\S]*?flex:0 0 17px;width:17px;min-width:17px;height:17px;min-height:17px;[\s\S]*?accent-color:#7b3a25/,
  'responsive import cards must use the same compact checkbox treatment as the desktop table',
)
assert.match(
  css,
  /@media\(max-width:820px\)[\s\S]*?\.activity-import-modal \.import-preview-card>header label\{[\s\S]*?min-width:max-content;white-space:nowrap;overflow-wrap:normal/,
  'tablet import cards must keep the Include control on one line',
)
assert.match(
  css,
  /\.activity-import-modal \.import-preview-card>header\{[\s\S]*?background:linear-gradient\(90deg,#d9f1ff 0%,#eaf7ff 100%\)/,
  'responsive import cards must use the compact pale-blue header treatment',
)
assert.match(
  css,
  /\.activity-import-modal \.preview-source\{[\s\S]*?grid-template-columns:minmax\(102px,\.34fr\) minmax\(0,1fr\)/,
  'tablet source preview facts must remain in a compact label/value grid',
)
assert.match(
  css,
  /\.activity-import-modal \.preview-detail \.intelligence-evidence-list\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
  'tablet intelligence evidence must use a compact two-column layout',
)
assert.match(
  css,
  /@media\(max-width:520px\)[\s\S]*?\.activity-import-modal \.preview-source\{grid-template-columns:92px minmax\(0,1fr\)/,
  'mobile source preview facts must retain the compact paired layout',
)
assert.match(
  css,
  /@media\(max-width:520px\)[\s\S]*?\.activity-import-modal \.preview-detail \.intelligence-evidence-list\{grid-template-columns:1fr\}/,
  'mobile evidence must return to a readable single column',
)
assert.match(
  confirmationCss,
  /@media\(max-width:700px\)[\s\S]*?\.review-edit-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:5px 6px\}/,
  'mobile edit-before-import fields must use compact paired columns',
)
assert.match(
  confirmationCss,
  /\.review-edit-grid \.review-notes-field\{grid-column:1\/-1\}/,
  'mobile source notes must remain full width below the paired fields',
)
assert.match(
  confirmationCss,
  /@media\(max-width:700px\)[\s\S]*?\.review-cover-summary,\.review-item-facts\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:5px\}/,
  'mobile review cover and booking facts must use compact paired cards',
)
assert.match(
  confirmationCss,
  /\.review-cover-summary>span:last-child:nth-child\(odd\),\.review-item-facts>span:last-child:nth-child\(odd\)\{grid-column:1\/-1\}/,
  'the final odd review fact must span the mobile card width',
)
assert.match(
  confirmationCss,
  /\.import-selection\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:6px;padding:7px\}/,
  'mobile import selection controls must use a clean two-column grid',
)
assert.match(
  confirmationCss,
  /\.import-selection \.confirm-import\{grid-column:1\/-1;width:100%;min-height:42px;margin:0\}/,
  'the mobile review action must occupy its own full-width row',
)
assert.match(
  css,
  /\.activity-import-modal \.review-item \.decision-state\.import,\.activity-import-modal \.review-item \.decision-state\.edited,\.activity-import-modal \.review-item \.decision-state\.skip\{border-color:#76231f;background:#8f302b;color:#fff\}/,
  'all completed review decision pills must use the same dark-red treatment with white text in every view',
)

console.log('booking import responsive card layout tests passed')
