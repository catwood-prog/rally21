import { ScrollViewStyleReset } from 'expo-router/html';

import { APP_LINK, SHARE_TAGLINE } from '@/constants/sharing';

// Customizes the root HTML shell for the static web export. The app is
// meant to be added to the home screen and run standalone (no browser
// chrome) — that only happens if the manifest and apple-mobile-web-app
// meta tags are present, which Expo's default export doesn't add on its
// own.
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#F2F1EC" />

        {/* SC1 (13 July, spec §6) — so a shared card's link unfurls as a
            tappable preview in Messages/WhatsApp. Same tokenized tagline
            + link the share payload itself carries; og:image reuses the
            existing apple-touch-icon asset rather than adding a new one. */}
        <meta property="og:title" content={SHARE_TAGLINE} />
        <meta property="og:description" content="Show up on a new habit, together with people who matter to you." />
        <meta property="og:image" content={`${APP_LINK}/apple-touch-icon.png`} />
        <meta property="og:url" content={APP_LINK} />
        <meta name="twitter:card" content="summary_large_image" />

        <link rel="manifest" href="/manifest.json" />

        {/* iOS "Add to Home Screen" standalone mode */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Rally21" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        <ScrollViewStyleReset />

        {/* iOS Safari's 100vh includes the area behind the address bar,
            cutting off the bottom of the screen (and the tab bar under it).
            100dvh tracks the real visible viewport; 100% (set above by
            ScrollViewStyleReset) is the fallback for browsers without it. */}
        <style id="dynamic-viewport-height">{`
          html, body, #root { height: 100dvh; }
        `}</style>

        {/* The app is phone-designed and stretches edge-to-edge on desktop
            otherwise, breaking every layout built for a ~390px screen.
            Capping #root and centering it has no effect below 480px (a
            phone viewport is already narrower), so this needs no media
            query — it only ever engages once there's spare width. */}
        <style id="desktop-width-constraint">{`
          body { background: #F2F1EC; }
          #root { max-width: 480px; margin: 0 auto; }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
