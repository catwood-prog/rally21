import { Redirect } from 'expo-router';

// N1 (7 July): "your blueprint" was renamed "your private map" — this
// route is now just a safety net for anyone mid-session on the old URL
// (a stale bookmark, a link still in flight). Every internal navigation
// call site points at /private-map directly.
export default function BlueprintRedirect() {
  return <Redirect href="/private-map" />;
}
