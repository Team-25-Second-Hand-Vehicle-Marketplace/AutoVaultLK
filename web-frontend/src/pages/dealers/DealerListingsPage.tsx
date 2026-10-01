import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  approveListing,
  approveSelectedListings,
  deactivateListing,
  deleteListing,
  deleteListingImage,
  getMyListings,
  unarchiveListing,
  updateListing,
  uploadListingImages,
} from '../../api/listings.api'
import type {
  CreateListingInput,
  DealerListing,
  ListingSortOption,
  ListingStatus,
} from '../../api/listings.types'
import { toErrorMessage } from '../../api/client'
import { useAsyncData } from '../../hooks/useAsyncData'
import { ListingForm } from '../../components/dealers/ListingForm'
import { NewListingMenu } from '../../components/dealers/NewListingMenu'
import { ListingDetails } from '../../components/dealers/ListingDetails'
import {
  NormalizationDetails,
  NormalizationSummary,
} from '../../components/dealers/NormalizationBadge'
import { Button } from '../../components/ui/Button'
import { ErrorBanner } from '../../components/ui/ErrorBanner'
import { StatusBadge } from '../../components/dealers/StatusBadge'
import { useDealerProfile } from './useDealerProfile'
import { formatMileage, formatPrice, sentenceCase } from '../../components/search/vehicle-format'
import { ListingColumnHeader } from '../../components/dealers/ListingColumnHeader'
import { nextColumnSort, sortListings, type ColumnKey, type ColumnSort } from '../../components/dealers/listing-sort'

/**
 * Manual listing management (FR-58), plus the bulk-upload review queue
 * (FR-42/FR-42.1).
 *
 * The three CRUD routes behind this have existed and been guarded since the
 * listings module landed; until now nothing in the UI called them, so a
 * dealer could only add stock through bulk upload. Approval had a status
 * (PENDING_REVIEW) describing the wait but no action ending it - a bulk
 * upload landed every row here and nothing let a dealer move one forward.
 */

const listingsError = (err: unknown) => toErrorMessage(err, 'Could not load your listings.')

/** Archiving cannot be undone from this page, so it asks first. */
function useConfirm() {
  return useCallback((message: string) => window.confirm(message), [])
}

/**
 * Statuses the backend allows a hard delete on - mirrors
 * ListingService.DELETABLE_STATUSES. A LIVE, SOLD or ARCHIVED listing may
 * already be referenced by a favourite or a recommendation, so those only
 * ever offer Archive; keeping this list here means the button never appears
 * only to 409 on click.
 */
const DELETABLE_STATUSES: ListingStatus[] = ['DRAFT', 'PENDING_REVIEW', 'REJECTED']

type Mode = { kind: 'list' } | { kind: 'edit'; listing: DealerListing }

