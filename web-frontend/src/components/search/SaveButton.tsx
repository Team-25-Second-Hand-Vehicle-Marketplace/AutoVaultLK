import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../../auth/useAuth'
import { toErrorMessage } from '../../api/client'
import { useSavedVehicles } from '../../hooks/useSavedVehicles'

export function SaveButton({ vehicleId }: { vehicleId: string }) {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const { isSaved, toggle } = useSavedVehicles()
  const [pending, setPending] = useState(false)

  const saved = isSaved(vehicleId)

  const handleClick = async () => {
    if (!isAuthenticated) {
      toast.info('Sign in to save listings')
      navigate('/login')
      return
    }

    // Guards against a double-click firing two mutations for the same vehicle;
    // the second would race the first and could land out of order.
    if (pending) return
    setPending(true)

    try {
      const nowSaved = await toggle(vehicleId)
      toast.success(nowSaved ? 'Saved to your list' : 'Removed from your list')
    } catch (error) {
      // The hook has already rolled the heart back, so the message is all the
      // buyer needs — the button state already tells the truth.
      toast.error(toErrorMessage(error, 'Could not update your saved list.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      className={saved ? 'vehicle-card__save vehicle-card__save--active' : 'vehicle-card__save'}
      aria-pressed={saved}
      aria-label={saved ? 'Remove from saved' : 'Save this listing'}
      disabled={pending}
      onClick={() => void handleClick()}
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill={saved ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M12 21s-6.7-4.35-9.3-8.1C.8 10.1 1.4 6.6 4.3 5.1c2.2-1.1 4.6-.4 6 1.4l1.7 2.1 1.7-2.1c1.4-1.8 3.8-2.5 6-1.4 2.9 1.5 3.5 5 1.6 7.8C18.7 16.65 12 21 12 21z" />
      </svg>
    </button>
  )
}
