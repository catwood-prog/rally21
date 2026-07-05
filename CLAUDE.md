@AGENTS.md

## Product conventions

- **Practice names are always verb phrases** (e.g. "Meditate 10 minutes", "Walk 20 minutes", "Write one page"), never noun phrases (not "10 Min Meditation"). They're read directly into the Today screen's headline — "today you {practice} with your circle" — so they must read naturally there, lowercased. Applies to any practice seeded in code or created via the admin/seed path.
- **Navigation calls must always use clean paths** (e.g. `router.push('/today')`), never file-system group syntax (`'/(app)/today'`). Group-qualified paths happen to typecheck and build today, but they silently break at runtime the moment a screen moves to a different group — as happened when `today.tsx` moved into `(app)/(tabs)/`. Clean paths are stable across any folder reorganization.
- **All screens must look right at both 390px and desktop widths.** The app is phone-designed (`app/+html.tsx` caps `#root` at `max-width: 480px`, centered, with the warm bg filling the sides on wider viewports), but that only fixes overall layout width — individual screens still need to be checked at both sizes, since a phone-width design can still overflow, misalign, or look sparse once centered in a wider browser window.
- **The brandmark is a shared component** (`components/Brandmark.tsx`) — "Rally" in Bricolage Grotesque extra-bold ink, immediately followed by "21" in Instrument Serif italic gold, no space between. Every screen's header renders it via `<Brandmark />` (or `<Brandmark light />` on dark backgrounds like the timer). Never recreate it with a per-screen `Text` + style — a screen with the wordmark typed out inline instead of the component is a bug.

## Deployment / workflow conventions

- **A feature is not "shipped" until it is live.** After every push, verify that a Vercel production deployment was created and reached READY (run the deploy status check, or trigger `npx vercel --prod` if the GitHub webhook didn't fire). Never report work as deployed based on push alone.
