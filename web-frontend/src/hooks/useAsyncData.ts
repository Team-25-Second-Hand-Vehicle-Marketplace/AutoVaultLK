import { useCallback, useEffect, useReducer, useRef } from 'react'

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

  // `toMessage` is deliberately NOT an effect dependency below. A caller that
  // inlines it (`(err) => toErrorMessage(err, '...')` written directly in the
  // useAsyncData(...) call, instead of hoisted to module scope) gets a new
  // function identity every render; if the effect depended on it, that alone
  // would re-run the fetch every render, and every fetch's resulting dispatch
  // triggers exactly the re-render that creates the next new identity — an
  // infinite request loop with no error and no visible sign beyond the
  // network tab (this took down KnownValuesReference.tsx's bulk-upload
  // reference panel in production: ERR_INSUFFICIENT_RESOURCES from hammering
  // GET /search/options). The ref always reads the latest `toMessage` without
  // the effect ever needing to re-run because of it.
  const toMessageRef = useRef(toMessage)
  // Runs after render, never during it — writing to a ref while rendering is
  // not allowed (breaks under concurrent rendering / StrictMode's double
  // invocation). No dependency array: this should update after every render.
  useEffect(() => {
    toMessageRef.current = toMessage
  })

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
          dispatch({ type: 'failure', error: toMessageRef.current(err) })
        }
      },
    )

    queueMicrotask(() => {
      if (!settled && !controller.signal.aborted) dispatch({ type: 'start' })
    })

    return () => controller.abort()
  }, [fetcher, nonce])

  const reload = useCallback(() => bumpNonce(), [])

  return { ...state, reload }
}
