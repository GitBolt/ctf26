use anchor_lang::{
    prelude::*,
    solana_program::{instruction::Instruction, program::invoke_signed},
};
use anchor_spl::token::{Mint, Token, TokenAccount};

declare_id!("GYoRyyds3mQP2DKf2QLARgU6io8Fs6vYN4iGDJAsbk9b");

const TEAM_SEED_LEN: usize = 16;
// First eight bytes of sha256("global:execute"), the public strategy ABI.
const EXECUTE_DISCRIMINATOR: [u8; 8] = [0x82, 0xdd, 0xf2, 0x9a, 0x0d, 0xc1, 0xbd, 0x1d];

#[program]
pub mod quarry_vault {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        team_seed: [u8; TEAM_SEED_LEN],
        pinned_strategy_program: Pubkey,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.team_seed = team_seed;
        vault.pinned_strategy_program = pinned_strategy_program;
        vault.reserve = ctx.accounts.reserve.key();
        vault.vault_authority_bump = ctx.bumps.vault_authority;
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    /// Intentionally vulnerable pre-fix implementation.
    ///
    /// `strategy_program` is caller controlled, while the vault's own trusted
    /// authority PDA is forwarded to it as a signer. A malicious strategy can
    /// reuse that signer privilege in a token-program CPI and drain `reserve`.
    pub fn execute_strategy(ctx: Context<ExecuteStrategy>, amount: u64) -> Result<()> {
        require!(amount > 0, QuarryError::InvalidAmount);

        // INTENTIONAL BUG: missing strategy-program pin check.
        invoke_strategy(&ctx, amount)
    }
}

fn invoke_strategy(ctx: &Context<ExecuteStrategy>, amount: u64) -> Result<()> {
    let mut data = EXECUTE_DISCRIMINATOR.to_vec();
    data.extend_from_slice(&amount.to_le_bytes());

    let ix = Instruction {
        program_id: ctx.accounts.strategy_program.key(),
        accounts: vec![
            AccountMeta::new(ctx.accounts.reserve.key(), false),
            AccountMeta::new(ctx.accounts.destination.key(), false),
            AccountMeta::new_readonly(ctx.accounts.vault_authority.key(), true),
            AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
        ],
        data,
    };

    let vault_key = ctx.accounts.vault.key();
    let signer_seeds: &[&[u8]] = &[
        b"vault-authority",
        vault_key.as_ref(),
        &[ctx.accounts.vault.vault_authority_bump],
    ];

    invoke_signed(
        &ix,
        &[
            ctx.accounts.reserve.to_account_info(),
            ctx.accounts.destination.to_account_info(),
            ctx.accounts.vault_authority.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.strategy_program.to_account_info(),
        ],
        &[signer_seeds],
    )?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(team_seed: [u8; TEAM_SEED_LEN])]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        space = Vault::SPACE,
        seeds = [b"vault", authority.key().as_ref(), team_seed.as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,
    /// CHECK: PDA is used only as the SPL-token authority.
    #[account(
        seeds = [b"vault-authority", vault.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = vault_authority,
        seeds = [b"reserve", vault.key().as_ref()],
        bump,
    )]
    pub reserve: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ExecuteStrategy<'info> {
    #[account(has_one = reserve)]
    pub vault: Account<'info, Vault>,
    /// CHECK: validated as this program's PDA; intentionally forwarded as signer.
    #[account(
        seeds = [b"vault-authority", vault.key().as_ref()],
        bump = vault.vault_authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, constraint = reserve.owner == vault_authority.key())]
    pub reserve: Account<'info, TokenAccount>,
    #[account(mut, constraint = destination.mint == reserve.mint)]
    pub destination: Account<'info, TokenAccount>,
    /// CHECK: intentionally unpinned in the vulnerable deployment.
    #[account(executable)]
    pub strategy_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Vault {
    pub authority: Pubkey,
    pub pinned_strategy_program: Pubkey,
    pub reserve: Pubkey,
    pub team_seed: [u8; TEAM_SEED_LEN],
    pub vault_authority_bump: u8,
    pub bump: u8,
}

impl Vault {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + TEAM_SEED_LEN + 1 + 1;
}

#[error_code]
pub enum QuarryError {
    #[msg("amount must be positive")]
    InvalidAmount,
}
