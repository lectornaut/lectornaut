import { toast } from "vue-sonner"

export interface KeychainAccount {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  sessionData: Record<string, unknown>
  lastActive: number
}

const STORAGE_KEY = "lectornaut-keychain"

/** Default max age for keychain accounts: 30 days */
export const DEFAULT_KEYCHAIN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

const keychain = useStorage<KeychainAccount[]>(STORAGE_KEY, [])

/**
 * Manage multiple user accounts in local storage.
 */
export function useKeychain() {
  const accountCount = computed(() => keychain.value.length)
  const hasAccounts = computed(() => keychain.value.length > 0)

  /**
   * Add or update an account. Silent by default.
   * Pass `{ showToast: true }` to show "Account added" toast.
   */
  const addAccount = (
    account: Omit<KeychainAccount, "lastActive">,
    options?: { showToast?: boolean }
  ) => {
    if (!account.uid) {
      console.error("Cannot add account without uid")
      return
    }
    const isUpdate = keychain.value.some((a) => a.uid === account.uid)
    const filtered = keychain.value.filter((a) => a.uid !== account.uid)
    keychain.value = [...filtered, { ...account, lastActive: Date.now() }]
    if (options?.showToast && !isUpdate) {
      toast.success("Account added")
    }
  }

  /** Remove account by UID. Returns true if removed. */
  const removeAccount = (uid: string) => {
    const initialLength = keychain.value.length
    keychain.value = keychain.value.filter((a) => a.uid !== uid)
    const removed = keychain.value.length < initialLength
    if (removed) toast.success("Account removed")
    return removed
  }

  /** Remove accounts inactive longer than `maxAgeMs` */
  const pruneExpiredAccounts = (maxAgeMs: number) => {
    const now = Date.now()
    keychain.value = keychain.value.filter(
      (a) => now - a.lastActive <= maxAgeMs
    )
  }

  /** Get account by UID */
  const getAccount = (uid: string) => keychain.value.find((a) => a.uid === uid)

  /** Check if account exists */
  const hasAccount = (uid: string) => keychain.value.some((a) => a.uid === uid)

  /** Clear all accounts */
  const clearAll = () => {
    keychain.value = []
  }

  /** Update session data for an account. Returns true if found and updated. */
  const updateSessionData = (
    uid: string,
    sessionData: Record<string, unknown>
  ) => {
    const account = getAccount(uid)
    if (!account) return false
    addAccount({ ...account, sessionData })
    return true
  }

  return {
    accounts: keychain,
    accountCount,
    hasAccounts,
    addAccount,
    removeAccount,
    pruneExpiredAccounts,
    getAccount,
    hasAccount,
    clearAll,
    updateSessionData,
  }
}
