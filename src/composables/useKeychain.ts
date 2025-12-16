import { useStorage } from "@vueuse/core"

export interface KeychainAccount {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  token: string // kept for compatibility, or we can repurpose/remove. Let's keep it optional or just string.
  sessionData: unknown
}

const keychain = useStorage<KeychainAccount[]>("lectornaut-keychain", [])

export const useKeychain = () => {
  const addAccount = (account: KeychainAccount) => {
    // Remove if exists to update
    removeAccount(account.uid)
    keychain.value.push(account)
  }

  const removeAccount = (uid: string) => {
    keychain.value = keychain.value.filter((a) => a.uid !== uid)
  }

  const getAccount = (uid: string) => {
    return keychain.value.find((a) => a.uid === uid)
  }

  return {
    accounts: keychain,
    addAccount,
    removeAccount,
    getAccount,
  }
}
