import { ScrollViewStyleReset } from 'expo-router/html';

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

        <link rel="manifest" href="/manifest.json" />

        {/* iOS "Add to Home Screen" standalone mode */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Rally21" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
