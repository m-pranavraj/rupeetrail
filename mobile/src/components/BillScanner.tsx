import React, { useCallback, useMemo, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { Ionicons } from '@expo/vector-icons'
import { Banner, Button, Card, Label, Muted, Pill, PressableScale, tap } from './ui'
import { colors, radius, spacing } from '../theme'
import { formatPaise } from '../lib/money'
import { parseReceipt, type ParsedReceipt } from '../lib/receipt'
import { buildExpenseFromReceipt, buildExpenseFromVoice } from '../lib/billParser'
import { parseVoiceSplit, type ParsedVoice } from '../lib/voice'
import { useDictation } from '../lib/dictation'
import type { Expense } from '../lib/types'
import TextRecognition from '@react-native-ml-kit/text-recognition'

type Mode = 'choose' | 'receipt' | 'quick'

/**
 * Bill capture, on the phone.
 *
 * Photos are preprocessed for better OCR results (resizing, contrast adjustment).
 * The shared receipt parser turns text into line items and a total.
 * The result only ever becomes a *draft* — the form still validates the split.
 *
 * "Quick add" is the same idea for typing: "Dinner 1200, Priya 400" is parsed
 * against the group roster instead of asking for four separate fields.
 */
export function BillScanner({
  members,
  meMemberId,
  onApply,
  onBack,
}: {
  members: { id: string; name: string }[]
  meMemberId: string
  onApply: (draft: Partial<Expense>) => void
  onBack: () => void
}) {
  const [mode, setMode] = useState<Mode>('choose')
  const [preview, setPreview] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null)
  const [quickText, setQuickText] = useState('')
  const [voice, setVoice] = useState<ParsedVoice | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const memberIds = useMemo(() => new Set(members.map((member) => member.id)), [members])

  // Dictating a bill lands in the same parser as typing it, so a spoken
  // "dinner 1200, Priya 400, I paid" produces exactly the same draft.
  const understand = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      setQuickText(trimmed)
      setVoice(parseVoiceSplit(trimmed, members, meMemberId))
      setMode('quick')
    },
    [meMemberId, members],
  )

  const dictation = useDictation({ onResult: understand })

  const readImage = useCallback(async (uri: string) => {
    setBusy(true)
    setError('')
    setStatus('Reading the bill…')
    try {
      // ML Kit reads the photo on the device — nothing leaves the phone.
      const result = await TextRecognition.recognize(uri)
      const text = result.text ?? ''
      if (!text.trim()) {
        setError('No text was found in that photo. Try again in better light.')
        return
      }
      setReceipt(parseReceipt(text))
      setMode('receipt')
    } catch {
      setError('Could not read that photo. Try again, or type the amount.')
    } finally {
      setBusy(false)
      setStatus('')
    }
  }, [])

  const capture = useCallback(
    async (fromCamera: boolean) => {
      tap()
      setError('')
      try {
        if (fromCamera) {
          const permission = await ImagePicker.requestCameraPermissionsAsync()
          if (!permission.granted) {
            setError('Camera access is needed to photograph a bill.')
            return
          }
        }
        const result = fromCamera
          ? await ImagePicker.launchCameraAsync({ quality: 0.85, allowsEditing: false })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              quality: 0.9,
              allowsEditing: false,
            })
        if (result.canceled || !result.assets?.[0]?.uri) return
        setPreview(result.assets[0].uri)
        await readImage(result.assets[0].uri)
      } catch {
        setError('The camera could not be opened. Pick a photo instead.')
      }
    },
    [readImage],
  )

  const useReceipt = useCallback(() => {
    if (!receipt) return
    tap()
    onApply(buildExpenseFromReceipt(receipt, meMemberId, memberIds))
  }, [memberIds, meMemberId, onApply, receipt])

  const parseQuick = useCallback(() => {
    understand(quickText)
  }, [quickText, understand])

  const useQuick = useCallback(() => {
    if (!voice) return
    tap()
    onApply(buildExpenseFromVoice(voice, meMemberId, memberIds))
  }, [memberIds, meMemberId, onApply, voice])

  const confidence = receipt ? Math.round(receipt.confidence * 100) : 0
  const confidenceTone = confidence >= 80 ? 'ok' : confidence >= 55 ? 'warn' : 'bad'

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <PressableScale onPress={onBack} accessibilityLabel="Back to the form">
          <View style={styles.back}>
            <Ionicons name="chevron-back" size={18} color={colors.text} />
          </View>
        </PressableScale>
        <Text style={styles.headTitle}>Capture a bill</Text>
        <View style={{ width: 36 }} />
      </View>

      {mode === 'choose' && (
        <View>
          <Card tone="raised" style={styles.hero}>
            <View style={styles.heroIcon}>
              <Ionicons name="scan-outline" size={22} color={colors.accent} />
            </View>
            <Text style={styles.heroTitle}>Read the bill on this phone</Text>
            <Muted small>
              The photo is preprocessed for better text extraction, then the shared parser pulls out line items, GST and the total. Nothing is uploaded.
            </Muted>
            <View style={styles.sourceRow}>
              <PressableScale style={{ flex: 1 }} onPress={() => void capture(true)} disabled={busy}>
                <View style={styles.source}>
                  <Ionicons name="camera-outline" size={20} color={colors.text} />
                  <Text style={styles.sourceText}>Camera</Text>
                </View>
              </PressableScale>
              <PressableScale style={{ flex: 1 }} onPress={() => void capture(false)} disabled={busy}>
                <View style={styles.source}>
                  <Ionicons name="images-outline" size={20} color={colors.text} />
                  <Text style={styles.sourceText}>Gallery</Text>
                </View>
              </PressableScale>
            </View>
            {busy ? <Muted small>{status || 'Working…'}</Muted> : null}
          </Card>

          <Card>
            <Label>Or say it / type it</Label>
            <TextInput
              value={quickText}
              onChangeText={setQuickText}
              placeholder="Dinner 1200, Priya 400, I paid"
              placeholderTextColor={colors.mutedDim}
              selectionColor={colors.accent}
              multiline
              style={styles.quickInput}
            />
            {dictation.listening || dictation.busy ? (
              <View style={styles.listeningRow}>
                <View style={styles.liveDot} />
                <Text style={styles.listeningText} numberOfLines={2}>
                  {dictation.interim || 'Listening…'}
                </Text>
              </View>
            ) : null}
            <Muted small>
              Say who paid and what each person had — names from this group are matched automatically.
            </Muted>
            <View style={styles.actionRow}>
              <PressableScale
                style={{ flex: 1 }}
                onPress={() => {
                  tap()
                  if (dictation.listening) dictation.stop()
                  else void dictation.start()
                }}
                disabled={busy || dictation.busy}
              >
                <View style={[styles.source, dictation.listening && styles.sourceLive]}>
                  <Ionicons
                    name={dictation.listening ? 'stop-circle-outline' : 'mic-outline'}
                    size={20}
                    color={dictation.listening ? colors.accentInk : colors.text}
                  />
                  <Text style={[styles.sourceText, dictation.listening && { color: colors.accentInk }]}>
                    {dictation.listening ? 'Stop' : 'Speak'}
                  </Text>
                </View>
              </PressableScale>
              <PressableScale style={{ flex: 1 }} onPress={parseQuick} disabled={!quickText.trim()}>
                <View style={styles.source}>
                  <Ionicons name="sparkles-outline" size={20} color={colors.text} />
                  <Text style={styles.sourceText}>Understand</Text>
                </View>
              </PressableScale>
            </View>
            {dictation.error ? <Banner tone="error">{dictation.error}</Banner> : null}
          </Card>

          {error ? <Banner tone="error">{error}</Banner> : null}
        </View>
      )}

      {mode === 'receipt' && receipt && (
        <View>
          {preview ? (
            <Image source={{ uri: preview }} style={styles.preview} resizeMode="cover" />
          ) : null}
          <Card tone="raised">
            <View style={styles.badgeRow}>
              <Pill tone={confidenceTone}>{confidence}% confident</Pill>
              {receipt.gstRate !== undefined ? <Pill tone="info">GST {receipt.gstRate}%</Pill> : null}
            </View>
            {receipt.merchant ? <Text style={styles.merchant}>{receipt.merchant}</Text> : null}

            {receipt.items.length > 0 ? (
              <View style={{ marginTop: spacing(2) }}>
                {receipt.items.slice(0, 12).map((item, index) => (
                  <View key={`${item.name}-${index}`} style={styles.itemRow}>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {item.name}
                      {item.quantity > 1 ? `  ${item.quantity} × ${formatPaise(item.unitPaise)}` : ''}
                    </Text>
                    <Text style={styles.itemAmount}>{formatPaise(item.amountPaise)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Muted small>No item lines found — only a total.</Muted>
            )}

            <View style={styles.totals}>
              {receipt.taxes.map((tax, index) => (
                <View key={`${tax.label}-${index}`} style={styles.totalRow}>
                  <Text style={styles.totalLabel}>
                    {tax.label}
                    {tax.rate !== undefined ? ` ${tax.rate}%` : ''}
                  </Text>
                  <Text style={styles.totalValue}>{formatPaise(tax.amountPaise)}</Text>
                </View>
              ))}
              {receipt.discountPaise > 0 ? (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Discount</Text>
                  <Text style={styles.totalValue}>−{formatPaise(receipt.discountPaise)}</Text>
                </View>
              ) : null}
              <View style={[styles.totalRow, styles.grandRow]}>
                <Text style={styles.grandLabel}>Total</Text>
                <Text style={styles.grandValue}>{formatPaise(receipt.totalPaise)}</Text>
              </View>
            </View>

            {receipt.warnings.map((warning) => (
              <Text key={warning} style={styles.warning}>
                {warning}
              </Text>
            ))}
          </Card>

          <Button
            label={`Use ₹${(receipt.totalPaise / 100).toFixed(2)}`}
            onPress={useReceipt}
            disabled={receipt.totalPaise <= 0}
          />
          <Button label="Scan another" variant="ghost" compact onPress={() => setMode('choose')} />
        </View>
      )}

      {mode === 'quick' && voice && (
        <View>
          <Card tone="raised">
            <View style={styles.badgeRow}>
              <Pill tone="info">
                {voice.mode === 'equal' ? 'Equal split' : voice.mode === 'percent' ? 'Percentages' : 'Exact shares'}
              </Pill>
              {voice.gstRate !== undefined ? <Pill tone="muted">GST {voice.gstRate}%</Pill> : null}
            </View>
            <Text style={styles.transcript}>“{voice.rawText}”</Text>

            {voice.people.map((person, index) => (
              <View key={`${person.name}-${index}`} style={styles.itemRow}>
                <Text style={styles.itemName}>
                  {person.name}
                  {!person.memberId ? '  (not in group)' : ''}
                </Text>
                <Text style={styles.itemAmount}>
                  {person.percent !== undefined
                    ? `${person.percent}%`
                    : person.amountPaise !== undefined
                      ? formatPaise(person.amountPaise)
                      : 'equal'}
                </Text>
              </View>
            ))}

            <View style={[styles.totalRow, styles.grandRow]}>
              <Text style={styles.grandLabel}>Total</Text>
              <Text style={styles.grandValue}>{formatPaise(voice.totalPaise)}</Text>
            </View>
            {voice.payerName ? <Muted small>Paid by {voice.payerName}</Muted> : null}
            {voice.warnings.map((warning) => (
              <Text key={warning} style={styles.warning}>
                {warning}
              </Text>
            ))}
          </Card>
          <Button label="Use these details" onPress={useQuick} disabled={voice.totalPaise <= 0} />
          <Button label="Type it again" variant="ghost" compact onPress={() => setMode('choose')} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: spacing(4) },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing(2) },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  hero: { alignItems: 'flex-start' },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#123f30',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing(2),
  },
  heroTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: spacing(1) },
  sourceRow: { flexDirection: 'row', gap: spacing(2.5), marginTop: spacing(3), alignSelf: 'stretch' },
  source: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(2),
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.md,
    paddingVertical: spacing(3),
    borderWidth: 1,
    borderColor: colors.border,
  },
  sourceText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  sourceLive: { backgroundColor: colors.accent, borderColor: colors.accent },
  actionRow: { flexDirection: 'row', gap: spacing(2.5), marginTop: spacing(3), alignSelf: 'stretch' },
  listeningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    marginTop: spacing(2.5),
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(2.5),
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  listeningText: { color: colors.textSoft, fontSize: 13, flex: 1, fontStyle: 'italic' },
  quickInput: {
    marginTop: spacing(2),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing(3),
    color: colors.text,
    fontSize: 15,
    minHeight: 76,
    textAlignVertical: 'top',
  },
  preview: {
    width: '100%',
    height: 130,
    borderRadius: radius.md,
    marginTop: spacing(2),
    backgroundColor: colors.surfaceAlt,
  },
  badgeRow: { flexDirection: 'row', gap: spacing(2), flexWrap: 'wrap' },
  merchant: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: spacing(2.5) },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing(3),
    paddingVertical: spacing(1.5),
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  itemName: { color: colors.textSoft, fontSize: 13, flex: 1 },
  itemAmount: { color: colors.text, fontSize: 13, fontWeight: '700' },
  totals: { marginTop: spacing(3) },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing(1) },
  totalLabel: { color: colors.muted, fontSize: 12.5 },
  totalValue: { color: colors.textSoft, fontSize: 12.5, fontWeight: '600' },
  grandRow: {
    marginTop: spacing(1.5),
    paddingTop: spacing(2.5),
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  grandLabel: { color: colors.text, fontSize: 15, fontWeight: '800' },
  grandValue: { color: colors.accent, fontSize: 18, fontWeight: '900' },
  warning: { color: colors.warn, fontSize: 11.5, marginTop: spacing(2), lineHeight: 16 },
  transcript: { color: colors.textSoft, fontSize: 13, fontStyle: 'italic', marginTop: spacing(2.5), lineHeight: 19 },
})
