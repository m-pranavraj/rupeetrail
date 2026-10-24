import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AuthMembership, AuthUser } from './api'

const SESSION_KEY = 'rupeetrail.session.v1'

export interface StoredSession {
  token: string
  user: AuthUser
  memberships: AuthMembership[]
}

export async function readSession(): Promise<StoredSession | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSession
    if (!parsed?.token || !parsed?.user) return null
    return { ...parsed, memberships: parsed.memberships ?? [] }
  } catch {
    return null
  }
}

export async function writeSession(session: StoredSession | null): Promise<void> {
  try {
    if (session) await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else await AsyncStorage.removeItem(SESSION_KEY)
  } catch {
    // A storage failure only costs the user a re-login; never crash over it.
  }
}
