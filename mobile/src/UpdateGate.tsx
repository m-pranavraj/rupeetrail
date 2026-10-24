import React, { useCallback, useEffect, useState } from 'react'
import { AppState, Linking, Modal, StyleSheet, Text, View } from 'react-native'
import { fetchRelease, type ReleaseInfo } from './api'
import { APP_VERSION_CODE, APP_VERSION_NAME, RELEASE_CHANNEL } from './config'
import { Button } from './components/ui'
import { colors, radius, spacing } from './theme'

/**
 * Checks the release manifest on launch and whenever the app returns to the
 * foreground. A newer build is never installed silently — Android requires the
 * user to approve the package install, so this screen just gets them there.
 */
export function UpdateGate() {
  const [release, setRelease] = useState<ReleaseInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const check = useCallback(async () => {
    try {
      const response = await fetchRelease('android', RELEASE_CHANNEL, APP_VERSION_CODE)
      setRelease(response.latest && response.latest.versionCode > APP_VERSION_CODE ? response.latest : null)
    } catch {
      // A release check must never get in the way of using the ledger.
    }
  }, [])

  useEffect(() => {
    void check()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check()
    })
    return () => sub.remove()
  }, [check])

  if (!release) return null

  const mandatory = release.mandatory || APP_VERSION_CODE < release.minSupportedCode

  return (
    <Modal visible={!dismissed || mandatory} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.badge}>Update available</Text>
          <Text style={styles.title}>
            {release.versionName} is ready
          </Text>
          <Text style={styles.body}>
            You are on {APP_VERSION_NAME} ({APP_VERSION_CODE}).{'\n'}
            {release.sizeBytes ? `${Math.round(release.sizeBytes / (1024 * 1024))} MB · ` : ''}
            {mandatory ? 'This update is required to keep using RupeeTrail.' : 'Update when convenient.'}
          </Text>
          {release.notes ? <Text style={styles.notes}>{release.notes.trim()}</Text> : null}

          <Button
            label="Download update"
            onPress={() => {
              void Linking.openURL(release.apkUrl)
            }}
          />
          {!mandatory && (
            <Button label="Later" variant="ghost" onPress={() => setDismissed(true)} />
          )}
          <Text style={styles.hint}>
            Android will ask you to allow installs from this app the first time. Your data stays on the
            server, so nothing is lost during the update.
          </Text>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: spacing(6),
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(5),
  },
  badge: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: spacing(2) },
  body: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: spacing(2) },
  notes: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing(3),
    padding: spacing(3),
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
  },
  hint: { color: '#5f7a6d', fontSize: 12, lineHeight: 17, marginTop: spacing(3) },
})
