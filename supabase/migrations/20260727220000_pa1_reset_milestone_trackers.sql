-- PA1 — the rally is counted in practices, not calendar days.
-- Rally21-Personal-Arc-Decision-Memo.md §4 (the three clocks), §8, §9.
--
-- WHY THIS MIGRATION IS NOT OPTIONAL. No column changes shape here; what
-- changes is what the numbers in these two columns MEAN. Both are
-- monotonic "highest milestone this member has already been shown for
-- this circle" trackers, and both were written in CIRCLE DAYS. From this
-- commit the milestone ladder is read in PRACTICE COUNTS.
--
-- Left alone, every row would be a silent suppressor. On 27 July six of
-- thirteen membership rows read last_celebrated_day = 21 while their
-- owners had done 8, 7, 9, 6, 3 and 18 practices respectively — so each
-- of those six would have been marked "already celebrated milestone 21"
-- and their REAL 21st-practice ceremony would never have fired, forever,
-- with nothing anywhere to show why.
--
-- Cat's ruling (memo §8): the current cohort is NOT to be protected.
-- Every member is Cat or one thought partner, so nothing of value is
-- lost by recalculating. No grandfathering and no migration ceremony —
-- reset both trackers to 0 for EVERY membership and let the honest
-- numbers rebuild themselves from `completions`, which needs no backfill
-- because it has held one row per user per circle per local date all
-- along.
--
-- After the reset nothing re-fires today: the highest rally count in the
-- cohort is 18, and the first milestone is 21 practices, so no ceremony
-- and no quiet celebration becomes eligible for anyone as a result of
-- running this.

update public.memberships
set last_celebrated_day = 0
where last_celebrated_day <> 0;

-- last_wrapped_offer_day (SC3) is the SAME KIND of tracker with the same
-- unit change — the highest milestone whose keepsake offer this member
-- has seen — and two rows carry a circle-day 21 in it. It has no live
-- caller today (WR1 pulled the Wrapped offer out of the ceremony and
-- left getMyLastWrappedOfferDay/markWrappedOffered unreferenced), so
-- this is inert now; it is reset in the same breath so the ~100-day
-- milestone keepsake that reuses this machinery does not inherit a
-- suppressor that predates the units it will be read in.
update public.memberships
set last_wrapped_offer_day = 0
where last_wrapped_offer_day <> 0;