export function DealerListingsPage() {
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [archiving, setArchiving] = useState<string | null>(null)
  const [unarchiving, setUnarchiving] = useState<string | null>(null)
  const [approving, setApproving] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const confirm = useConfirm()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [approvingSelected, setApprovingSelected] = useState(false)

  // FR-42.1's default: a dealer opening this page with rows awaiting review
  // sees the ones most likely to need a correction first, not buried under
  // whatever bulk upload happened to load last. Switchable, because a dealer
  // checking on a specific recent listing wants newest-first instead.
  const [sort, setSort] = useState<ListingSortOption>('confidence_asc')
  // A column header click sorts what is already loaded; the dropdown above is
  // the server-side order, and choosing from it hands control back to it.
  const [columnSort, setColumnSort] = useState<ColumnSort | null>(null)

  const fetchListings = useCallback(
    (signal: AbortSignal) => getMyListings(sort === 'confidence_asc' ? sort : undefined, signal),
    [sort],
  )
  const listings = useAsyncData<DealerListing[]>(fetchListings, listingsError)
  const dealer = useDealerProfile().data

  const pendingReviewCount =
    listings.data?.filter((l) => l.status === 'PENDING_REVIEW').length ?? 0

  const backToList = () => setMode({ kind: 'list' })

  // The selection is only ever read through the rows currently listed, so an id
  // left over from a deleted or reloaded-away listing is simply never counted.
  const rows = listings.data ?? []
  const displayRows = sortListings(rows, columnSort)
  const selectedRows = rows.filter((l) => selected.has(l.id))
  const allSelected = rows.length > 0 && selectedRows.length === rows.length
  const someSelected = selectedRows.length > 0 && !allSelected
  const selectedPending = selectedRows.filter((l) => l.status === 'PENDING_REVIEW')

  const selectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  const toggleOne = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const onSortColumn = (key: ColumnKey) => setColumnSort((current) => nextColumnSort(current, key))

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(rows.map((l) => l.id)))

  const onApproveSelected = async () => {
    const ids = selectedPending.map((l) => l.id)
    if (ids.length === 0 || approvingSelected) return

    if (
      !confirm(
        `Approve and publish ${ids.length} selected listing${ids.length === 1 ? '' : 's'}? They will appear in search straight away, including any whose fields you have not checked.`,
      )
    ) {
      return
    }

    setApprovingSelected(true)
    try {
      const { approved, skipped } = await approveSelectedListings(ids)
      toast.success(
        approved === 0
          ? 'None of the selected listings were awaiting approval'
          : `${approved} listing${approved === 1 ? '' : 's'} published` +
              (skipped > 0 ? `, ${skipped} skipped (no longer pending)` : ''),
      )
      setSelected(new Set())
      // A full re-fetch rather than patching rows in place: the server decides
      // which ones were still pending, which may differ from this stale view.
      listings.reload()
    } catch (error) {
      toast.error(toErrorMessage(error, 'Could not approve the selected listings.'))
    } finally {
      setApprovingSelected(false)
    }
  }

  const onUpdate = async (id: string, input: CreateListingInput, images: File[]) => {
    try {
      // PATCH takes a partial; sending the whole form is simplest and the
      // backend ignores nothing it was given.
      await updateListing(id, input)

      // Empty images means "leave the existing photos alone" - the form
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

  const onDeleteImage = async (listingId: string, imageId: string) => {
    try {
      await deleteListingImage(listingId, imageId)
      toast.success('Photo removed')
      // The open edit form tracks its own copy of the image list and updates
      // itself on success; this only keeps the background cache in sync so a
      // reopened row (or the expanded details panel) reflects it too.
      listings.setData(
        (data) =>
          data?.map((l) =>
            l.id === listingId
              ? { ...l, images: l.images.filter((img) => img.id !== imageId) }
              : l,
          ) ?? data,
      )
    } catch (error) {
      toast.error(toErrorMessage(error, 'Could not remove the photo.'))
      throw error
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

  const onUnarchive = async (listing: DealerListing) => {
    setUnarchiving(listing.id)
    try {
      await unarchiveListing(listing.id)
      toast.success(`${listing.make} ${listing.model} is live again`)
      listings.reload()
    } catch (error) {
      // The backend 409s a listing that changed status between page load and
      // this click (already unarchived elsewhere, say); its message explains
      // that directly.
      toast.error(toErrorMessage(error, 'Could not unarchive the listing.'))
    } finally {
      setUnarchiving(null)
    }
  }

  const onDelete = async (listing: DealerListing) => {
    if (
      !confirm(
        `Permanently delete ${listing.make} ${listing.model}? This cannot be undone - the listing and its photos are removed entirely, not just hidden.`,
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
      // Updates this one row in place rather than reload()'s full re-fetch -
      // the approve response already tells us the only thing that changed.
      listings.setData(
        (data) => data?.map((l) => (l.id === listing.id ? { ...l, status: 'LIVE' } : l)) ?? data,
      )
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
          onDeleteImage={(imageId) => onDeleteImage(mode.listing.id, imageId)}
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

      <div className="dealer-page__actions listing-toolbar">
        <NewListingMenu canBulkUpload={dealer?.dealerType === 'business'} />

        <label className="listing-toolbar__sort">
          <span>Sort by</span>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as ListingSortOption)
              setColumnSort(null)
            }}
          >
            <option value="confidence_asc">Lowest confidence first</option>
            <option value="createdAt">Most recent</option>
          </select>
        </label>
      </div>

      {pendingReviewCount > 0 && (
        <div className="review-banner" role="status">
          <p>
            {pendingReviewCount} listing{pendingReviewCount === 1 ? '' : 's'} awaiting your
            review. Check the fields marked below, then approve to publish. Tick several to
            approve them together.
          </p>
        </div>
      )}

      {selectedRows.length > 0 && (
        <div className="selection-bar" role="status">
          <span>
            {selectedRows.length} selected
            {selectedPending.length !== selectedRows.length &&
              ` (${selectedPending.length} awaiting review)`}
          </span>
          <div className="selection-bar__actions">
            <Button
              size="sm"
              disabled={selectedPending.length === 0 || approvingSelected}
              onClick={() => void onApproveSelected()}
            >
              {approvingSelected ? 'Approving…' : `Approve selected (${selectedPending.length})`}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          </div>
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
            {dealer?.dealerType === 'business'
              ? 'Add your first vehicle with the New listing button above, or upload your whole inventory at once from Bulk upload.'
              : 'Add your first vehicle with the New listing button above.'}
          </p>
        </div>
      )}

      {!listings.loading && !listings.error && (listings.data?.length ?? 0) > 0 && (
        <div className="listing-table-wrap">
          <table className="listing-table">
            <thead>
              <tr>
                <th scope="col" className="listing-table__select">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    aria-label="Select all listings"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </th>
                <ListingColumnHeader label="Vehicle" columnKey="vehicle" sort={columnSort} onSort={onSortColumn} className="listing-table__vehicle" />
                <ListingColumnHeader label="Type" columnKey="type" sort={columnSort} onSort={onSortColumn} className="listing-table__compact" />
                <ListingColumnHeader label="Condition" columnKey="condition" sort={columnSort} onSort={onSortColumn} className="listing-table__compact" />
                <ListingColumnHeader label="Year" columnKey="year" sort={columnSort} onSort={onSortColumn} className="listing-table__compact" />
                <ListingColumnHeader label="Price" columnKey="price" sort={columnSort} onSort={onSortColumn} className="listing-table__compact" />
                <ListingColumnHeader label="Mileage" columnKey="mileage" sort={columnSort} onSort={onSortColumn} className="listing-table__compact" />
                <ListingColumnHeader label="Status" columnKey="status" sort={columnSort} onSort={onSortColumn} className="listing-table__compact" />
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((listing) => (
                <Fragment key={listing.id}>
                  <tr className={selected.has(listing.id) ? 'listing-table__row--selected' : undefined}>
                    <td className="listing-table__select">
                      <input
                        type="checkbox"
                        aria-label={`Select ${listing.make} ${listing.model}`}
                        checked={selected.has(listing.id)}
                        onChange={() => toggleOne(listing.id)}
                      />
                    </td>
                    <th scope="row" className="listing-table__vehicle">
                      {listing.make} {listing.model}
                      <NormalizationSummary normalization={listing.normalization} />
                    </th>
                    <td className="listing-table__compact">{sentenceCase(listing.vehicleType)}</td>
                    <td className="listing-table__compact">{sentenceCase(listing.condition)}</td>
                    <td className="listing-table__compact">{listing.manufactureYear}</td>
                    <td className="listing-table__compact">{formatPrice(listing.price)}</td>
                    <td className="listing-table__compact">{formatMileage(listing.mileage)}</td>
                    <td className="listing-table__compact">
                      <StatusBadge status={listing.status} />
                      {listing.needsManualReview && (
                        <span className="listing-status listing-status--review">
                          Needs photo
                        </span>
                      )}
                    </td>
                    <td className="listing-table__actions">
                      <div className="listing-actions">
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

                        {/* Edit is always offered. Archive, Unarchive and Delete appear
                            only when the backend would accept them for this status, so a
                            button never shows up just to 409 on click. */}
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Edit ${listing.make} ${listing.model}`}
                          onClick={() => setMode({ kind: 'edit', listing })}
                        >
                          Edit
                        </Button>

                        {listing.status === 'ARCHIVED' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Unarchive ${listing.make} ${listing.model}`}
                            disabled={unarchiving === listing.id}
                            onClick={() => void onUnarchive(listing)}
                          >
                            {unarchiving === listing.id ? 'Unarchiving…' : 'Unarchive'}
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="listing-action--danger"
                            aria-label={`Archive ${listing.make} ${listing.model}`}
                            disabled={archiving === listing.id}
                            onClick={() => void onDeactivate(listing)}
                          >
                            {archiving === listing.id ? 'Archiving…' : 'Archive'}
                          </Button>
                        )}

                        {/* Never went live: nothing external can reference it, so a
                            permanent delete is safe - see ListingService.DELETABLE_STATUSES. */}
                        {DELETABLE_STATUSES.includes(listing.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="listing-action--danger"
                            aria-label={`Delete ${listing.make} ${listing.model}`}
                            disabled={deleting === listing.id}
                            onClick={() => void onDelete(listing)}
                          >
                            {deleting === listing.id ? 'Deleting…' : 'Delete'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {(listing.normalization ||
                    listing.needsManualReview ||
                    Object.keys(listing.specs ?? {}).length > 0 ||
                    listing.images.length > 0) && (
                    <tr className="listing-table__details-row">
                      {/* An empty cell under the checkbox column, so the details start
                          under the vehicle name instead of under the checkbox. */}
                      <td />
                      <td colSpan={8}>
                        <div className="listing-table__details">
                          <NormalizationDetails normalization={listing.normalization} />
                          <ListingDetails listing={listing} />
                        </div>
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
