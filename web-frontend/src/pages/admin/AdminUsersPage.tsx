import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  approveDealer,
  deactivateUser,
  listUsers,
  rejectDealer,
} from '../../api/admin.api'
import type { AdminUserRow } from '../../api/admin.types'
import { toErrorMessage } from '../../api/client'
import { useAuth } from '../../auth/useAuth'

type Tab = 'all' | 'pending'

function formatDate(value: string): string {
  return new Date(value).toLocaleString('en-LK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function AdminUsersPage() {
  const { user: actor } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') === 'pending' ? 'pending' : 'all') as Tab

  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const data = await listUsers(
        tab === 'pending' ? 'PENDING' : undefined,
        signal,
      )
      if (!signal?.aborted) setRows(data)
    } catch (err) {
      if (!signal?.aborted) {
        setError(toErrorMessage(err, 'Could not load users.'))
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [tab])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const setTab = (next: Tab) => {
    if (next === 'pending') setSearchParams({ tab: 'pending' })
    else setSearchParams({})
  }

  const pendingCount = useMemo(
    () => rows.filter((r) => r.dealer?.verificationStatus === 'PENDING').length,
    [rows],
  )

  const runMutation = async (
    id: string,
    action: () => Promise<unknown>,
    success: string,
  ) => {
    setBusyId(id)
    try {
      await action()
      toast.success(success)
      await load()
    } catch (err) {
      toast.error(toErrorMessage(err, 'Action failed.'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-page__header">
        <h1>Users</h1>
        <p>Approve dealers and deactivate accounts.</p>
      </header>

      <div className="admin-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'all'}
          className={`admin-tabs__btn${tab === 'all' ? ' admin-tabs__btn--active' : ''}`}
          onClick={() => setTab('all')}
        >
          All users
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'pending'}
          className={`admin-tabs__btn${tab === 'pending' ? ' admin-tabs__btn--active' : ''}`}
          onClick={() => setTab('pending')}
        >
          Pending dealers{tab === 'pending' && !loading ? ` (${pendingCount})` : ''}
        </button>
      </div>

      {error && (
        <div className="form-error form-error--banner" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="admin-muted" role="status">
          Loading users…
        </p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Dealer</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="admin-table__empty">
                    No users match this view.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const isSelf = row.id === actor?.id
                  const pending = row.dealer?.verificationStatus === 'PENDING'
                  const dealerId = row.dealer?.userId
                  const busy = busyId === row.id || (dealerId != null && busyId === dealerId)

                  return (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.email}</td>
                      <td>
                        <span className="admin-pill">{row.role}</span>
                      </td>
                      <td>
                        <span
                          className={`admin-pill${row.isActive ? ' admin-pill--ok' : ' admin-pill--danger'}`}
                        >
                          {row.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        {row.dealer ? (
                          <>
                            <div>{row.dealer.companyName}</div>
                            <span className="admin-muted">
                              {row.dealer.city} · {row.dealer.verificationStatus}
                            </span>
                          </>
                        ) : (
                          <span className="admin-muted">—</span>
                        )}
                      </td>
                      <td>{formatDate(row.createdAt)}</td>
                      <td>
                        <div className="admin-actions">
                          {pending && dealerId && (
                            <>
                              <button
                                type="button"
                                className="button button--primary button--sm"
                                disabled={busy}
                                onClick={() =>
                                  void runMutation(
                                    dealerId,
                                    () => approveDealer(dealerId),
                                    'Dealer approved',
                                  )
                                }
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className="button button--ghost button--sm"
                                disabled={busy}
                                onClick={() =>
                                  void runMutation(
                                    dealerId,
                                    () => rejectDealer(dealerId),
                                    'Dealer rejected',
                                  )
                                }
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {row.isActive && !isSelf && row.role !== 'ADMIN' && (
                            <button
                              type="button"
                              className="button button--danger button--sm"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `Deactivate ${row.email}? They will not be able to sign in.`,
                                  )
                                ) {
                                  return
                                }
                                void runMutation(
                                  row.id,
                                  () => deactivateUser(row.id),
                                  'User deactivated',
                                )
                              }}
                            >
                              Deactivate
                            </button>
                          )}
                          {isSelf && <span className="admin-muted">You</span>}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
