import { Fragment, useCallback, useState } from 'react'
import { toast } from 'sonner'
import {
  approveListing,
  createListing,
  deactivateListing,
  deleteListing,
  getMyListings,
  updateListing,
  uploadListingImages,
} from '../../api/listings.api'
import type {
  CreateListingInput,
  DealerListing,
  ListingStatus,
} from '../../api/listings.types'
import { toErrorMessage } from '../../api/client'
import { useAsyncData } from '../../hooks/useAsyncData'
import { ListingForm } from '../../components/dealers/ListingForm'
import { ListingDetails } from '../../components/dealers/ListingDetails'
import {
  NormalizationDetails,
  NormalizationSummary,
} from '../../components/dealers/NormalizationBadge'
import { Button } from '../../components/ui/Button'
import { ErrorBanner } from '../../components/ui/ErrorBanner'
import { formatMileage, formatPrice } from '../../components/search/vehicle-format'

/**
 * Manual listing management (FR-58), plus the bulk-upload review queue
 * (FR-42/FR-42.1).
 *
 * The three CRUD routes behind this have existed and been guarded since the
 * listings module landed; until now nothing in the UI called them, so a
 * dealer could only add stock through bulk upload. Approval had a status
 * (PENDING_REVIEW) describing the wait but no action ending it — a bulk
 * upload landed every row here and nothing let a dealer move one forward.
 */

const listingsError = (err: unknown) => toErrorMessage(err, 'Could not load your listings.')

/** Archiving cannot be undone from this page, so it asks first. */
function useConfirm() {
  return useCallback((message: string) => window.confirm(message), [])
}

function StatusBadge({ status }: { status: ListingStatus }) {
  return <span className={`listing-status listing-status--${status.toLowerCase()}`}>{status.replace(/_/g, ' ')}</span>
}

/**
 * Statuses the backend allows a hard delete on — mirrors
 * ListingService.DELETABLE_STATUSES. A LIVE, SOLD or ARCHIVED listing may
 * already be referenced by a favourite or a recommendation, so those only
 * ever offer Archive; keeping this list here means the button never appears
 * only to 409 on click.
 */
const DELETABLE_STATUSES: ListingStatus[] = ['DRAFT', 'PENDING_REVIEW', 'REJECTED']

type Mode =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; listing: DealerListing }

