import React, { useMemo, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, isDark, radius, spacing } from '../theme'
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

export interface MapHere {
  lat: number
  lng: number
}

const TILE = 256
const MAX_ZOOM = 16
const MIN_ZOOM = 3
/** India, so the map always has a sensible view even with no permission. */
const HOME: MapHere = { lat: 21.1458, lng: 79.0882 }

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
 * only needs to show "where the money went". This renders CARTO raster tiles
 * (OpenStreetMap data, no key) and positions pins in world pixel space, so the
 * map works in any prebuild with no native module at all.
 *
 * The map is always visible: with no pins it centres on the phone's location
 * (or India), so "tag a place" never leaves the user staring at an empty card.
 */
export function TripMap({
  points,
  here,
  focusHere,
  height = 280,
  onPickPoint,
  emptyHint = 'No stops pinned yet — tag an expense and its pin lands here.',
}: {
  points: MapPoint[]
  here?: MapHere | null
  focusHere?: boolean
  height?: number
  onPickPoint?: (id: string) => void
  emptyHint?: string
}) {
  const [size, setSize] = useState({ width: 0, height })
  const [zoomStep, setZoomStep] = useState(0)

  const layout = useMemo(() => {
    if (size.width <= 0) return null
    const usableWidth = size.width
    const usableHeight = size.height

    const pins = points.filter(
      (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
    )
    const showHere = Boolean(here) && (pins.length === 0 || focusHere)
    const marks: { lat: number; lng: number }[] = pins.map((point) => ({
      lat: point.lat,
      lng: point.lng,
    }))
    if (showHere && here) marks.push(here)

    if (marks.length === 0) marks.push(HOME)

    let minLat = Math.min(...marks.map((point) => point.lat))
    let maxLat = Math.max(...marks.map((point) => point.lat))
    let minLng = Math.min(...marks.map((point) => point.lng))
    let maxLng = Math.max(...marks.map((point) => point.lng))

    // A single stop needs a readable neighbourhood, not a country.
    if (Math.abs(maxLat - minLat) < 0.0008 && Math.abs(maxLng - minLng) < 0.0008) {
      const pad = marks.length === 1 && marks[0] === HOME ? 6 : 0.004
      minLat -= pad
      maxLat += pad
      minLng -= pad
      maxLng += pad
    }

    let fit = MAX_ZOOM
    for (; fit > MIN_ZOOM; fit -= 1) {
      const w = Math.abs(lonToX(maxLng, fit) - lonToX(minLng, fit))
      const h = Math.abs(latToY(minLat, fit) - latToY(maxLat, fit))
      if (w <= usableWidth * 0.78 && h <= usableHeight * 0.7) break
    }

    const zoom = clamp(fit + zoomStep, MIN_ZOOM, 17)
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
    const style = isDark ? 'dark_all' : 'light_all'

    const tiles: { key: string; uri: string; x: number; y: number }[] = []
    for (let x = firstX; x <= lastX; x += 1) {
      for (let y = firstY; y <= lastY; y += 1) {
        if (y < 0 || y > max) continue
        const wrapped = ((x % (max + 1)) + (max + 1)) % (max + 1)
        tiles.push({
          key: `${zoom}-${x}-${y}`,
          uri: `https://basemaps.cartocdn.com/${style}/${zoom}/${wrapped}/${y}@2x.png`,
          x: x * TILE - left,
          y: y * TILE - top,
        })
      }
    }

    return {
      tiles,
      zoom,
      herePin: here
        ? { x: lonToX(here.lng, zoom) - left, y: latToY(here.lat, zoom) - top }
        : null,
      pins: pins.map((point) => ({
        ...point,
        x: lonToX(point.lng, zoom) - left,
        y: latToY(point.lat, zoom) - top,
      })),
    }
  }, [focusHere, here, points, size, zoomStep])

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height: measured } = event.nativeEvent.layout
    setSize({ width, height: measured })
  }

  return (
    <View style={[styles.wrap, { height }]} onLayout={onLayout}>
      {!layout ? (
        <View style={styles.loading} />
      ) : (
        <>
          {layout.tiles.map((tile) => (
            <Image
              key={tile.key}
              source={{ uri: tile.uri }}
              style={{ position: 'absolute', left: tile.x, top: tile.y, width: TILE, height: TILE }}
              fadeDuration={120}
            />
          ))}

          <View style={styles.vignette} pointerEvents="none" />

          {layout.herePin ? (
            <View
              style={[styles.hereWrap, { left: layout.herePin.x, top: layout.herePin.y }]}
              pointerEvents="none"
            >
              <View style={styles.hereHalo} />
              <View style={styles.hereDot} />
            </View>
          ) : null}

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

          <View style={styles.zoomStack}>
            <Pressable onPress={() => setZoomStep((step) => Math.min(3, step + 1))} hitSlop={6}>
              <View style={styles.zoomButton}>
                <Ionicons name="add" size={16} color={colors.text} />
              </View>
            </Pressable>
            <Pressable onPress={() => setZoomStep((step) => Math.max(-6, step - 1))} hitSlop={6}>
              <View style={styles.zoomButton}>
                <Ionicons name="remove" size={16} color={colors.text} />
              </View>
            </Pressable>
          </View>

          {layout.pins.length === 0 ? (
            <View style={styles.hintBar} pointerEvents="none">
              <Text style={styles.hintText} numberOfLines={2}>
                {layout.herePin ? 'You are here. ' : ''}
                {emptyHint}
              </Text>
            </View>
          ) : null}

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
  loading: { flex: 1, backgroundColor: colors.bgElevated },
  vignette: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: isDark ? 'rgba(7, 19, 15, 0.2)' : 'rgba(255, 255, 255, 0.06)',
  },
  hereWrap: { position: 'absolute', alignItems: 'center', justifyContent: 'center', transform: [{ translateX: -14 }, { translateY: -14 }] },
  hereHalo: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(56, 189, 248, 0.22)',
  },
  hereDot: {
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: '#38bdf8',
    borderWidth: 3,
    borderColor: '#ffffff',
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
  pinText: { color: '#fff', fontSize: 9.5, fontWeight: '900' },
  pinLabel: {
    marginTop: 3,
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing(1.5),
    paddingVertical: 2,
    borderRadius: radius.xs,
    maxWidth: 110,
  },
  pinLabelText: { color: colors.text, fontSize: 8.5, fontWeight: '700' },
  zoomStack: { position: 'absolute', right: spacing(2.5), top: spacing(2.5), gap: spacing(1.5) },
  zoomButton: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintBar: {
    position: 'absolute',
    left: spacing(2.5),
    right: spacing(2.5),
    bottom: spacing(2.5),
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2.2),
  },
  hintText: { color: colors.textSoft, fontSize: 11.5, lineHeight: 16, fontWeight: '600' },
  attribution: {
    position: 'absolute',
    right: spacing(2.5),
    top: spacing(2.5) + 74,
    color: isDark ? 'rgba(223, 238, 231, 0.55)' : 'rgba(30, 41, 59, 0.5)',
    fontSize: 8.5,
  },
})
