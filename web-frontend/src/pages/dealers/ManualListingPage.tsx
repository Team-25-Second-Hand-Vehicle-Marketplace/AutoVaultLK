import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { createListing, uploadListingImages } from '../../api/listings.api'
import type { CreateListingInput } from '../../api/listings.types'
import { isNoResponseError, toErrorMessage } from '../../api/client'
import { ListingForm } from '../../components/dealers/ListingForm'

/**
 * Adds a single vehicle by hand (FR-58). The listing is created for review and
 * only appears in search once the dealer approves it from My listings.
 */
export function ManualListingPage() {
  const navigate = useNavigate()
  const backToListings = () => navigate('/dealer/listings')

  const onCreate = async (input: CreateListingInput, images: File[]) => {
    try {
      const listing = await createListing(input)
      // A photo upload failing is a different, lesser problem than the listing
      // failing to create: the listing exists either way, so it gets its own
      // try/catch and message rather than aborting the flow or reporting the
      // wrong failure.
      if (images.length > 0) {
        try {
          await uploadListingImages(listing.id, images)
        } catch (error) {
          toast.error(
            toErrorMessage(error, 'Listing created, but the photos could not be uploaded.'),
          )
          backToListings()
          return
        }
      }
      toast.success('Listing created and sent for review')
      backToListings()
    } catch (error) {
      if (isNoResponseError(error)) {
        // No answer is not the same as "failed": the server may have created the
        // listing anyway. Leaving the form open invites a second submit and a
        // duplicate, so go back to the list and let the dealer check.
        toast.error(
          'The server took too long to respond. Your listing may still have been created. Check My listings before adding it again.',
        )
        backToListings()
        return
      }
      toast.error(toErrorMessage(error, 'Could not create the listing.'))
    }
  }

  return (
    <div className="dealer-page">
      <header className="dealer-page__header">
        <h1>Manual listing</h1>
        <p>Add one vehicle. It goes for review before appearing in search.</p>
      </header>

      <ListingForm onSubmit={onCreate} onCancel={backToListings} submitLabel="Create listing" />
    </div>
  )
}
