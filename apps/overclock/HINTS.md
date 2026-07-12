# DRIFT organizer hint ladder

Do not publish this file in the player kit. Release one hint at a time and record when each team uses
it. The first two hints preserve the core realization; the final two are recovery paths for teams that
understand the bug but are blocked on mechanics.

1. **Behavior:** Your balance changes even when no value enters the target. What external input could
   make the same instruction produce a different result?
2. **Environment:** The sandbox is part of the attack surface. Inspect which sysvars the program reads
   rather than treating them as passive metadata.
3. **Time:** Reconstruct how the program computes elapsed time. Ask what happens if the relevant value
   is extremely large—or is not monotonic.
4. **Replay mechanics:** A scored schedule may contain canonical program invocations and a declared
   `Clock.unix_timestamp` sequence. The checker rejects every other direct state mutation.

The final hint may be accompanied by the submission-schema reference during the event. Do not place
the words `set_clock`, `rewind`, `underflow`, or the reference trace in the initial public brief.
