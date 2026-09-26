import { createContext } from 'react'
import type { DealerProfile } from '../../api/dealer.types'
import type { AsyncData } from '../../hooks/useAsyncData'

/** The signed-in dealer's profile, loaded once by DealerLayout for the whole dealer area. */
export const DealerProfileContext = createContext<AsyncData<DealerProfile> | null>(null)
