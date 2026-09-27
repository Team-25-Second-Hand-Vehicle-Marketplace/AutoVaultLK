import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Heart } from 'lucide-react'
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
      className={saved ? 'nx-heart is-saved' : 'nx-heart'}
      aria-pressed={saved}
      aria-label={saved ? 'Remove from saved' : 'Save this listing'}
      disabled={pending}
      onClick={() => void handleClick()}
    >
      <Heart size={18} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />
    </button>
  )
}
