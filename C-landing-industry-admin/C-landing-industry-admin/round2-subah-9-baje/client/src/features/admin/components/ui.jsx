import { cn } from '../../../lib/cn'
import { ORDER_STATUS } from '../../buyer/buyerApi'

const TONE = {
  straw: 'bg-straw text-forest-deep',
  forest: 'bg-forest text-paper',
  outline: 'border border-forest text-forest',
  danger: 'border border-danger text-danger',
  muted: 'border border-soil/25 text-stone',
}

export function Chip({ tone = 'outline', className, children }) {
  return <span className={cn('label inline-block px-2 py-1 text-xs whitespace-nowrap', TONE[tone], className)}>{children}</span>
}

export function OrderStatusChip({ status, className }) {
  const s = ORDER_STATUS[status] ?? { label: status, tone: 'outline' }
  return (
    <Chip tone={s.tone} className={className}>
      {s.label}
    </Chip>
  )
}

/** Page wrapper with the console's numbered-section header. */
export function AdminPage({ title, accent, aside, children }) {
  return (
    <div className="mx-auto max-w-[1520px] px-[clamp(16px,3vw,40px)] pt-6 pb-14 lg:pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-soil/15 pb-5">
        <div>
          <h1 className="display text-[clamp(40px,6vw,64px)]">
            {title} {accent && <span className="accent text-[0.6em] text-forest normal-case">{accent}</span>}
          </h1>
        </div>
        {aside}
      </div>
      {children}
    </div>
  )
}

/** Short-lived status line after an action (polite live region). */
export function Notice({ notice, onClose }) {
  if (!notice) return null
  return (
    <div role="status" className={cn('mt-4 flex items-start justify-between gap-3 border-l-[3px] px-4 py-3 text-sm', notice.error ? 'border-danger bg-[#f4dfd6] text-[#6e1f12]' : 'border-forest bg-sage-light text-forest-deep')}>
      <span>{notice.text}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="label -my-1 min-h-8 px-1 text-[12.5px]">
        ✕
      </button>
    </div>
  )
}
