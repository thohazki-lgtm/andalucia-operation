import { useRef, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

export type ActionIconName =
  | 'add'
  | 'archive'
  | 'alert-circle'
  | 'ban'
  | 'calendar'
  | 'check'
  | 'check-circle'
  | 'confirm'
  | 'clock'
  | 'copy'
  | 'chevron-left'
  | 'chevron-right'
  | 'close'
  | 'download'
  | 'edit'
  | 'filter'
  | 'grip'
  | 'list'
  | 'more'
  | 'print'
  | 'refresh'
  | 'restore'
  | 'save'
  | 'share'
  | 'trash'
  | 'upload'
  | 'user'

const paths: Record<ActionIconName, ReactNode> = {
  add: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  archive: <><path d="M4 7h16"/><path d="M5 7l1 13h12l1-13"/><path d="M9 11h6"/><path d="M4 4h16v3H4z"/></>,
  'alert-circle': <><circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 17h.01"/></>,
  ban: <><circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  'check-circle': <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.7 2.7L16.5 9"/></>,
  confirm: <path d="m5 12 4 4L19 6"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
  'chevron-left': <path d="m15 18-6-6 6-6"/>,
  'chevron-right': <path d="m9 18 6-6-6-6"/>,
  close: <><path d="m6 6 12 12"/><path d="M18 6 6 18"/></>,
  download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></>,
  filter: <path d="M4 6h16l-6 7v5l-4 2v-7L4 6Z"/>,
  grip: <><circle cx="8" cy="7" r="1"/><circle cx="16" cy="7" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="17" r="1"/><circle cx="16" cy="17" r="1"/></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="5" cy="6" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="18" r="1"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  print: <><path d="M7 8V3h10v5"/><path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/></>,
  refresh: <><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 8a7 7 0 0 1 11.6-2L20 8"/><path d="M17.9 16a7 7 0 0 1-11.6 2L4 16"/></>,
  restore: <><path d="M4 7h16"/><path d="M5 7l1 13h12l1-13"/><path d="M12 16v-6"/><path d="m9 13 3-3 3 3"/><path d="M4 4h16v3H4z"/></>,
  save: <><path d="M5 3h12l2 2v16H5z"/><path d="M8 3v6h8V3"/><path d="M8 14h8v7H8z"/></>,
  share: <><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></>,
  trash: <><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 14h10l1-14"/><path d="M10 11v6M14 11v6"/></>,
  upload: <><path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></>
}

export function SvgIcon({ name, size = 20, className = '' }: { name: ActionIconName; size?: number; className?: string }) {
  return <svg className={`ao-icon ${className}`.trim()} aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary'
  icon?: ActionIconName
  iconPosition?: 'start' | 'end'
  compact?: boolean
}

export function ActionButton({ variant = 'secondary', icon, iconPosition = 'start', compact = false, className = '', type = 'button', children, ...props }: ActionButtonProps) {
  const iconNode = icon ? <SvgIcon name={icon}/> : null
  return <button type={type} className={`ao-action ao-action--${variant}${compact ? ' ao-action--compact' : ''} ${className}`.trim()} {...props}>
    {iconPosition === 'start' && iconNode}<span className="ao-action__label">{children}</span>{iconPosition === 'end' && iconNode}
  </button>
}

export interface IconActionProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string
  icon: ActionIconName
  tone?: 'neutral' | 'danger'
}

export function IconAction({ label, icon, tone = 'neutral', className = '', type = 'button', title, ...props }: IconActionProps) {
  return <button type={type} className={`ao-icon-action ao-icon-action--${tone} ${className}`.trim()} aria-label={label} title={title || label} {...props}><SvgIcon name={icon}/></button>
}

export interface StatusPillProps {
  children: ReactNode
  tone?: 'neutral' | 'navy' | 'gold' | 'lagoon' | 'danger' | 'success'
  className?: string
  style?: CSSProperties
}

export function StatusPill({ children, tone = 'neutral', className = '', style }: StatusPillProps) {
  return <span className={`ao-status-pill ao-status-pill--${tone} ${className}`.trim()} style={style}>{children}</span>
}

export interface StatusSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
}

export function StatusSelect({ label, className = '', children, ...props }: StatusSelectProps) {
  return <select className={`ao-status-select ${className}`.trim()} aria-label={label} {...props}>{children}</select>
}

export interface DateControlProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string
  type?: 'date' | 'month' | 'datetime-local'
}

/** Keeps the platform picker and keyboard behaviour while presenting one shared calendar icon. */
export function DateControl({ label, type = 'date', className = '', ...props }: DateControlProps) {
  return <span className={`ao-date-control ${className}`.trim()}>
    <input type={type} aria-label={label} {...props}/>
    <SvgIcon name="calendar" size={18} className="ao-date-control__icon"/>
  </span>
}

export interface OverflowMenuItem {
  label: string
  icon?: ActionIconName
  disabled?: boolean
  danger?: boolean
  onSelect: () => void
}

export function OverflowMenu({ label = 'More actions', items, className = '' }: { label?: string; items: OverflowMenuItem[]; className?: string }) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  return <details ref={detailsRef} className={`ao-overflow ${className}`.trim()}>
    <summary className="ao-icon-action" aria-label={label} title={label}><SvgIcon name="more"/></summary>
    <div className="ao-overflow__menu" role="menu">{items.map(item => <button key={item.label} type="button" role="menuitem" className={item.danger ? 'danger' : undefined} disabled={item.disabled} onClick={() => { item.onSelect(); if (detailsRef.current) detailsRef.current.open = false }}>{item.icon && <SvgIcon name={item.icon}/>}<span>{item.label}</span></button>)}</div>
  </details>
}
