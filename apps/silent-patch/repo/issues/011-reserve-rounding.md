# Issue 11: reserve preview rounds down

Status: closed

The dashboard preview drops fractional display units for six-decimal mints. On-chain amounts are
unchanged; only `uiAmountString` formatting in the indexer is affected.

Resolution: show raw units in the operator view and format at the edge.
