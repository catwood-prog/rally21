import { useRouter } from 'expo-router';

/**
 * CR1 job 2 (10 Aug) — WHERE "+ add a circle" GOES, for every screen that
 * offers it.
 *
 * This is Today's `handleAddCircle`, lifted verbatim, because the circles
 * tab now offers the same link and the CAP BRANCH is exactly the thing that
 * must not be able to disagree between two screens: one copy saying "start
 * another" while the other opens the cap screen is a worse answer than
 * either alone. Same shape as hooks/use-checkin-launch.ts (WB1), and for
 * the same reason — the second caller is what turns a screen-local handler
 * into shared logic.
 *
 * THE CAP IS PASSED IN, NEVER FETCHED HERE. `app_caps()` is auth.uid()-aware
 * (Cat's founder allowlist gets 10 where everyone else gets 3), so a wrong
 * cap does not misrender a label — it tells someone with room to spare that
 * they are full. Both callers already fetch it inside their own `load`, and
 * a fetch in here would either duplicate that round trip or move Today's
 * read out of the batch it currently rides. `circleCount` and `circleCap`
 * are therefore the caller's, and this owns only the branch.
 *
 * `fromToday: 'true'` is carried from BOTH screens deliberately, despite the
 * name. It is not a breadcrumb — circle-setup reads it as `isDayZero =
 * !wantKey && fromToday !== 'true'`, so it is the flag that says "this
 * person already has an account and is adding another circle", which is
 * true of the circles tab too. (Its one cosmetic side effect is that the
 * setup screen's back-link reads "today"; renaming the param would touch
 * ten onboarding screens and is not this section's work.)
 */
export function useAddCircle(params: { circleCount: number; circleCap: number }): {
  handleAddCircle: () => void;
} {
  const router = useRouter();

  const handleAddCircle = () => {
    if (params.circleCount >= params.circleCap) {
      router.push({
        pathname: '/onboarding/circle-cap',
        params: { cap: String(params.circleCap) },
      });
    } else {
      router.push({ pathname: '/onboarding/circle-setup', params: { fromToday: 'true' } });
    }
  };

  return { handleAddCircle };
}