export function DealerListingsPage() {
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [archiving, setArchiving] = useState<string | null>(null)
  const [approving, setApproving] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const confirm = useConfirm()

  // FR-42.1's default: a dealer opening this page with rows awaiting review
  // sees the ones most likely to need a correction first, not buried under
  // whatever bulk upload happened to load last. Toggleable, because a dealer
  // checking on a specific recent listing wants newest-first instead.
  const [reviewOrder, setReviewOrder] = useState(true)

  const fetchListings = useCallback(
    (signal: AbortSignal) => getMyListings(reviewOrder ? 'confidence_asc' : undefined, signal),
    [reviewOrder],
  )
  const listings = useAsyncData<DealerListing[]>(fetchListings, listingsError)

  const pendingReviewCount =
    listings.data?.filter((l) => l.status === 'PENDING_REVIEW').length ?? 0

  const backToList = () => setMode({ kind: 'list' })

  const onCreate = async (input: CreateListingInput, images: File[]) => {
    try {
      const listing = await createListing(input)
      // A photo upload failing here is a different, lesser problem than the
      // listing itself failing to create: the listing exists either way, so
      // this gets its own try/catch and its own message rather than
      // aborting the whole flow or reporting the wrong failure.
      if (images.length > 0) {
        try {
          await uploadListingImages(listing.id, images)
        } catch (error) {
          toast.error(
            toErrorMessage(error, 'Listing created, but the photos could not be uploaded.'),
          )
          backToList()
          listings.reload()
          return
        }
      }
      toast.success('Listing created and sent for review')
      backToList()
      listings.reload()
    } catch (error) {
      toast.error(toErrorMessage(error, 'Could not create the listing.'))
    }
  }

  const onUpdate = async (id: string, input: CreateListingInput, images: File[]) => {
    try {
      // PATCH takes a partial; sending the whole form is simplest and the
      // backend ignores nothing it was given.
      await updateListing(id, input)

      // Empty images means "leave the existing photos alone" — the form
      // only asks for new files when the dealer actually wants to replace
      // them (see the "Replace photos" label in edit mode), and calling the
      // upload endpoint here regardless would delete every existing photo
      // the moment a dealer edited only the price.
      if (images.length > 0) {
        try {
          await uploadListingImages(id, images)
        } catch (error) {
          toast.error(
            toErrorMessage(error, 'Listing updated, but the photos could not be uploaded.'),
          )
          backToList()
          listings.reload()
          return
        }
      }

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

  const onDelete = async (listing: DealerListing) => {
    if (
      !confirm(
        `Permanently delete ${listing.make} ${listing.model}? This cannot be undone — the listing and its photos are removed entirely, not just hidden.`,
      )
    ) {
      return
    }

    setDeleting(listing.id)
    try {
      await deleteListing(listing.id)
      toast.success('Listing deleted')
      listings.reload()
    } catch (error) {
      // The backend 409s a listing that moved to LIVE/SOLD/ARCHIVED between
      // page load and this click; its message explains that directly.
      toast.error(toErrorMessage(error, 'Could not delete the listing.'))
    } finally {
      setDeleting(null)
    }
  }

  const onApprove = async (listing: DealerListing) => {
    setApproving(listing.id)
    try {
      await approveListing(listing.id)
      toast.success(`${listing.make} ${listing.model} is now live`)
      listings.reload()
    } catch (error) {
      // The backend 409s a listing that changed status between page load and
      // this click (someone else on the account approved it, say); the
      // message it sends explains that directly, so the fallback here only
      // covers a genuinely unexpected failure.
      toast.error(toErrorMessage(error, 'Could not approve the listing.'))
    } finally {
      setApproving(null)
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
          onSubmit={(input, images) => onUpdate(mode.listing.id, input, images)}
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

      {pendingReviewCount > 0 && (
        <div className="review-banner" role="status">
          <p>
            {pendingReviewCount} listing{pendingReviewCount === 1 ? '' : 's'} awaiting your
            review. Check the fields marked below, then approve to publish.
          </p>
          <label className="review-banner__toggle">
            <input
              type="checkbox"
              checked={reviewOrder}
              onChange={(e) => setReviewOrder(e.target.checked)}
            />
            Show lowest-confidence rows first
          </label>
        </div>
      )}

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
                <Fragment key={listing.id}>
                  <tr>
                    <th scope="row">
                      {listing.make} {listing.model}
                      <NormalizationSummary normalization={listing.normalization} />
                    </th>
                    <td>{listing.manufactureYear}</td>
                    <td>{formatPrice(listing.price)}</td>
                    <td>{formatMileage(listing.mileage)}</td>
                    <td>
                      <StatusBadge status={listing.status} />
                      {listing.needsManualReview && (
                        <span className="listing-status listing-status--review">
                          Needs photo
                        </span>
                      )}
                    </td>
                    <td className="listing-table__actions">
                      {listing.status === 'PENDING_REVIEW' && (
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={approving === listing.id}
                          onClick={() => void onApprove(listing)}
                        >
                          {approving === listing.id ? 'Approving…' : 'Approve'}
                        </Button>
                      )}
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
                      {/* Never went live: nothing external can reference it, so a permanent delete is safe. */}
                      {DELETABLE_STATUSES.includes(listing.status) && (
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={deleting === listing.id}
                          onClick={() => void onDelete(listing)}
                        >
                          {deleting === listing.id ? 'Deleting…' : 'Delete'}
                        </Button>
                      )}
                    </td>
                  </tr>
                  {(listing.normalization ||
                    listing.needsManualReview ||
                    Object.keys(listing.specs ?? {}).length > 0 ||
                    listing.images.length > 0) && (
                    <tr className="listing-table__details-row">
                      <td colSpan={6}>
                        <NormalizationDetails normalization={listing.normalization} />
                        <ListingDetails listing={listing} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
