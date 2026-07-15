use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

declare_id!("Fg6PaFpoGXkYsidMpWxqSWYqGiZDFpcckZ5TF5YF9eG3");

#[program]
pub mod player_strategy {
    use super::*;

    /// Public Quarry strategy ABI. Replace the placeholder behavior as needed.
    pub fn execute(_ctx: Context<Execute>, amount: u64) -> Result<()> {
        require!(amount > 0, StrategyError::InvalidAmount);
        msg!("strategy template invoked for {} units", amount);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Execute<'info> {
    #[account(mut)]
    pub reserve: Account<'info, TokenAccount>,
    #[account(mut, constraint = destination.mint == reserve.mint)]
    pub destination: Account<'info, TokenAccount>,
    pub vault_authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum StrategyError {
    #[msg("amount must be positive")]
    InvalidAmount,
}
