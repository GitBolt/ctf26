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
4. **Replay mechanics:** Use the documented raw `invoke` and `set_sysvar` operations. The runtime
   account address is present in the binary, and its canonical Solana layout is public. The checker
   rejects every other direct state mutation.

Do not place the words `Clock`, `set_clock`, `rewind`, `underflow`, or the reference trace in the
initial public brief.
