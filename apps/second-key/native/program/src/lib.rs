#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::invoke,
    program_error::ProgramError,
    pubkey,
    pubkey::Pubkey,
    sysvar::{rent::Rent, Sysvar},
};

entrypoint!(process_instruction);

pub const ID: Pubkey = pubkey!("NcPgcz4zQ2CKZK6evWYwGC6iFcdji2Yrw65nCoto5rn");
pub const TOKEN_2022_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const LOAN_LEN: usize = 113;
pub const ADVANCE_LAMPORTS: u64 = 10_000_000;
const MAGIC: [u8; 8] = *b"SECKEY26";

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if program_id != &ID { return Err(ProgramError::IncorrectProgramId); }
    match data {
        [0] => initialize(program_id, accounts),
        [1] => pledge_and_draw(program_id, accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn initialize(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let mut iter = accounts.iter();
    let loan = next_account_info(&mut iter)?;
    let borrower = next_account_info(&mut iter)?;
    let mint = next_account_info(&mut iter)?;
    let vault = next_account_info(&mut iter)?;
    no_extra(&mut iter)?;

    if !loan.is_writable || loan.owner != program_id || loan.data_len() != LOAN_LEN || !borrower.is_signer {
        return Err(ProgramError::InvalidAccountData);
    }
    if mint.owner != &TOKEN_2022_ID || vault.owner != &TOKEN_2022_ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if loan.try_borrow_data()?.iter().any(|byte| *byte != 0) {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    let vault_data = vault.try_borrow_data()?;
    let (vault_mint, vault_owner, _) = token_account_fields(&vault_data)?;
    let (expected_owner, _) = Pubkey::find_program_address(&[b"vault", loan.key.as_ref()], program_id);
    if vault_mint != *mint.key || vault_owner != expected_owner {
        return Err(ProgramError::InvalidAccountData);
    }

    let mut state = loan.try_borrow_mut_data()?;
    state[..8].copy_from_slice(&MAGIC);
    state[8..40].copy_from_slice(borrower.key.as_ref());
    state[40..72].copy_from_slice(mint.key.as_ref());
    state[72..104].copy_from_slice(vault.key.as_ref());
    state[104] = 0;
    state[105..113].copy_from_slice(&ADVANCE_LAMPORTS.to_le_bytes());
    Ok(())
}

fn pledge_and_draw(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let mut iter = accounts.iter();
    let loan = next_account_info(&mut iter)?;
    let borrower = next_account_info(&mut iter)?;
    let source = next_account_info(&mut iter)?;
    let vault = next_account_info(&mut iter)?;
    let mint = next_account_info(&mut iter)?;
    let token_program = next_account_info(&mut iter)?;
    no_extra(&mut iter)?;

    if !loan.is_writable || loan.owner != program_id || !borrower.is_signer || !borrower.is_writable
        || !source.is_writable || !vault.is_writable || token_program.key != &TOKEN_2022_ID
        || source.owner != &TOKEN_2022_ID || vault.owner != &TOKEN_2022_ID || mint.owner != &TOKEN_2022_ID
    {
        return Err(ProgramError::InvalidAccountData);
    }

    let state = loan.try_borrow_data()?;
    if state[..8] != MAGIC || state[8..40] != borrower.key.to_bytes() || state[40..72] != mint.key.to_bytes()
        || state[72..104] != vault.key.to_bytes() || state[104] != 0
    {
        return Err(ProgramError::InvalidAccountData);
    }
    drop(state);

    let source_data = source.try_borrow_data()?;
    let (source_mint, source_owner, source_amount) = token_account_fields(&source_data)?;
    drop(source_data);
    let vault_data = vault.try_borrow_data()?;
    let (vault_mint, _, vault_amount) = token_account_fields(&vault_data)?;
    drop(vault_data);
    if source_mint != *mint.key || vault_mint != *mint.key || source_owner != *borrower.key || source_amount != 1 || vault_amount != 0 {
        return Err(ProgramError::InvalidAccountData);
    }

    let mut transfer_data = Vec::with_capacity(10);
    transfer_data.push(12);
    transfer_data.extend_from_slice(&1u64.to_le_bytes());
    transfer_data.push(0);
    let transfer = Instruction {
        program_id: TOKEN_2022_ID,
        accounts: vec![
            AccountMeta::new(*source.key, false),
            AccountMeta::new_readonly(*mint.key, false),
            AccountMeta::new(*vault.key, false),
            AccountMeta::new_readonly(*borrower.key, true),
        ],
        data: transfer_data,
    };
    invoke(&transfer, &[source.clone(), mint.clone(), vault.clone(), borrower.clone(), token_program.clone()])?;

    let rent_floor = Rent::get()?.minimum_balance(LOAN_LEN);
    if loan.lamports().saturating_sub(ADVANCE_LAMPORTS) < rent_floor {
        return Err(ProgramError::InsufficientFunds);
    }
    **loan.try_borrow_mut_lamports()? -= ADVANCE_LAMPORTS;
    **borrower.try_borrow_mut_lamports()? += ADVANCE_LAMPORTS;
    loan.try_borrow_mut_data()?[104] = 1;
    Ok(())
}

fn token_account_fields(data: &[u8]) -> Result<(Pubkey, Pubkey, u64), ProgramError> {
    if data.len() < 165 || data[108] != 1 { return Err(ProgramError::InvalidAccountData); }
    let mint = Pubkey::new_from_array(data[0..32].try_into().map_err(|_| ProgramError::InvalidAccountData)?);
    let owner = Pubkey::new_from_array(data[32..64].try_into().map_err(|_| ProgramError::InvalidAccountData)?);
    let amount = u64::from_le_bytes(data[64..72].try_into().map_err(|_| ProgramError::InvalidAccountData)?);
    Ok((mint, owner, amount))
}

fn no_extra<'a, 'b>(accounts: &mut impl Iterator<Item = &'a AccountInfo<'b>>) -> ProgramResult where 'b: 'a {
    if accounts.next().is_some() { return Err(ProgramError::InvalidArgument); }
    Ok(())
}
