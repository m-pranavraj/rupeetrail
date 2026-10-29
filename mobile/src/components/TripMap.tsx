import React, { useMemo, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import { colors, radius, spacing } from '../theme'
import { formatPaise } from '../lib/money'

export interface MapPoint {
  id: string
  lat: number
  lng: number
  label: string
  amountPaise?: number
  color?: string
  count?: number
}

const TILE = 256
const MAX_ZOOM = 16
const MIN_ZOOM = 3

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function lonToX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * 2 ** zoom * TILE
}

function latToY(lat: number, zoom: number): number {
  const clamped = clamp(lat, -85.0511, 85.0511)
  const sin = Math.sin((clamped * Math.PI) / 180)
  return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 2 ** zoom * TILE
}

/**
 * A dependency-free slippy map.
 *
 * Native map SDKs need a Google key and a Play Services binary; a trip ledger
 * only needs to show "where the money went". This renders CARTO's dark raster
 * tiles (OpenStreetMap data, no key) and positions pins in world pixel space,
 * so the map works in any prebuild with no native module at all.
 */
export function TripMap({
  points,
  height = 280,
  onPickPoint,
  emptyHint = 'Tag expenses with a place and the trip map draws itself.',
}: {
  points: MapPoint[]
  height?: number
  onPickPoint?: (id: string) => void
  emptyHint?: string
}) {
  const [size, setSize] = useState({ width: 0, height })

  const layout = useMemo(() => {
    if (size.width <= 0) return null
    const usableWidth = size.width
    const usableHeight = size.height

    const valid = points.filter(
      (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
    )
    if (valid.length === 0) return null

    let minLat = Math.min(...valid.map((p) => p.lat))
    let maxLat = Math.max(...valid.map((p) => p.lat))
    let minLng = Math.min(...valid.map((p) => p.lng))
    let maxLng = Math.max(...valid.map((p) => p.lng))

    // A single stop needs a readable neighbourhood, not a country.
    if (Math.abs(maxLat - minLat) < 0.0008 && Math.abs(maxLng - minLng) < 0.0008) {
      minLat -= 0.004
      maxLat += 0.004
      minLng -= 0.004
      maxLng += 0.004
    }

    let zoom = MAX_ZOOM
    for (; zoom > MIN_ZOOM; zoom -= 1) {
      const w = Math.abs(lonToX(maxLng, zoom) - lonToX(minLng, zoom))
      const h = Math.abs(latToY(minLat, zoom) - latToY(maxLat, zoom))
      if (w <= usableWidth * 0.78 && h <= usableHeight * 0.7) break
    }

    const centerLat = (minLat + maxLat) / 2
    const centerLng = (minLng + maxLng) / 2
    const centerX = lonToX(centerLng, zoom)
    const centerY = latToY(centerLat, zoom)
    const left = centerX - usableWidth / 2
    const top = centerY - usableHeight / 2

    const firstX = Math.floor(left / TILE)
    const lastX = Math.floor((left + usableWidth) / TILE)
    const firstY = Math.floor(top / TILE)
    const lastY = Math.floor((top + usableHeight) / TILE)
    const max = 2 ** zoom - 1

    const tiles: { key: string; uri: string; x: number; y: number }[] = []
    for (let x = firstX; x <= lastX; x += 1) {
      for (let y = firstY; y <= lastY; y += 1) {
        if (y < 0 || y > max) continue
        const wrapped = ((x % (max + 1)) + (max + 1)) % (max + 1)
        tiles.push({
          key: `${zoom}-${x}-${y}`,
          uri: `https://basemaps.cartocdn.com/dark_all/${zoom}/${wrapped}/${y}@2x.png`,
          x: x * TILE - left,
          y: y * TILE - top,
        })
      }
    }

    const pins = valid.map((point) => ({
      ...point,
      x: lonToX(point.lng, zoom) - left,
      y: latToY(point.lat, zoom) - top,
    }))

    return { tiles, pins, zoom }
  }, [points, size])

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height: measured } = event.nativeEvent.layout
    setSize({ width, height: measured })
  }

  return (
    <View style={[styles.wrap, { height }]} onLayout={onLayout}>
      {!layout ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🗺️</Text>
          <Text style={styles.emptyText}>{emptyHint}</Text>
        </View>
      ) : (
        <>
          {layout.tiles.map((tile) => (
            <Image
              key={tile.key}
              source={{ uri: tile.uri }}
              style={{ position: 'absolute', left: tile.x, top: tile.y, width: TILE, height: TILE }}
            />
          ))}

          <View style={styles.vignette} pointerEvents="none" />

          {layout.pins.map((pin) => (
            <Pressable
              key={pin.id}
              onPress={() => onPickPoint?.(pin.id)}
              style={[styles.pinWrap, { left: pin.x, top: pin.y }]}
              hitSlop={8}
            >
              <View style={[styles.pinPulse, { backgroundColor: pin.color ?? colors.accent }]} />
              <View style={[styles.pin, { backgroundColor: pin.color ?? colors.accent }]}>
                <Text style={styles.pinText} numberOfLines={1}>
                  {pin.amountPaise ? formatPaise(pin.amountPaise) : pin.label.slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View style={styles.pinLabel}>
                <Text style={styles.pinLabelText} numberOfLines={1}>
                  {pin.label}
                </Text>
              </View>
            </Pressable>
          ))}

          <View style={styles.zoomBadge}>
            <Text style={styles.zoomText}>z{layout.zoom}</Text>
          </View>
          <Text style={styles.attribution}>© OpenStreetMap · CARTO</Text>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(6) },
  emptyIcon: { fontSize: 30, opacity: 0.85 },
  emptyText: {
    color: colors.muted,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: spacing(2),
    maxWidth: 260,
  },
  vignette: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(7, 19, 15, 0.18)',
  },
  pinWrap: { position: 'absolute', alignItems: 'center', transform: [{ translateX: -2 }, { translateY: -2 }] },
  pinPulse: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    opacity: 0.18,
    top: -9,
  },
  pin: {
    paddingHorizontal: spacing(2),
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: 'rgba(7,19,15,0.7)',
    minWidth: 26,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  pinText: { color: colors.white, fontSize: 9.5, fontWeight: '900' },
  pinLabel: {
    marginTop: 3,
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing(1.5),
    paddingVertical: 2,
    borderRadius: radius.xs,
    maxWidth: 110,
  },
  pinLabelText: { color: colors.text, fontSize: 8.5, fontWeight: '700' },
  zoomBadge: {
    position: 'absolute',
    right: spacing(2.5),
    top: spacing(2.5),
    backgroundColor: 'rgba(5, 18, 13, 0.7)',
    borderRadius: radius.xs,
    paddingHorizontal: spacing(1.5),
    paddingVertical: 2,
  },
  zoomText: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  attribution: {
    position: 'absolute',
    right: spacing(2.5),
    bottom: spacing(2),
    color: 'rgba(223, 238, 231, 0.55)',
    fontSize: 8.5,
  },
})
