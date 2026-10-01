import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, FileSpreadsheet, PencilLine } from 'lucide-react'
import { Button } from '../ui/Button'

interface Props {
  /** Bulk upload is for business dealers only; an individual sees no choice to make. */
  canBulkUpload: boolean
}

/**
 * The "New listing" button. A business dealer gets a two-way choice (add one
 * vehicle by hand, or upload an inventory file); an individual dealer can only
 * add by hand, so the button goes straight to the form without a menu of one.
 */
export function NewListingMenu({ canBulkUpload }: Props) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!canBulkUpload) {
    return <Button onClick={() => navigate('/dealer/listings/new')}>New listing</Button>
  }

  const choose = (to: string) => {
    setOpen(false)
    navigate(to)
  }

  return (
    <div className="new-listing-menu" ref={rootRef}>
      <Button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        New listing
        <ChevronDown
          size={16}
          className={`new-listing-menu__chevron${open ? ' new-listing-menu__chevron--open' : ''}`}
        />
      </Button>

      {open && (
        <div className="new-listing-menu__panel" role="menu">
          <button
            type="button"
            role="menuitem"
            className="new-listing-menu__option"
            onClick={() => choose('/dealer/listings/new')}
          >
            <PencilLine size={20} />
            <span>
              <strong>Manual listing</strong>
              <small>Add one vehicle with its details and photos</small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="new-listing-menu__option"
            onClick={() => choose('/dealer/upload')}
          >
            <FileSpreadsheet size={20} />
            <span>
              <strong>Bulk upload</strong>
              <small>Import your whole inventory from a CSV file</small>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
