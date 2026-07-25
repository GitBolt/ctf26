use anchor_lang::prelude::*;
use st_chamber_of_secrets::cpi::accounts::UnlockThird;
use st_chamber_of_secrets::program::StChamberOfSecrets;

declare_id!("9Fswy4U3dsYL6hMavmMDsqiUWxLtEdgYFN6LQVvGmnzx");

// Organizer-only reference caller. It turns the chamber's third lock through a
// cross-program invocation and is not privileged in any way — it exists so the
// Anchor suite can prove the CPI gate accepts an arbitrary program. It is the
// shape of the program a participant writes and deploys themselves, and it is
// never shipped to participants. Only the vault program is deployed for the
// event; this one is a localnet test fixture.
#[program]
pub mod chamber_caller {
    use super::*;

    pub fn open_third(ctx: Context<OpenThird>) -> Result<()> {
        let chamber_id = ctx.accounts.chamber_program.key();
        let cpi_accounts = UnlockThird {
            user: ctx.accounts.user.to_account_info(),
            user_account: ctx.accounts.user_account.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(chamber_id, cpi_accounts);
        st_chamber_of_secrets::cpi::unlock_third(cpi_ctx)
    }
}

#[derive(Accounts)]
pub struct OpenThird<'info> {
    /// The chamber PDA owner; their signature propagates into the CPI.
    pub user: Signer<'info>,

    /// CHECK: forwarded to the chamber program, which validates it via seeds + has_one.
    #[account(mut)]
    pub user_account: UncheckedAccount<'info>,

    pub chamber_program: Program<'info, StChamberOfSecrets>,
}
