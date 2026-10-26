/**
 * Speech to text, on the phone.
 *
 * Android's own recogniser (SpeechRecognizer, via expo-speech-recognition)
 * listens, shows interim words while you talk, and hands back the final
 * transcript. Nothing is recorded to a file and nothing is uploaded by us —
 * recognition happens in the system service.
 *
 * The hook owns the lifecycle so screens stay simple: `start()` requests the
 * microphone, `stop()` asks for the final transcript, and every failure is
 * turned into a sentence that tells the person what to do next.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorCode,
} from 'expo-speech-recognition'

export type DictationStatus = 'idle' | 'starting' | 'listening'

function explain(error: ExpoSpeechRecognitionErrorCode | string): string {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked. Allow it for RupeeSplit in Android settings, then try again.'
    case 'no-speech':
      return 'I didn’t catch anything. Try again a little closer to the mic.'
    case 'audio-capture':
      return 'The microphone is busy — another app may be using it. Close it and try again.'
    case 'network':
      return 'Speech needs a short network hop for this language. Check your connection, or type it instead.'
    case 'language-not-supported':
      return 'Your phone doesn’t have speech recognition for this language installed. Type it instead.'
    case 'busy':
      return 'The recogniser is still finishing the last attempt. Wait a second and try again.'
    case 'interrupted':
      return 'Something interrupted the microphone. Try again.'
    default:
      return 'Could not listen just now. Try again, or type the expense instead.'
  }
}

export function useDictation({
  onResult,
  lang = 'en-IN',
}: {
  onResult: (text: string) => void
  lang?: string
}) {
  const [status, setStatus] = useState<DictationStatus>('idle')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')

  // Keep the latest callback without re-subscribing to native events.
  const handler = useRef(onResult)
  useEffect(() => {
    handler.current = onResult
  }, [onResult])

  useSpeechRecognitionEvent('start', () => {
    setStatus('listening')
    setError('')
  })

  useSpeechRecognitionEvent('end', () => {
    setStatus('idle')
    setInterim('')
  })

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results?.[0]?.transcript?.trim() ?? ''
    if (!transcript) return
    if (event.isFinal) {
      setInterim('')
      handler.current(transcript)
    } else {
      setInterim(transcript)
    }
  })

  useSpeechRecognitionEvent('error', (event) => {
    setStatus('idle')
    setInterim('')
    if (event.error === 'aborted') return
    setError(explain(event.error))
  })

  const start = useCallback(async () => {
    setError('')
    setInterim('')
    setStatus('starting')
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
      if (!permission.granted) {
        setStatus('idle')
        setError(
          'Microphone access is needed to dictate an expense. You can grant it, or just type it below.',
        )
        return
      }
      ExpoSpeechRecognitionModule.start({
        lang,
        interimResults: true,
        continuous: false,
        // Android ends the utterance on its own; the button only stops early.
        requiresOnDeviceRecognition: false,
        addsPunctuation: false,
      })
    } catch {
      setStatus('idle')
      setError('Speech recognition is unavailable on this build — type the expense instead.')
    }
  }, [lang])

  const stop = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop()
    } catch {
      setStatus('idle')
    }
  }, [])

  return {
    status,
    listening: status === 'listening',
    busy: status === 'starting',
    interim,
    error,
    start,
    stop,
    clearError: () => setError(''),
  }
}
