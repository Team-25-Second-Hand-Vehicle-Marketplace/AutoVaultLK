import type { Relaxation } from '../../api/search.types'

export function RelaxationNotice({ relaxation }: { relaxation: Relaxation }) {
  return (
    <div className="relaxation-notice" role="status">
      {relaxation.message}
    </div>
  )
}
