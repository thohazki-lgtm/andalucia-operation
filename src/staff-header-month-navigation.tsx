import { type ChangeEvent, useRef } from 'react'
import { IconAction } from './action-system'
import { FinancialDateControl } from './financial-date-control'

type StaffHeaderMonthNavigationProps = {
  ariaLabel: string
  className: string
  month: string
  monthLabel: string
  onChange: (month: string) => void
  onPrevious: () => void
  onNext: () => void
  previousDisabled?: boolean
  nextDisabled?: boolean
  pickerDisabled?: boolean
  min?: string
  max?: string
  customPicker?: boolean
}

export function StaffHeaderMonthNavigation({
  ariaLabel,
  className,
  month,
  monthLabel,
  onChange,
  onPrevious,
  onNext,
  previousDisabled = false,
  nextDisabled = false,
  pickerDisabled = false,
  min,
  max,
  customPicker = false
}: StaffHeaderMonthNavigationProps) {
  const picker = useRef<HTMLDetailsElement>(null)
  const selectMonth = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.value) return
    onChange(event.target.value)
    picker.current?.removeAttribute('open')
  }

  return <div className={`staff-header-month-navigation ${className}`} aria-label={ariaLabel}>
    <IconAction icon="chevron-left" label={`Previous ${ariaLabel.toLowerCase()}`} disabled={previousDisabled} onClick={onPrevious} />
    {customPicker ? <FinancialDateControl className="staff-header-month-picker staff-header-custom-month-picker" type="month" label={ariaLabel} min={min} max={max} value={month} displayValue={monthLabel} disabled={pickerDisabled} title={monthLabel} showFooter={false} onChange={onChange} /> : <details ref={picker} className="staff-header-month-picker">
      <summary className="staff-header-month-trigger" aria-label={`Choose ${ariaLabel.toLowerCase()}`}>{monthLabel}</summary>
      <div className="staff-header-month-popover">
        <label><span>Month and year</span><input type="month" aria-label={ariaLabel} min={min} max={max} value={month} disabled={pickerDisabled} onChange={selectMonth} /></label>
      </div>
    </details>}
    <IconAction icon="chevron-right" label={`Next ${ariaLabel.toLowerCase()}`} disabled={nextDisabled} onClick={onNext} />
  </div>
}
