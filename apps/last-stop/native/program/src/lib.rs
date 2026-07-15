#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::Sysvar,
};

entrypoint!(process_instruction);

pub const TRANSIT_LEN: usize = 80;
pub const CARD_LEN: usize = 72;
pub const TRANSIT_MAGIC: [u8; 8] = *b"LASTSTOP";
pub const CARD_MAGIC: [u8; 8] = *b"TAPCARD!";

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (&tag, payload) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    match tag {
        0 => buy_card(program_id, accounts, read_one_string(payload)?),
        1 => {
            let (line, station) = read_two_strings(payload)?;
            enter_line(program_id, accounts, line, station)
        }
        2 if payload.is_empty() => arrive(program_id, accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn buy_card(program_id: &Pubkey, accounts: &[AccountInfo], route: &[u8]) -> ProgramResult {
    let mut accounts = accounts.iter();
    let passenger = next_account_info(&mut accounts)?;
    let transit = next_account_info(&mut accounts)?;
    let card = next_account_info(&mut accounts)?;
    let system = next_account_info(&mut accounts)?;
    no_extra(&mut accounts)?;

    require_passenger(passenger)?;
    let team_seed = require_transit(program_id, transit, passenger.key)?;
    if !card.is_writable || !system_program::check_id(system.key) {
        return Err(ProgramError::InvalidAccountData);
    }
    validate_word(route)?;

    let (expected, bump) = Pubkey::find_program_address(&[b"card", &team_seed, route], program_id);
    if card.key != &expected || card.owner == program_id {
        return Err(ProgramError::InvalidSeeds);
    }

    let rent = Rent::get()?.minimum_balance(CARD_LEN);
    invoke_signed(
        &system_instruction::create_account(
            passenger.key,
            card.key,
            rent,
            CARD_LEN as u64,
            program_id,
        ),
        &[passenger.clone(), card.clone(), system.clone()],
        &[&[b"card", &team_seed, route, &[bump]]],
    )?;

    let mut data = card.try_borrow_mut_data()?;
    data[..8].copy_from_slice(&CARD_MAGIC);
    data[8..40].copy_from_slice(passenger.key.as_ref());
    data[40] = route.len() as u8;
    data[41..41 + route.len()].copy_from_slice(route);
    Ok(())
}

fn enter_line(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    line: &[u8],
    station: &[u8],
) -> ProgramResult {
    let mut accounts = accounts.iter();
    let passenger = next_account_info(&mut accounts)?;
    let transit = next_account_info(&mut accounts)?;
    let card = next_account_info(&mut accounts)?;
    no_extra(&mut accounts)?;

    require_passenger(passenger)?;
    if !transit.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    let team_seed = require_transit(program_id, transit, passenger.key)?;
    validate_word(line)?;
    validate_word(station)?;

    // The gate derives the same address differently from the kiosk. Solana hashes
    // PDA seeds in sequence without encoding their boundaries.
    let (expected, _) =
        Pubkey::find_program_address(&[b"card", &team_seed, line, station], program_id);
    if card.key != &expected || card.owner != program_id || card.data_len() != CARD_LEN {
        return Err(ProgramError::InvalidSeeds);
    }
    let card_data = card.try_borrow_data()?;
    if card_data[..8] != CARD_MAGIC || card_data[8..40] != passenger.key.to_bytes() {
        return Err(ProgramError::InvalidAccountData);
    }
    drop(card_data);

    let mut transit_data = transit.try_borrow_mut_data()?;
    transit_data[72] = 1;
    Ok(())
}

fn arrive(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let mut accounts = accounts.iter();
    let passenger = next_account_info(&mut accounts)?;
    let transit = next_account_info(&mut accounts)?;
    no_extra(&mut accounts)?;

    require_passenger(passenger)?;
    if !transit.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    require_transit(program_id, transit, passenger.key)?;
    let mut data = transit.try_borrow_mut_data()?;
    if data[72] != 1 {
        return Err(ProgramError::InvalidAccountData);
    }
    if data[73] == 1 {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    data[73] = 1;
    Ok(())
}

fn require_passenger(passenger: &AccountInfo) -> ProgramResult {
    if !passenger.is_signer || !passenger.is_writable {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}

fn require_transit(
    program_id: &Pubkey,
    transit: &AccountInfo,
    passenger: &Pubkey,
) -> Result<[u8; 8], ProgramError> {
    if transit.owner != program_id || transit.data_len() != TRANSIT_LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    let data = transit.try_borrow_data()?;
    if data[..8] != TRANSIT_MAGIC || data[8..40] != passenger.to_bytes() {
        return Err(ProgramError::InvalidAccountData);
    }
    data[40..48]
        .try_into()
        .map_err(|_| ProgramError::InvalidAccountData)
}

fn validate_word(value: &[u8]) -> ProgramResult {
    if value.is_empty() || value.len() > 24 || !value.iter().all(|byte| byte.is_ascii_lowercase()) {
        return Err(ProgramError::InvalidInstructionData);
    }
    Ok(())
}

fn read_one_string(payload: &[u8]) -> Result<&[u8], ProgramError> {
    let (&length, rest) = payload
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    if rest.len() != length as usize {
        return Err(ProgramError::InvalidInstructionData);
    }
    Ok(rest)
}

fn read_two_strings(payload: &[u8]) -> Result<(&[u8], &[u8]), ProgramError> {
    let (&first_len, rest) = payload
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    let first_len = first_len as usize;
    if rest.len() <= first_len {
        return Err(ProgramError::InvalidInstructionData);
    }
    let (first, tail) = rest.split_at(first_len);
    let (&second_len, second) = tail
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    if second.len() != second_len as usize {
        return Err(ProgramError::InvalidInstructionData);
    }
    Ok((first, second))
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
