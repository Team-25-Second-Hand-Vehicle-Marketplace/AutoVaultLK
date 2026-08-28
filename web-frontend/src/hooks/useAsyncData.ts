import { useCallback, useEffect, useReducer } from 'react'

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
