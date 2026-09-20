import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import {
  createListing,
  deactivateListing,
  getMyListings,
  updateListing,
} from '../../api/listings.api'
import type {
  CreateListingInput,
  DealerListing,
  ListingStatus,
} from '../../api/listings.types'
import { toErrorMessage } from '../../api/client'
import { useAsyncData } from '../../hooks/useAsyncData'
import { ListingForm } from '../../components/dealers/ListingForm'
import { Button } from '../../components/ui/Button'
import { ErrorBanner } from '../../components/ui/ErrorBanner'
import { formatMileage, formatPrice } from '../../components/search/vehicle-format'

/**
 * Manual listing management (FR-58).
 *
 * The three routes behind this have existed and been guarded since the listings
 * module landed; until now nothing in the UI called them, so a dealer could
 * only add stock through bulk upload.
 */

const listingsError = (err: unknown) => toErrorMessage(err, 'Could not load your listings.')

/** Archiving cannot be undone from this page, so it asks first. */
function useConfirm() {
  return useCallback((message: string) => window.confirm(message), [])
}

function StatusBadge({ status }: { status: ListingStatus }) {
  return <span className={`listing-status listing-status--${status.toLowerCase()}`}>{status.replace(/_/g, ' ')}</span>
}

type Mode =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; listing: DealerListing }

export function DealerListingsPage() {
  const fetchListings = useCallback((signal: AbortSignal) => getMyListings(signal), [])
  const listings = useAsyncData<DealerListing[]>(fetchListings, listingsError)

  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [archiving, setArchiving] = useState<string | null>(null)
  const confirm = useConfirm()

  const backToList = () => setMode({ kind: 'list' })

  const onCreate = async (input: CreateListingInput) => {
    try {
      await createListing(input)
      toast.success('Listing created and sent for review')
      backToList()
      listings.reload()
    } catch (error) {
      toast.error(toErrorMessage(error, 'Could not create the listing.'))
    }
  }

  const onUpdate = async (id: string, input: CreateListingInput) => {
    try {
      // PATCH takes a partial; sending the whole form is simplest and the
      // backend ignores nothing it was given.
      await updateListing(id, input)
      toast.success('Listing updated')
      backToList()
      listings.reload()
    } catch (error) {
      toast.error(toErrorMessage(error, 'Could not update the listing.'))
    }
  }

  const onDeactivate = async (listing: DealerListing) => {
    if (!confirm(`Archive ${listing.make} ${listing.model}? It will stop appearing in search.`)) {
      return
    }

    setArchiving(listing.id)
    try {
      await deactivateListing(listing.id)
      toast.success('Listing archived')
      listings.reload()
    } catch (error) {
      toast.error(toErrorMessage(error, 'Could not archive the listing.'))
    } finally {
      setArchiving(null)
    }
  }

  if (mode.kind === 'create') {
    return (
      <div className="dealer-page">
        <header className="dealer-page__header">
          <h1>New listing</h1>
          <p>It goes for review before appearing in search.</p>
        </header>

        <ListingForm onSubmit={onCreate} onCancel={backToList} submitLabel="Create listing" />
      </div>
    )
  }

  if (mode.kind === 'edit') {
    return (
      <div className="dealer-page">
        <header className="dealer-page__header">
          <h1>
            Edit {mode.listing.make} {mode.listing.model}
          </h1>
          <p>Changes to searchable fields re-index the listing automatically.</p>
        </header>

        <ListingForm
          listing={mode.listing}
          onSubmit={(input) => onUpdate(mode.listing.id, input)}
          onCancel={backToList}
          submitLabel="Save changes"
        />
      </div>
    )
  }

  return (
    <div className="dealer-page">
      <header className="dealer-page__header">
        <h1>My listings</h1>
        <p>Every vehicle you have listed, however it was added.</p>
      </header>

      <div className="dealer-page__actions">
        <Button onClick={() => setMode({ kind: 'create' })}>New listing</Button>
      </div>

      {listings.loading && (
        <p className="dealer-muted" role="status">
          Loading your listings…
        </p>
      )}

      {!listings.loading && listings.error && <ErrorBanner message={listings.error} />}

      {!listings.loading && !listings.error && listings.data?.length === 0 && (
        <div className="empty-state">
          <p>You have no listings yet.</p>
          <p className="empty-state__detail">
            Add one here, or upload your whole inventory at once from Bulk upload.
          </p>
        </div>
      )}

      {!listings.loading && !listings.error && (listings.data?.length ?? 0) > 0 && (
        <div className="listing-table-wrap">
          <table className="listing-table">
            <thead>
              <tr>
                <th scope="col">Vehicle</th>
                <th scope="col">Year</th>
                <th scope="col">Price</th>
                <th scope="col">Mileage</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {listings.data?.map((listing) => (
                <tr key={listing.id}>
                  <th scope="row">
                    {listing.make} {listing.model}
                  </th>
                  <td>{listing.manufactureYear}</td>
                  <td>{formatPrice(listing.price)}</td>
                  <td>{formatMileage(listing.mileage)}</td>
                  <td>
                    <StatusBadge status={listing.status} />
                  </td>
                  <td className="listing-table__actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setMode({ kind: 'edit', listing })}
                    >
                      Edit
                    </Button>
                    {/* Already archived: nothing left to deactivate. */}
                    {listing.status !== 'ARCHIVED' && (
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={archiving === listing.id}
                        onClick={() => void onDeactivate(listing)}
                      >
                        {archiving === listing.id ? 'Archiving…' : 'Archive'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
