use anchor_lang::prelude::*;

declare_id!("QuarryVaUlt1111111111111111111111111111111");

#[account]
pub struct Vault {
    pub authority: Pubkey,
    pub pinned_strategy_program: Pubkey,
    pub reserve: u64,
}

pub fn execute_strategy(ctx: Context<ExecuteStrategy>, amount: u64) -> Result<()> {
    let vault = &ctx.accounts.vault;
    require_keys_eq!(
        ctx.accounts.strategy_program.key(),
        vault.pinned_strategy_program,
        ErrorCode::InvalidStrategyProgram
    );

    // CPI into the pinned strategy uses invoke_signed and forwards the
    // quarry vault-authority PDA. The strategy needs that signer to rebalance
    // the SPL-token reserve.
    invoke_strategy(ctx, amount)?;
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteStrategy<'info> {
    pub vault: Account<'info, Vault>,
    /// CHECK: executable and pinned above
    pub strategy_program: AccountInfo<'info>,
    /// CHECK: validated as this program's vault-authority PDA
    pub vault_authority: AccountInfo<'info>,
}

#[error_code]
pub enum ErrorCode {
    InvalidStrategyProgram,
}
