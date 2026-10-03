import { useState } from 'react'
import { ImageIcon } from 'lucide-react'
import { IMAGE_SLOTS, type ImageSlotId } from '../../assets/image-slots'

interface Props {
  slot: ImageSlotId
  alt?: string
  className?: string
  /** Above-the-fold images load eagerly and skip the fade-in; the rest are lazy. */
  priority?: boolean
}

export function SlotImage({ slot, alt = '', className = '', priority = false }: Props) {
  const [missing, setMissing] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const meta = IMAGE_SLOTS[slot]

  if (missing) {
    // The labelled version is a design aid for development only; a live site
    // just shows a quiet branded block where a photo has not been added yet.
    if (!import.meta.env.DEV) {
      return <div className={`nx-slot-ph nx-slot-ph--quiet ${className}`} aria-hidden="true" />
    }
    return (
      <div
        className={`nx-slot-ph ${className}`}
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
      >
        <ImageIcon size={26} strokeWidth={1.4} />
        <span className="nx-slot-ph__id">
          {slot} · {meta.width}×{meta.height}
        </span>
        <span className="nx-slot-ph__brief">{meta.brief}</span>
      </div>
    )
  }

  return (
    <img
      src={`/images/${slot}.jpg`}
      alt={alt}
      className={`${className} ${priority || loaded ? 'is-loaded' : 'nx-img-fade'}`}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setMissing(true)}
    />
  )
}
