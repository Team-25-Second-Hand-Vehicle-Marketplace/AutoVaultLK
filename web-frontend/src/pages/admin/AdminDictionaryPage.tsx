import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import {
  addDictionaryAlias,
  addDictionaryMake,
  dismissDictionaryCandidate,
  listDictionaryCandidates,
} from '../../api/admin.api'
import type { DictionaryCandidate } from '../../api/admin.types'
import { toErrorMessage } from '../../api/client'
import { useAsyncData } from '../../hooks/useAsyncData'
import { Button } from '../../components/ui/Button'
import { ErrorBanner } from '../../components/ui/ErrorBanner'
import { Pill } from '../../components/ui/Pill'
import { AdminTable } from '../../components/ui/AdminTable'

/**
 * FR-?? (dictionary review): a dealer's make text that never resolved during
 * bulk upload - some of it is a genuinely new vehicle type (a brand this
 * marketplace has never catalogued), most of it is noise (a typo, a blank, a
 * placeholder). The backend already filters out anything a one-off row
 * produced and scores each candidate against the existing dictionary, so
 * this page's job is just showing that judgement clearly: how often it
 * recurs, across how many dealers, and how close the nearest real make is.
 */

const candidatesError = (err: unknown) =>
  toErrorMessage(err, 'Could not load unresolved makes.')

export function AdminDictionaryPage() {
  const [busyValue, setBusyValue] = useState<string | null>(null)

  const fetchCandidates = useCallback(
    (signal: AbortSignal) => listDictionaryCandidates(signal),
    [],
  )
  const candidates = useAsyncData<DictionaryCandidate[]>(fetchCandidates, candidatesError)

  const runAction = async (
    rawValue: string,
    action: () => Promise<unknown>,
    success: string,
  ) => {
    setBusyValue(rawValue)
    try {
      await action()
      toast.success(success)
      // Removes the row locally instead of a full reload - the mutation
      // already tells us the one thing that changed (this candidate is
      // handled), and refetching the whole aggregation query just to learn
      // that is a visible loading flash for zero new information.
      candidates.setData((data) => data?.filter((c) => c.rawValue !== rawValue) ?? data)
    } catch (err) {
      toast.error(toErrorMessage(err, 'Action failed.'))
    } finally {
      setBusyValue(null)
    }
  }

  const onAddMake = (candidate: DictionaryCandidate) => {
    const canonicalValue = window.prompt(
      `Add "${candidate.displayValue}" as a new make. Confirm or edit the name that should appear on listings:`,
      candidate.displayValue,
    )
    if (!canonicalValue?.trim()) return
    void runAction(
      candidate.rawValue,
      () => addDictionaryMake(candidate.rawValue, canonicalValue.trim()),
      `${canonicalValue.trim()} added`,
    )
  }

  const onAddAlias = (candidate: DictionaryCandidate) => {
    if (!candidate.closestMatch) return
    const target = candidate.closestMatch.canonicalValue
    if (
      !window.confirm(
        `Treat "${candidate.displayValue}" as a misspelling of ${target}? Future uploads with this spelling will resolve to ${target}.`,
      )
    ) {
      return
    }
    void runAction(
      candidate.rawValue,
      () => addDictionaryAlias(candidate.rawValue, candidate.displayValue, candidate.closestMatch!.id),
      `Linked to ${target}`,
    )
  }

  const onDismiss = (candidate: DictionaryCandidate) => {
    void runAction(
      candidate.rawValue,
      () => dismissDictionaryCandidate(candidate.rawValue),
      'Dismissed',
    )
  }

  const rows = candidates.data ?? []

  return (
    <div className="admin-page">
      <header className="admin-page__header">
        <h1>New vehicle types</h1>
        <p>
          Makes dealers typed that never matched the dictionary. Add the real ones; dismiss the
          rest so they stop reappearing.
        </p>
      </header>

      <ErrorBanner message={candidates.error} />

      <AdminTable
        columns={['Make typed', 'Seen', 'Closest match', 'Sample rows', 'Actions']}
        rows={rows}
        loading={candidates.loading}
        loadingLabel="Loading unresolved makes…"
        emptyLabel="Nothing to review - every recent make either resolved or has been handled."
        renderRow={(row) => {
          const busy = busyValue === row.rawValue

          return (
            <tr key={row.rawValue}>
              <th scope="row">{row.displayValue}</th>
              <td>
                {row.occurrences} row{row.occurrences === 1 ? '' : 's'}
                <br />
                <span className="admin-muted">
                  {row.dealerCount} dealer{row.dealerCount === 1 ? '' : 's'}
                </span>
              </td>
              <td>
                {row.closestMatch ? (
                  <Pill variant="warn">
                    {row.closestMatch.canonicalValue} ({Math.round(row.closestMatch.score * 100)}%)
                  </Pill>
                ) : (
                  <Pill variant="ok">No close match</Pill>
                )}
              </td>
              <td>
                {row.samples.length === 0 ? (
                  <span className="admin-muted">-</span>
                ) : (
                  <ul className="admin-sample-list">
                    {row.samples.map((sample, i) => (
                      <li key={i}>
                        {[sample.model, sample.description].filter(Boolean).join(' - ') || (
                          <span className="admin-muted">no model or description</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td>
                <div className="admin-actions">
                  {row.closestMatch && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => onAddAlias(row)}
                    >
                      Add as alias
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => onAddMake(row)}
                  >
                    Add as new make
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    onClick={() => onDismiss(row)}
                  >
                    Dismiss
                  </Button>
                </div>
              </td>
            </tr>
          )
        }}
      />
    </div>
  )
}
