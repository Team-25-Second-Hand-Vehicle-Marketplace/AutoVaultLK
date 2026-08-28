import { useCallback, useMemo, useState } from 'react'
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
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../auth/useAuth'
import { Button } from '../../components/ui/Button'
import { ErrorBanner } from '../../components/ui/ErrorBanner'
import { Pill } from '../../components/ui/Pill'
import { AdminTable } from '../../components/ui/AdminTable'
import { formatDate } from '../../utils/format'

type Tab = 'all' | 'pending'

const usersError = (err: unknown) => toErrorMessage(err, 'Could not load users.')

export function AdminUsersPage() {
  const { user: actor } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') === 'pending' ? 'pending' : 'all') as Tab

  const [busyId, setBusyId] = useState<string | null>(null)

  const fetchUsers = useCallback(
    (signal: AbortSignal) =>
      listUsers(tab === 'pending' ? 'PENDING' : undefined, signal),
    [tab],
  )
  const {
    data,
    error,
    loading,
    reload: load,
  } = useAsyncData<AdminUserRow[]>(fetchUsers, usersError,
  )
  // useMemo so the fallback [] keeps a stable identity; a fresh array each
  // render would invalidate the pendingCount memo below on every render.
  const rows = useMemo(() => data ?? [], [data])

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
      load()
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

      <ErrorBanner message={error} />

      <AdminTable
        columns={['Name', 'Email', 'Role', 'Status', 'Dealer', 'Joined', 'Actions']}
        rows={rows}
        loading={loading}
        loadingLabel="Loading users…"
        emptyLabel="No users match this view."
        renderRow={(row) => {
          const isSelf = row.id === actor?.id
          const pending = row.dealer?.verificationStatus === 'PENDING'
          const dealerId = row.dealer?.userId
          const busy = busyId === row.id || (dealerId != null && busyId === dealerId)

          return (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>{row.email}</td>
              <td>
                <Pill>{row.role}</Pill>
              </td>
              <td>
                <Pill variant={row.isActive ? 'ok' : 'danger'}>
                  {row.isActive ? 'Active' : 'Inactive'}
                </Pill>
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
                      <Button
                        type="button"
                        size="sm"
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
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
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
                      </Button>
                    </>
                  )}
                  {row.isActive && !isSelf && row.role !== 'ADMIN' && (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
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
                    </Button>
                  )}
                  {isSelf && <span className="admin-muted">You</span>}
                </div>
              </td>
            </tr>
          )
        }}
      />
    </div>
  )
}
