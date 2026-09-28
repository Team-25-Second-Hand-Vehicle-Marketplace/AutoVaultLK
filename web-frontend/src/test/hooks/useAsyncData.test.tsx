import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useAsyncData } from '../../hooks/useAsyncData'

describe('useAsyncData', () => {
  it('starts loading and resolves to the fetched data', async () => {
    const fetcher = vi.fn().mockResolvedValue('hello')
    const toMessage = vi.fn()

    const { result } = renderHook(() => useAsyncData(fetcher, toMessage))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.data).toBe('hello'))
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('formats a rejection through toMessage', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'))
    const toMessage = vi.fn().mockReturnValue('Could not load.')

    const { result } = renderHook(() => useAsyncData(fetcher, toMessage))

    await waitFor(() => expect(result.current.error).toBe('Could not load.'))
    expect(toMessage).toHaveBeenCalledWith(new Error('boom'))
  })

  it('reload() re-invokes the fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue('v1')
    const { result } = renderHook(() => useAsyncData(fetcher, vi.fn()))

    await waitFor(() => expect(result.current.data).toBe('v1'))
    expect(fetcher).toHaveBeenCalledTimes(1)

    fetcher.mockResolvedValue('v2')
    act(() => result.current.reload())

    await waitFor(() => expect(result.current.data).toBe('v2'))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  // Regression test for a real production bug: KnownValuesReference.tsx
  // passed `(err) => toErrorMessage(err, '...')` inline instead of a
  // module-level function, so `toMessage` was a new reference every render.
  // Before the fix, the effect depended on `toMessage`, so a new reference
  // re-ran the fetch, whose resulting dispatch triggered the re-render that
  // produced the *next* new reference — an infinite request loop with no
  // error, which took down a live page with ERR_INSUFFICIENT_RESOURCES from
  // hammering the network. A stable `fetcher` must not be re-invoked just
  // because the caller's `toMessage` closure is a fresh function every time.
  it('does not re-fetch when the caller passes a new toMessage function every render', async () => {
    const fetcher = vi.fn().mockResolvedValue('data')

    const { result, rerender } = renderHook(
      ({ n }: { n: number }) =>
        // A fresh arrow function every render — the exact shape of the bug.
        useAsyncData(fetcher, (err) => `error ${n}: ${String(err)}`),
      { initialProps: { n: 0 } },
    )

    await waitFor(() => expect(result.current.data).toBe('data'))
    expect(fetcher).toHaveBeenCalledTimes(1)

    // Several re-renders, each with a brand-new toMessage closure.
    rerender({ n: 1 })
    rerender({ n: 2 })
    rerender({ n: 3 })

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('still uses the latest toMessage after a re-render, despite not being an effect dependency', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'))

    const { result, rerender } = renderHook(
      ({ n }: { n: number }) => useAsyncData(fetcher, (err) => `n=${n}: ${String(err)}`),
      { initialProps: { n: 1 } },
    )

    rerender({ n: 2 })
    await waitFor(() => expect(result.current.error).toContain('n=2'))
  })
})
