import { useEffect, useRef, useState } from 'react'
import { MoreVertical } from 'lucide-react'

export interface ActionMenuItem {
  label: string
  onClick: () => void
  disabled?: boolean
  /** Red text - for a destructive action like Delete. */
  danger?: boolean
}

/**
 * A "⋮" button that opens a small menu of actions. Used where a row (a
 * listing, say) has more actions than fit as inline buttons, and not every
 * action applies to every row - the caller decides which items to pass per
 * row, so an action that would just 409 never appears at all.
 *
 * The panel is `position: fixed`, positioned from the trigger's own
 * bounding rect rather than a plain `position: absolute` in normal flow -
 * this table's wrapper scrolls horizontally (`overflow-x: auto`), which
 * would otherwise clip the dropdown for any row near the bottom, since
 * setting overflow-x forces overflow-y to clip too (CSS spec: overflow on
 * one axis makes "visible" on the other behave as "auto").
 */
export function ActionMenu({ items, label = 'More actions' }: { items: ActionMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, right: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      setPosition({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
    }
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // The panel's position is computed once, on open - rather than track it
    // continuously, just close on scroll so it never renders somewhere stale.
    const onScroll = () => setOpen(false)

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  return (
    <div className="action-menu">
      <button
        ref={triggerRef}
        type="button"
        className="action-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <MoreVertical size={16} />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="action-menu__panel"
          role="menu"
          style={{ top: position.top, right: position.right }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={`action-menu__item${item.danger ? ' action-menu__item--danger' : ''}`}
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
