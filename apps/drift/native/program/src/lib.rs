#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint,
    entrypoint::ProgramResult,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
    system_instruction, system_program,
    sysvar::Sysvar,
};

entrypoint!(process_instruction);

const VAULT_LEN: usize = 16;
const POSITION_LEN: usize = 104;
const VAULT_MAGIC: [u8; 8] = [0x71, 0x26, 0x93, 0x4d, 0xc8, 0x15, 0xae, 0x30];
const POSITION_MAGIC: [u8; 8] = [0xb4, 0x5f, 0x08, 0xe1, 0x62, 0x9a, 0x37, 0xcd];

#[cfg(not(any(feature = "variant-1", feature = "variant-2")))]
const TAGS: [u8; 3] = [0, 1, 2];
#[cfg(feature = "variant-1")]
const TAGS: [u8; 3] = [2, 0, 1];
#[cfg(feature = "variant-2")]
const TAGS: [u8; 3] = [1, 2, 0];

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (&tag, payload) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match tag {
        value if value == TAGS[0] => deposit(program_id, accounts, read_amount(payload)?),
        value if value == TAGS[1] && payload.is_empty() => accrue(program_id, accounts),
        value if value == TAGS[2] => withdraw(program_id, accounts, read_amount(payload)?),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn deposit(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
    let mut accounts = accounts.iter();
    let authority = next_account_info(&mut accounts)?;
    let vault = next_account_info(&mut accounts)?;
    let position = next_account_info(&mut accounts)?;
    let clock = next_account_info(&mut accounts)?;
    let system = next_account_info(&mut accounts)?;
    require_no_extra_accounts(&mut accounts)?;

    require_authority(authority)?;
    require_vault(program_id, vault)?;
    require_position(program_id, position, authority.key, vault.key)?;
    if !system_program::check_id(system.key) {
        return Err(ProgramError::IncorrectProgramId);
    }

    let now = read_timestamp(clock)?;
    {
        let data = position.try_borrow_data()?;
        let principal = read_u64(&data, 72)?;
        let balance = read_u64(&data, 80)?;
        principal
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        balance
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }

    invoke(
        &system_instruction::transfer(authority.key, vault.key, amount),
        &[authority.clone(), vault.clone(), system.clone()],
    )?;

    let mut data = position.try_borrow_mut_data()?;
    let principal = read_u64(&data, 72)?;
    let balance = read_u64(&data, 80)?;
    write_u64(&mut data, 72, principal + amount)?;
    write_u64(&mut data, 80, balance + amount)?;
    write_u64(&mut data, 88, now)
}

fn accrue(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let mut accounts = accounts.iter();
    let position = next_account_info(&mut accounts)?;
    let clock = next_account_info(&mut accounts)?;
    require_no_extra_accounts(&mut accounts)?;

    if !position.is_writable || position.owner != program_id || position.data_len() != POSITION_LEN
    {
        return Err(ProgramError::InvalidAccountData);
    }

    let mut data = position.try_borrow_mut_data()?;
    if data[..8] != POSITION_MAGIC {
        return Err(ProgramError::InvalidAccountData);
    }

    let principal = read_u64(&data, 72)?;
    let balance = read_u64(&data, 80)?;
    let last_ts = read_u64(&data, 88)?;
    let rate = read_u64(&data, 96)?;
    let now = read_timestamp(clock)?;

    // Intentionally vulnerable: adversarial/non-monotonic Clock values wrap into unbacked yield.
    let elapsed = now.wrapping_sub(last_ts);
    let interest = principal.wrapping_mul(rate).wrapping_mul(elapsed);
    write_u64(&mut data, 80, balance.wrapping_add(interest))?;
    write_u64(&mut data, 88, now)
}

fn withdraw(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
    let mut accounts = accounts.iter();
    let authority = next_account_info(&mut accounts)?;
    let vault = next_account_info(&mut accounts)?;
    let position = next_account_info(&mut accounts)?;
    require_no_extra_accounts(&mut accounts)?;

    require_authority(authority)?;
    require_vault(program_id, vault)?;
    require_position(program_id, position, authority.key, vault.key)?;

    let rent_floor = {
        let data = vault.try_borrow_data()?;
        read_u64(&data, 8)?
    };
    let available = vault
        .lamports()
        .checked_sub(rent_floor)
        .ok_or(ProgramError::InvalidAccountData)?;
    if amount > available {
        return Err(ProgramError::InsufficientFunds);
    }

    {
        let mut data = position.try_borrow_mut_data()?;
        let balance = read_u64(&data, 80)?;
        if amount > balance {
            return Err(ProgramError::InsufficientFunds);
        }
        write_u64(&mut data, 80, balance - amount)?;
    }

    **vault.try_borrow_mut_lamports()? = vault
        .lamports()
        .checked_sub(amount)
        .ok_or(ProgramError::InsufficientFunds)?;
    **authority.try_borrow_mut_lamports()? = authority
        .lamports()
        .checked_add(amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    Ok(())
}

fn require_authority(authority: &AccountInfo) -> ProgramResult {
    if !authority.is_signer || !authority.is_writable {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}

fn require_vault(program_id: &Pubkey, vault: &AccountInfo) -> ProgramResult {
    if !vault.is_writable || vault.owner != program_id || vault.data_len() != VAULT_LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    let data = vault.try_borrow_data()?;
    if data[..8] != VAULT_MAGIC {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

fn require_position(
    program_id: &Pubkey,
    position: &AccountInfo,
    authority: &Pubkey,
    vault: &Pubkey,
) -> ProgramResult {
    if !position.is_writable || position.owner != program_id || position.data_len() != POSITION_LEN
    {
        return Err(ProgramError::InvalidAccountData);
    }
    let data = position.try_borrow_data()?;
    if data[..8] != POSITION_MAGIC
        || data[8..40] != authority.to_bytes()
        || data[40..72] != vault.to_bytes()
    {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

fn require_no_extra_accounts<'a, 'b>(
    accounts: &mut impl Iterator<Item = &'a AccountInfo<'b>>,
) -> ProgramResult
where
    'b: 'a,
{
    if accounts.next().is_some() {
        return Err(ProgramError::InvalidArgument);
    }
    Ok(())
}

fn read_timestamp(clock: &AccountInfo) -> Result<u64, ProgramError> {
    if clock.key != &solana_program::sysvar::clock::id() {
        return Err(ProgramError::InvalidArgument);
    }
    Ok(Clock::from_account_info(clock)?.unix_timestamp as u64)
}

fn read_amount(payload: &[u8]) -> Result<u64, ProgramError> {
    if payload.len() != 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = u64::from_le_bytes(
        payload
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    if amount == 0 {
        return Err(ProgramError::InvalidArgument);
    }
    Ok(amount)
}

fn read_u64(data: &[u8], offset: usize) -> Result<u64, ProgramError> {
    let bytes = data
        .get(offset..offset + 8)
        .ok_or(ProgramError::InvalidAccountData)?;
    Ok(u64::from_le_bytes(
        bytes
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    ))
}

fn write_u64(data: &mut [u8], offset: usize, value: u64) -> ProgramResult {
    let target = data
        .get_mut(offset..offset + 8)
        .ok_or(ProgramError::InvalidAccountData)?;
    target.copy_from_slice(&value.to_le_bytes());
    Ok(())
}
