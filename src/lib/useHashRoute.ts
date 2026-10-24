import { useCallback, useEffect, useState } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'group'; groupId: string }
  | { name: 'join'; code: string }

function parse(hash: string): Route {
  const join = hash.match(/^#\/join\/([A-Za-z0-9]{3,12})/)
  if (join) return { name: 'join', code: join[1].toUpperCase() }
  const group = hash.match(/^#\/g\/([\w-]+)/)
  if (group) return { name: 'group', groupId: group[1] }
  return { name: 'home' }
}

export function inviteUrl(code: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#/join/${code}`
}

export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash))

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((next: Route) => {
    const hash =
      next.name === 'home'
        ? '#/'
        : next.name === 'group'
          ? `#/g/${next.groupId}`
          : `#/join/${next.code}`
    if (window.location.hash === hash) {
      setRoute(next)
    } else {
      window.location.hash = hash
    }
    window.scrollTo({ top: 0 })
  }, [])

  return { route, navigate }
}
