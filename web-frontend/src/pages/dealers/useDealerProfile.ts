import { useContext } from 'react'
import { DealerProfileContext } from './dealer-profile-context'

export function useDealerProfile() {
  const value = useContext(DealerProfileContext)
  if (!value) {
    throw new Error('useDealerProfile must be used inside the dealer area (DealerLayout).')
  }
  return value
}
