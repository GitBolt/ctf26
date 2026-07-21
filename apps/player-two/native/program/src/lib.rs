#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
};

entrypoint!(process_instruction);

pub const PASS_LEN: usize = 42;
pub const JACKPOT_LEN: usize = 9;
const PASS_MAGIC: [u8; 8] = *b"TWINPASS";
const JACKPOT_MAGIC: [u8; 8] = *b"TWINPOT!";

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    match data {
        [0] => migrate(program_id, accounts),
        [1] => open(program_id, accounts),
        [2] => initialize(program_id, accounts),
        [3] => initialize_context(program_id, accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn initialize_context(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    if accounts.is_empty() {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    for (index, account) in accounts.iter().enumerate() {
        if !account.is_writable || account.owner != program_id || account.data_len() != PASS_LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        if account.try_borrow_data()?.iter().any(|byte| *byte != 0) {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
        let mut data = account.try_borrow_mut_data()?;
        data[..8].copy_from_slice(&PASS_MAGIC);
        data[8..40].copy_from_slice(account.key.as_ref());
        data[40] = if index % 2 == 0 { 1 } else { 2 };
        data[41] = 1;
    }
    Ok(())
}

fn initialize(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let mut iter = accounts.iter();
    let holder = next_account_info(&mut iter)?;
    let previous = next_account_info(&mut iter)?;
    let current = next_account_info(&mut iter)?;
    let jackpot = next_account_info(&mut iter)?;
    no_extra(&mut iter)?;
    if !holder.is_signer
        || !previous.is_writable
        || !current.is_writable
        || !jackpot.is_writable
        || previous.owner != program_id
        || current.owner != program_id
        || jackpot.owner != program_id
        || previous.data_len() != PASS_LEN
        || current.data_len() != PASS_LEN
        || jackpot.data_len() != JACKPOT_LEN
    {
        return Err(ProgramError::InvalidAccountData);
    }
    if previous.try_borrow_data()?.iter().any(|byte| *byte != 0)
        || current.try_borrow_data()?.iter().any(|byte| *byte != 0)
        || jackpot.try_borrow_data()?.iter().any(|byte| *byte != 0)
    {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    let mut previous_data = previous.try_borrow_mut_data()?;
    previous_data[..8].copy_from_slice(&PASS_MAGIC);
    previous_data[8..40].copy_from_slice(holder.key.as_ref());
    previous_data[40] = 1;
    previous_data[41] = 1;
    drop(previous_data);
    let mut jackpot_data = jackpot.try_borrow_mut_data()?;
    jackpot_data[..8].copy_from_slice(&JACKPOT_MAGIC);
    jackpot_data[8] = 0;
    Ok(())
}

fn migrate(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let mut iter = accounts.iter();
    let holder = next_account_info(&mut iter)?;
    let previous = next_account_info(&mut iter)?;
    let current = next_account_info(&mut iter)?;
    if !holder.is_signer
        || !previous.is_writable
        || !current.is_writable
        || previous.owner != program_id
        || current.owner != program_id
        || previous.data_len() != PASS_LEN
        || current.data_len() != PASS_LEN
    {
        return Err(ProgramError::InvalidAccountData);
    }
    for context_account in iter {
        if !context_account.is_writable
            || context_account.owner != program_id
            || context_account.data_len() != PASS_LEN
        {
            return Err(ProgramError::InvalidAccountData);
        }
        let data = context_account.try_borrow_data()?;
        if data[..8] != PASS_MAGIC || data[41] != 1 {
            return Err(ProgramError::InvalidAccountData);
        }
    }
    let previous_data = previous.try_borrow_data()?;
    if previous_data[..8] != PASS_MAGIC
        || previous_data[8..40] != holder.key.to_bytes()
        || previous_data[40] != 1
        || previous_data[41] != 1
    {
        return Err(ProgramError::InvalidAccountData);
    }
    drop(previous_data);
    let mut current_data = current.try_borrow_mut_data()?;
    current_data[..8].copy_from_slice(&PASS_MAGIC);
    current_data[8..40].copy_from_slice(holder.key.as_ref());
    current_data[40] = 2;
    current_data[41] = 1;
    // Vulnerability: the previous pass remains active after a successful migration.
    Ok(())
}

fn open(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let mut iter = accounts.iter();
    let jackpot = next_account_info(&mut iter)?;
    let first_pass = next_account_info(&mut iter)?;
    let first_holder = next_account_info(&mut iter)?;
    let second_pass = next_account_info(&mut iter)?;
    let second_holder = next_account_info(&mut iter)?;
    no_extra(&mut iter)?;
    if !jackpot.is_writable || jackpot.owner != program_id || jackpot.data_len() != JACKPOT_LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    if first_pass.key == second_pass.key {
        return Err(ProgramError::InvalidArgument);
    }
    require_active_pass(program_id, first_pass, first_holder)?;
    require_active_pass(program_id, second_pass, second_holder)?;
    // Vulnerability: the passes must differ, but the two holders do not.
    let mut data = jackpot.try_borrow_mut_data()?;
    if data[..8] != JACKPOT_MAGIC || data[8] == 1 {
        return Err(ProgramError::InvalidAccountData);
    }
    data[8] = 1;
    Ok(())
}

fn require_active_pass(
    program_id: &Pubkey,
    pass: &AccountInfo,
    holder: &AccountInfo,
) -> ProgramResult {
    if !holder.is_signer || pass.owner != program_id || pass.data_len() != PASS_LEN {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let data = pass.try_borrow_data()?;
    if data[..8] != PASS_MAGIC || data[8..40] != holder.key.to_bytes() || data[41] != 1 {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

fn no_extra<'a, 'b>(accounts: &mut impl Iterator<Item = &'a AccountInfo<'b>>) -> ProgramResult
where
    'b: 'a,
{
    if accounts.next().is_some() {
        return Err(ProgramError::InvalidArgument);
    }
    Ok(())
}
