import React, { useEffect } from 'react'
import { useStore } from './lib/store'
import { useHashRoute } from './lib/useHashRoute'
import { HomeScreen } from './components/HomeScreen'
import { GroupScreen } from './components/GroupScreen'
import { JoinScreen } from './components/JoinScreen'
import { Onboarding } from './components/Onboarding'
import { IconAlert, IconCheck, IconClose } from './components/Icons'

export default function App() {
  const { identity, activeGroupId, openGroup, closeGroup, error, notice, dismiss, busy } = useStore()
  const { route, navigate } = useHashRoute()

  useEffect(() => {
    if (route.name === 'group') {
      if (activeGroupId !== route.groupId) void openGroup(route.groupId)
      return
    }
    if (activeGroupId) closeGroup()
  }, [route, activeGroupId, openGroup, closeGroup])

  useEffect(() => {
    if (!error && !notice) return
    const timer = window.setTimeout(() => dismiss(), 7000)
    return () => window.clearTimeout(timer)
  }, [error, notice, dismiss])

  let screen: React.ReactNode
  if (route.name === 'join') {
    screen = (
      <JoinScreen
        code={route.code}
        onJoined={(groupId) => navigate({ name: 'group', groupId })}
        onHome={() => navigate({ name: 'home' })}
        onEditIdentity={() => navigate({ name: 'home' })}
      />
    )
  } else if (!identity) {
    screen = <Onboarding onDone={() => undefined} />
  } else if (route.name === 'group') {
    screen = <GroupScreen groupId={route.groupId} onBack={() => navigate({ name: 'home' })} />
  } else {
    screen = <HomeScreen onOpenGroup={(id) => navigate({ name: 'group', groupId: id })} />
  }

  return (
    <div className="app">
      {screen}

      {busy && <div className="sync-bar" aria-hidden />}

      {(error || notice) && (
        <div className={`toast ${error ? 'toast--error' : 'toast--ok'}`} role="status">
          <span className="toast__icon" aria-hidden>
            {error ? <IconAlert size={16} /> : <IconCheck size={16} />}
          </span>
          <span className="toast__text">{error ?? notice}</span>
          <button className="icon-btn icon-btn--small" onClick={dismiss} aria-label="Dismiss">
            <IconClose size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
