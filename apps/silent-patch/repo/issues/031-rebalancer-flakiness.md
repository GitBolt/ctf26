# Issue 31: rebalancer simulation intermittently misses account locks

Status: closed

Simulation occasionally succeeds and the submitted transaction later fails with an account-in-use
error. Retrying with a fresh blockhash resolves the failure. Add bounded retry handling to the keeper;
do not change the vault program.
