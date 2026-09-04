use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{get_stack_height, TRANSACTION_LEVEL_STACK_HEIGHT};

// Public-practice deployment. These public keys are compiled into the program;
// their private material stays outside the repository.
declare_id!("ZWXmHNvUZ4bVe4cUQJtt7VheafuNc7G2kr7us1PTJUc");

/// Only this key may create User PDAs. Held by the challenge service, never by a
/// participant, so a wallet cannot provision itself outside a portal launch.
pub const ADMIN_KEY: Pubkey = pubkey!("2BefExdaHVpygYaqYZQVX8c6wiomJe3jMD8k2GBS93Tn");

/// Delivered physically at the venue on an NFC card; must co-sign unlock_second.
pub const HIDDEN_KEY: Pubkey = pubkey!("BVR7YbDQiQB25nZmbAUFtLAQpQKapoaY9zMaJMTP1KC2");

pub const USER_SEED: &[u8] = b"user";

#[program]
pub mod st_chamber_of_secrets {
    use super::*;

    pub fn create_user(ctx: Context<CreateUser>) -> Result<()> {
        let ua = &mut ctx.accounts.user_account;
        ua.user = ctx.accounts.user.key();
        ua.bump = ctx.bumps.user_account;
        ua.first_unlock = false;
        ua.second_unlock = false;
        ua.third_unlock = false;
        ua.chamber_open = false;
        Ok(())
    }

    pub fn unlock_first(ctx: Context<UnlockFirst>) -> Result<()> {
        ctx.accounts.user_account.first_unlock = true;
        Ok(())
    }

    pub fn unlock_second(ctx: Context<UnlockSecond>) -> Result<()> {
        let ua = &mut ctx.accounts.user_account;
        require!(ua.first_unlock, ChamberError::FirstLockNotUnlocked);
        ua.second_unlock = true;
        Ok(())
    }

    pub fn unlock_third(ctx: Context<UnlockThird>) -> Result<()> {
        let ua = &mut ctx.accounts.user_account;
        require!(ua.first_unlock, ChamberError::FirstLockNotUnlocked);
        require!(ua.second_unlock, ChamberError::SecondLockNotUnlocked);

        // The third lock may only be turned from inside another program: a wallet
        // invoking this instruction directly runs at TRANSACTION_LEVEL_STACK_HEIGHT,
        // while a cross-program invocation is one or more levels deeper.
        require!(
            get_stack_height() > TRANSACTION_LEVEL_STACK_HEIGHT,
            ChamberError::ThirdLockResists
        );

        ua.third_unlock = true;
        // `chamber_open` is deliberately never written. The chamber is open
        // exactly when all three locks are, and the challenge service derives it
        // that way; it must not read this field.
        msg!("The Chamber of Secrets has been opened");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateUser<'info> {
    #[account(mut, address = ADMIN_KEY @ ChamberError::UnauthorizedAdmin)]
    pub admin: Signer<'info>,

    /// The wallet this PDA belongs to; not a signer (the admin provisions it).
    pub user: SystemAccount<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + User::INIT_SPACE,
        seeds = [USER_SEED, user.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, User>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnlockFirst<'info> {
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_account.bump,
        has_one = user @ ChamberError::UserMismatch
    )]
    pub user_account: Account<'info, User>,
}

#[derive(Accounts)]
pub struct UnlockSecond<'info> {
    /// The PDA owner must co-sign alongside the hidden key.
    pub user: Signer<'info>,

    #[account(address = HIDDEN_KEY @ ChamberError::UnauthorizedHiddenKey)]
    pub hidden: Signer<'info>,

    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_account.bump,
        has_one = user @ ChamberError::UserMismatch
    )]
    pub user_account: Account<'info, User>,
}

#[derive(Accounts)]
pub struct UnlockThird<'info> {
    // The PDA owner. Signs the outer transaction; the signature propagates
    // into this instruction through the caller program's CPI. Kept as a plain
    // `//` comment (not `///`) so this hint stays out of the on-chain IDL.
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_account.bump,
        has_one = user @ ChamberError::UserMismatch
    )]
    pub user_account: Account<'info, User>,
}

#[account]
#[derive(InitSpace)]
pub struct User {
    pub user: Pubkey,
    pub bump: u8,
    pub first_unlock: bool,
    pub second_unlock: bool,
    pub third_unlock: bool,
    pub chamber_open: bool,
}

#[error_code]
pub enum ChamberError {
    #[msg("The first lock has not been unlocked yet")]
    FirstLockNotUnlocked,
    #[msg("The second lock has not been unlocked yet")]
    SecondLockNotUnlocked,
    #[msg("Signer is not the admin key")]
    UnauthorizedAdmin,
    #[msg("Signer is not the hidden key")]
    UnauthorizedHiddenKey,
    #[msg("User account does not belong to this user")]
    UserMismatch,
    #[msg("Unlocking the third lock isn't going to be easy")]
    ThirdLockResists,
}
