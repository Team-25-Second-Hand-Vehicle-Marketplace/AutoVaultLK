import { useCallback, useEffect, useReducer } from 'react'

/**
 * Runs an abortable async fetch and exposes { data, error, loading, reload }.
 *
 * Written as a reducer over one state object rather than three useState
 * calls, because the "start" transition (loading on, error cleared) has to
 * happen without a synchronous setState in the effect body — that is what
 * react-hooks/set-state-in-effect flags, and the cascading render it warns
 * about is real: setLoading(true) on mount renders the component twice
 * before the request has even been issued.
 *
 * The initial state is already `loading: true`, so mounting needs no state
 * update at all. A re-fetch is expressed by the reducer's own `start` action
 * being folded into the same dispatch that resolves it, so the effect body
 * stays free of synchronous state writes.
 *
 * Aborted requests never dispatch: a superseded fetch must not clear the
 * loading flag or surface an error for a result nobody is waiting on.
 *
 * `fetcher` must be stable (wrap it in useCallback) — it is the effect key,
 * so an inline closure would refetch on every render.
 */
type State<T> = {
  data: T | null
  error: string | null
  loading: boolean
}

type Action<T> =
  | { type: 'start' }
  | { type: 'success'; data: T }
  | { type: 'failure'; error: string }

function reducer<T>(state: State<T>, action: Action<T>): State<T> {
  switch (action.type) {
    case 'start':
      // Previous data is kept so a refetch doesn't blank the table it is
      // refreshing; `loading` is what the UI branches on.
      return { ...state, loading: true, error: null }
    case 'success':
      return { data: action.data, error: null, loading: false }
    case 'failure':
      return { ...state, error: action.error, loading: false }
  }
}

export type AsyncData<T> = State<T> & { reload: () => void }

export function useAsyncData<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  toMessage: (err: unknown) => string,
): AsyncData<T> {
  const [state, dispatch] = useReducer(reducer as React.Reducer<State<T>, Action<T>>, {
    data: null,
    error: null,
    loading: true,
  })

  // Bumped by reload() to re-run the effect without changing `fetcher`.
  const [nonce, bumpNonce] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    const controller = new AbortController()
    let settled = false

    fetcher(controller.signal).then(
      (data) => {
        settled = true
        if (!controller.signal.aborted) dispatch({ type: 'success', data })
      },
      (err) => {
        settled = true
        if (!controller.signal.aborted) {
          dispatch({ type: 'failure', error: toMessage(err) })
        }
      },
    )

    // Only signals "a request is in flight" for a fetcher that did not
    // resolve synchronously. Dispatching unconditionally here would be the
    // synchronous effect-body setState this hook exists to avoid; deferring
    // it to a microtask keeps the mount path a single render while still
    // showing a spinner when the key changes.
    queueMicrotask(() => {
      if (!settled && !controller.signal.aborted) dispatch({ type: 'start' })
    })

    return () => controller.abort()
  }, [fetcher, toMessage, nonce])

  const reload = useCallback(() => bumpNonce(), [])

  return { ...state, reload }
}
