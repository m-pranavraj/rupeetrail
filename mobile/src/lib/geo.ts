/**
 * Device-side place tags.
 *
 * The ledger API is deliberately schema-stable, so coordinates live beside the
 * ledger on this phone rather than inside the shared document. That keeps
 * "where did the money go" working without a backend migration, and a map pin
 * never has to be uploaded.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'

export interface GeoPoint {
  lat: number
  lng: number
  /** Friendly label, usually the expense description or a reverse-geocoded area. */
  label?: string
  at: number
}

export type GeoMap = Record<string, GeoPoint>

const KEY = 'rupeesplit.geo.v1'

export async function readGeo(): Promise<GeoMap> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as GeoMap
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

export async function writeGeo(map: GeoMap): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    // Losing a pin is cosmetic; never fail an expense over it.
  }
}

export async function setGeoPoint(expenseId: string, point: GeoPoint): Promise<GeoMap> {
  const map = await readGeo()
  map[expenseId] = point
  await writeGeo(map)
  return map
}

export async function removeGeoPoints(ids: string[]): Promise<GeoMap> {
  if (ids.length === 0) return readGeo()
  const map = await readGeo()
  for (const id of ids) delete map[id]
  await writeGeo(map)
  return map
}

/** Current position, or null when permission is denied or the fix times out. */
export async function currentPoint(label?: string): Promise<GeoPoint | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync()
    if (permission.status !== 'granted') return null
    const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000 }).catch(() => null)
    const fix =
      last ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
      ]))
    if (!fix) return null
    const point: GeoPoint = {
      lat: fix.coords.latitude,
      lng: fix.coords.longitude,
      label,
      at: Date.now(),
    }
    return point
  } catch {
    return null
  }
}

/** Best-effort area name. Never blocks tagging a point. */
export async function describePoint(lat: number, lng: number): Promise<string | undefined> {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng })
    const place = results[0]
    if (!place) return undefined
    return [place.name, place.district, place.city].filter(Boolean).slice(0, 2).join(', ') || undefined
  } catch {
    return undefined
  }
}

/** Metres between two coordinates (haversine). */
export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
