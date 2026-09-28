import { useEffect, useRef } from 'react'

/**
 * The ID-token flow: Google Identity Services hands this button a signed
 * credential directly, no redirect URI and no server-side round trip to
 * Google's authorization endpoint. The parent posts that credential to
 * POST /auth/google, which verifies it and issues this app's own JWT.
 */

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
          }) => void
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
        }
      }
    }
  }
}

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
let scriptLoadPromise: Promise<void> | null = null

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()

  scriptLoadPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load Google Sign-In'))
    document.head.appendChild(script)
  })

  return scriptLoadPromise
}

export function GoogleSignInButton({
  onCredential,
  onError,
}: {
  onCredential: (idToken: string) => void
  onError?: (message: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

  // Refs, not dependencies: a caller passing `(token) => login(token)` inline
  // gets a new function identity every render, and the load-and-render effect
  // below must not re-run because of that — the exact bug class useAsyncData
  // was hardened against (see its own comment). This keeps the callbacks
  // fresh without the effect depending on them.
  const onCredentialRef = useRef(onCredential)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onCredentialRef.current = onCredential
    onErrorRef.current = onError
  })

  useEffect(() => {
    if (!clientId) return
    let cancelled = false

    loadGoogleScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => onCredentialRef.current(response.credential),
        })
        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          width: 320,
        })
      })
      .catch((err: unknown) => {
        onErrorRef.current?.(
          err instanceof Error ? err.message : 'Could not load Google Sign-In',
        )
      })

    return () => {
      cancelled = true
    }
  }, [clientId])

  // No client ID configured (e.g. a local dev checkout without one set) —
  // omit the button entirely rather than rendering something that can never
  // work.
  if (!clientId) return null

  return <div ref={containerRef} />
}
