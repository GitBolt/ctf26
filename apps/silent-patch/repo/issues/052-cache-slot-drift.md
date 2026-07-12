# Issue 52: cache slot lags after validator restart

Status: open

The analytics cache can briefly report the previous finalized slot after a validator restart. The
cache is not read by the vault program, but monitoring should label stale samples more clearly.
