import React from 'react'
import { View } from 'react-native'

export function AdBanner() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BannerAd, BannerAdSize } = require('react-native-google-mobile-ads')
    return (
      <View style={{ alignItems: 'center', marginTop: 8 }}>
        <BannerAd
          unitId="ca-app-pub-3030299487532175/6437698565"
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        />
      </View>
    )
  } catch {
    return null
  }
}