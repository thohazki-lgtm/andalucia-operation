import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { SvgIcon } from './action-system'
import './financial-date-control.css'

type FinancialDateControlProps = {
  className?: string
  disabled?: boolean
  label: string
  max?: string
  min?: string
  onChange: (value: string) => void
  title?: string
  type?: 'date' | 'month'
  value: string
}

const pad = (value: number) => String(value).padStart(2, '0')
const localToday = () => {
  const date = new Date()
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const monthValue = (year: number, monthIndex: number) => `${year}-${pad(monthIndex + 1)}`
const shiftMonth = (value: string, offset: number) => {
  const [year, month] = value.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1))
  return monthValue(shifted.getUTCFullYear(), shifted.getUTCMonth())
}
const monthHeading = (value: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`))
const dateHeading = (value: string) => new Intl.DateTimeFormat('en-US', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
const months = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, index, 1))))
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function FinancialDateControl({ className = '', disabled = false, label, max, min, onChange, title, type = 'date', value }: FinancialDateControlProps) {
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverId = useId()
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState((value || localToday()).slice(0, 7))
  const [viewYear, setViewYear] = useState(Number((value || localToday()).slice(0, 4)))

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  useEffect(() => {
    if (!open) return
    const source = value || localToday()
    setViewMonth(source.slice(0, 7))
    setViewYear(Number(source.slice(0, 4)))
    const frame = window.requestAnimationFrame(() => (wrapperRef.current?.querySelector<HTMLElement>('[aria-selected="true"]') || wrapperRef.current?.querySelector<HTMLElement>('[role="grid"] button:not(:disabled)'))?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open, value])

  const selectedLabel = value ? type === 'month' ? monthHeading(value) : dateHeading(value) : label
  const [calendarYear, calendarMonth] = viewMonth.split('-').map(Number)
  const dayCells = useMemo(() => {
    const firstWeekday = new Date(Date.UTC(calendarYear, calendarMonth - 1, 1)).getUTCDay()
    const totalDays = new Date(Date.UTC(calendarYear, calendarMonth, 0)).getUTCDate()
    const cellCount = Math.ceil((firstWeekday + totalDays) / 7) * 7
    return Array.from({ length: cellCount }, (_, index) => {
      const day = index - firstWeekday + 1
      return day > 0 && day <= totalDays ? day : null
    })
  }, [calendarMonth, calendarYear])

  const allowed = (candidate: string) => (!min || candidate >= min) && (!max || candidate <= max)
  const closeAndFocus = () => { setOpen(false); window.requestAnimationFrame(() => triggerRef.current?.focus()) }
  const select = (candidate: string) => { if (!allowed(candidate)) return; onChange(candidate); closeAndFocus() }
  const handlePopupKey = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); closeAndFocus() }
  }
  const moveGridFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, columns: number) => {
    const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : event.key === 'ArrowDown' ? columns : 0
    if (!offset) return
    const buttons = Array.from(event.currentTarget.closest('[role="grid"]')?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
    const currentIndex = buttons.indexOf(event.currentTarget)
    const target = buttons[Math.max(0, Math.min(buttons.length - 1, currentIndex + offset))]
    if (!target || target === event.currentTarget) return
    event.preventDefault()
    target.focus()
  }

  return <span ref={wrapperRef} className={`ao-date-control ao-financial-date-control ${open ? 'is-open' : ''} ${className}`.trim()}>
    <button ref={triggerRef} type="button" className="ao-financial-date-control__trigger" aria-label={label} aria-expanded={open} aria-controls={popoverId} aria-haspopup="dialog" disabled={disabled} title={title || selectedLabel} onClick={() => setOpen(current => !current)}>
      <span>{selectedLabel}</span><SvgIcon name="calendar" size={18} />
    </button>
    {open && <section id={popoverId} className={`ao-financial-picker ao-financial-picker--${type}`} role="dialog" aria-label={`${label} picker`} onKeyDown={handlePopupKey}>
      {type === 'date' ? <>
        <header className="ao-financial-picker__header">
          <button type="button" aria-label="Previous month" onClick={() => setViewMonth(current => shiftMonth(current, -1))}><SvgIcon name="chevron-left" /></button>
          <strong>{monthHeading(viewMonth)}</strong>
          <button type="button" aria-label="Next month" onClick={() => setViewMonth(current => shiftMonth(current, 1))}><SvgIcon name="chevron-right" /></button>
        </header>
        <div className="ao-financial-picker__weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
        <div className="ao-financial-picker__days" role="grid" aria-label={monthHeading(viewMonth)}>{dayCells.map((day, index) => {
          if (!day) return <span key={`blank-${index}`} aria-hidden="true" />
          const candidate = `${viewMonth}-${pad(day)}`
          const isSelected = candidate === value
          const isToday = candidate === localToday()
          return <button key={candidate} type="button" role="gridcell" aria-label={dateHeading(candidate)} aria-selected={isSelected} aria-current={isToday ? 'date' : undefined} disabled={!allowed(candidate)} className={`${isSelected ? 'is-selected' : ''}${isToday ? ' is-today' : ''}`} onKeyDown={event => moveGridFocus(event, 7)} onClick={() => select(candidate)}>{day}</button>
        })}</div>
        <footer><button type="button" onClick={() => select(localToday())}>Today</button></footer>
      </> : <>
        <header className="ao-financial-picker__header">
          <button type="button" aria-label="Previous year" onClick={() => setViewYear(year => year - 1)}><SvgIcon name="chevron-left" /></button>
          <strong>{viewYear}</strong>
          <button type="button" aria-label="Next year" onClick={() => setViewYear(year => year + 1)}><SvgIcon name="chevron-right" /></button>
        </header>
        <div className="ao-financial-picker__months" role="grid" aria-label={`Months in ${viewYear}`}>{months.map((month, index) => {
          const candidate = monthValue(viewYear, index)
          const isSelected = candidate === value
          const isCurrent = candidate === localToday().slice(0, 7)
          return <button key={candidate} type="button" role="gridcell" aria-label={`${month} ${viewYear}`} aria-selected={isSelected} aria-current={isCurrent ? 'date' : undefined} disabled={!allowed(candidate)} className={`${isSelected ? 'is-selected' : ''}${isCurrent ? ' is-today' : ''}`} onKeyDown={event => moveGridFocus(event, 3)} onClick={() => select(candidate)}>{month}</button>
        })}</div>
        <footer><button type="button" onClick={() => select(localToday().slice(0, 7))}>This month</button></footer>
      </>}
    </section>}
  </span>
}
