import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../../auth/useAuth'
import { useSavedVehicles } from '../../hooks/useSavedVehicles'

/**
 * Save/unsave a listing.
 *
 * Saved ids persist per-user in localStorage, NOT on the server: the
 * favourites module in marketplace-service is an empty directory of .gitkeep
 * files on this branch (the implementation lives on feat/MP-favourite,
 * unmerged), so there is no endpoint to call. useSavedVehicles is the single
 * place that changes when it lands.
 *
 * Requiring sign-in even for local saves is deliberate: it keeps the
 * behaviour identical before and after the server-backed version, so nobody
 * builds up a list as an anonymous visitor and then loses it.
 */
export function SaveButton({ vehicleId }: { vehicleId: string }) {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const { isSaved, toggle } = useSavedVehicles()

  const saved = isSaved(vehicleId)

  const handleClick = () => {
    if (!isAuthenticated) {
      toast.info('Sign in to save listings')
      navigate('/login')
      return
    }
    const nowSaved = toggle(vehicleId)
    toast.success(nowSaved ? 'Saved to your list' : 'Removed from your list')
  }

  return (
    <button
      type="button"
      className={saved ? 'vehicle-card__save vehicle-card__save--active' : 'vehicle-card__save'}
      aria-pressed={saved}
      aria-label={saved ? 'Remove from saved' : 'Save this listing'}
      onClick={handleClick}
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
