export interface KeychainAccount {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  sessionData: Record<string, unknown>
  lastActive: number
}

const STORAGE_KEY = "lectornaut-keychain"
const keychain = useStorage<KeychainAccount[]>(STORAGE_KEY, [])

/**
 * Composable for managing multiple user accounts in local storage.
 * Provides secure storage and retrieval of account credentials.
 */
export function useKeychain() {
  /** The number of stored accounts */
  const accountCount = computed(() => keychain.value.length)

  /** Whether there are any stored accounts */
  const hasAccounts = computed(() => keychain.value.length > 0)

  /**
   * Add or update an account in the keychain.
   * If an account with the same UID exists, it will be replaced.
   */
  const addAccount = (account: Omit<KeychainAccount, "lastActive">): void => {
    if (!account.uid) {
      console.error("Cannot add account without uid")
      return
    }
    // Remove existing account with same UID to update
    const filtered = keychain.value.filter((a) => a.uid !== account.uid)
    keychain.value = [...filtered, { ...account, lastActive: Date.now() }]
  }

  /**
   * Remove an account from the keychain by UID.
   * @returns True if an account was removed, false otherwise.
   */
  const removeAccount = (uid: string): boolean => {
    const initialLength = keychain.value.length
    keychain.value = keychain.value.filter((a) => a.uid !== uid)
    return keychain.value.length < initialLength
  }

  /**
   * Prune accounts that have been inactive for longer than the specified duration.
   * @param maxAgeMs The maximum allowed inactivity duration in milliseconds.
   */
  const pruneExpiredAccounts = (maxAgeMs: number): void => {
    const now = Date.now()
    keychain.value = keychain.value.filter((account) => {
      return now - account.lastActive <= maxAgeMs
    })
  }

  /**
   * Get an account by UID.
   * @returns The account if found, undefined otherwise.
   */
  const getAccount = (uid: string): KeychainAccount | undefined => {
    return keychain.value.find((a) => a.uid === uid)
  }

  /**
   * Check if an account exists in the keychain.
   */
  const hasAccount = (uid: string): boolean => {
    return keychain.value.some((a) => a.uid === uid)
  }

  /**
   * Clear all accounts from the keychain.
   */
  const clearAll = (): void => {
    keychain.value = []
  }

  /**
   * Update session data for an existing account.
   * @returns True if the account was found and updated, false otherwise.
   */
  const updateSessionData = (
    uid: string,
    sessionData: Record<string, unknown>
  ): boolean => {
    const account = getAccount(uid)
    if (!account) return false

    addAccount({ ...account, sessionData })
    return true
  }

  return {
    /** Reactive list of all stored accounts */
    accounts: keychain,
    /** Computed count of stored accounts */
    accountCount,
    /** Whether any accounts are stored */
    hasAccounts,
    /** Add or update an account */
    addAccount,
    /** Remove an account by UID */
    removeAccount,
    /** Prune expired accounts */
    pruneExpiredAccounts,
    /** Get an account by UID */
    getAccount,
    /** Check if an account exists */
    hasAccount,
    /** Clear all stored accounts */
    clearAll,
    /** Update session data for an account */
    updateSessionData,
  }
}
