# Issue 44: strategy rotation edge case

The strategy rotation tests are hard to read because the execution route accepts the program account
at call time. It would be cleaner if vault config defined the implementation and callers only supplied
accounts matching that config.

No exploit discussion here. This was filed as a test/readability issue.
