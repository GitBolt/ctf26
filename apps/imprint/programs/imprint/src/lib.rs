use anchor_lang::{
    prelude::*,
    solana_program::{
        program::invoke, system_instruction, sysvar::instructions::load_instruction_at_checked,
    },
};
use solana_sha256_hasher::{hash, hashv};

declare_id!("5EgXikx8uaGDDRdLdxzoLsDafSruHZnNnstE7bd8wH6B");

const SECP256R1_PROGRAM_ID: Pubkey = pubkey!("Secp256r1SigVerify1111111111111111111111111");
const PASSKEY_SIZE: usize = 33;
const VAULT_ID_SIZE: usize = 16;
const MAX_CLIENT_DATA_JSON: usize = 768;
const MAX_AUTHENTICATOR_DATA: usize = 256;
const MIN_AUTHENTICATOR_DATA: usize = 37;
const AUTHENTICATOR_FLAGS_OFFSET: usize = 32;
const USER_PRESENCE_FLAG: u8 = 0x01;
const USER_VERIFICATION_FLAG: u8 = 0x04;
const SECP256R1_DATA_START: usize = 16;
const SECP256R1_PUBKEY_SIZE: usize = 33;
const SECP256R1_SIGNATURE_SIZE: usize = 64;
const U16_MAX: u16 = u16::MAX;
const REGISTRAR_ID: Pubkey = pubkey!("AdtCf3S1zEHZ14js7G7vqN5EDatSGC9SxSTDotJBEvJF");
const P256_HALF_ORDER_BE: [u8; 32] = [
    0x7f, 0xff, 0xff, 0xff, 0x80, 0x00, 0x00, 0x00, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xde, 0x73, 0x7d, 0x56, 0xd3, 0x8b, 0xcf, 0x42, 0x79, 0xdc, 0xe5, 0x61, 0x7e, 0x31, 0x92, 0xa8,
];

#[program]
pub mod imprint {
    use super::*;

    pub fn register_passkey(
        ctx: Context<RegisterPasskey>,
        passkey_seed: [u8; 32],
        passkey_pubkey: [u8; PASSKEY_SIZE],
        rp_id_hash: [u8; 32],
    ) -> Result<()> {
        require!(
            passkey_seed == passkey_seed_for(&passkey_pubkey),
            ImprintError::PasskeySeedMismatch
        );
        require_keys_eq!(
            ctx.accounts.registrar.key(),
            REGISTRAR_ID,
            ImprintError::InvalidRegistrar
        );

        let passkey = &mut ctx.accounts.passkey;
        passkey.owner = ctx.accounts.owner.key();
        passkey.passkey_pubkey = passkey_pubkey;
        passkey.rp_id_hash = rp_id_hash;
        passkey.active = true;
        passkey.bump = ctx.bumps.passkey;

        emit!(PasskeyRegistered {
            owner: passkey.owner,
            passkey_pubkey,
        });

        Ok(())
    }

    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        vault_id: [u8; VAULT_ID_SIZE],
        registered_passkey: [u8; PASSKEY_SIZE],
        initial_lamports: u64,
    ) -> Result<()> {
        let authority = ctx.accounts.authority.key();
        let vault_key = ctx.accounts.vault.key();
        ctx.accounts.vault.authority = authority;
        ctx.accounts.vault.vault_id = vault_id;
        ctx.accounts.vault.registered_passkey = registered_passkey;
        ctx.accounts.vault.nonce = 0;
        ctx.accounts.vault.bump = ctx.bumps.vault;

        if initial_lamports > 0 {
            let ix = system_instruction::transfer(
                &ctx.accounts.authority.key(),
                &ctx.accounts.vault.key(),
                initial_lamports,
            );
            invoke(
                &ix,
                &[
                    ctx.accounts.authority.to_account_info(),
                    ctx.accounts.vault.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }

        emit!(VaultInitialized {
            vault: vault_key,
            authority,
            registered_passkey,
        });

        Ok(())
    }

    pub fn withdraw_with_passkey(
        ctx: Context<WithdrawWithPasskey>,
        passkey_seed: [u8; 32],
        passkey_pubkey: [u8; PASSKEY_SIZE],
        amount: u64,
        secp256r1_instruction_index: u16,
        client_data_json: Vec<u8>,
        authenticator_data: Vec<u8>,
    ) -> Result<()> {
        require!(
            passkey_seed == passkey_seed_for(&passkey_pubkey),
            ImprintError::PasskeySeedMismatch
        );

        require!(
            client_data_json.len() <= MAX_CLIENT_DATA_JSON,
            ImprintError::ClientDataTooLarge
        );
        require!(
            authenticator_data.len() <= MAX_AUTHENTICATOR_DATA,
            ImprintError::AuthenticatorDataTooLarge
        );
        require!(amount > 0, ImprintError::InvalidAmount);
        require!(ctx.accounts.passkey.active, ImprintError::InactivePasskey);
        require!(
            ctx.accounts.passkey.passkey_pubkey == passkey_pubkey,
            ImprintError::PasskeyAccountMismatch
        );
        require!(
            authenticator_data.len() >= MIN_AUTHENTICATOR_DATA,
            ImprintError::InvalidAuthenticatorData
        );
        require!(
            authenticator_data[..32] == ctx.accounts.passkey.rp_id_hash[..],
            ImprintError::RpIdHashMismatch
        );
        let authenticator_flags = authenticator_data[AUTHENTICATOR_FLAGS_OFFSET];
        require!(
            authenticator_flags & USER_PRESENCE_FLAG != 0,
            ImprintError::UserPresenceRequired
        );
        require!(
            authenticator_flags & USER_VERIFICATION_FLAG != 0,
            ImprintError::UserVerificationRequired
        );

        let expected_challenge = withdrawal_challenge(
            &ctx.accounts.vault.key(),
            &ctx.accounts.destination.key(),
            amount,
            ctx.accounts.vault.nonce,
        );

        require!(
            json_string_field_equals(&client_data_json, b"type", b"webauthn.get"),
            ImprintError::InvalidClientData
        );
        require!(
            json_string_field_equals(&client_data_json, b"challenge", &expected_challenge),
            ImprintError::InvalidClientData
        );

        let mut signed_message = Vec::with_capacity(authenticator_data.len().saturating_add(32));
        signed_message.extend_from_slice(&authenticator_data);
        signed_message.extend_from_slice(hash(&client_data_json).as_ref());

        verify_secp256r1_instruction(
            &ctx.accounts.instructions.to_account_info(),
            secp256r1_instruction_index,
            &passkey_pubkey,
            &signed_message,
        )?;

        let rent_floor = Rent::get()?.minimum_balance(Vault::SPACE);
        let vault_lamports = ctx.accounts.vault.to_account_info().lamports();
        require!(
            vault_lamports.saturating_sub(rent_floor) >= amount,
            ImprintError::InsufficientVaultLamports
        );

        **ctx
            .accounts
            .vault
            .to_account_info()
            .try_borrow_mut_lamports()? -= amount;
        **ctx
            .accounts
            .destination
            .to_account_info()
            .try_borrow_mut_lamports()? += amount;

        ctx.accounts.vault.nonce = ctx
            .accounts
            .vault
            .nonce
            .checked_add(1)
            .ok_or(ImprintError::NonceOverflow)?;

        emit!(VaultWithdrawn {
            vault: ctx.accounts.vault.key(),
            destination: ctx.accounts.destination.key(),
            passkey_pubkey,
            amount,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(passkey_seed: [u8; 32])]
pub struct RegisterPasskey<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub registrar: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = Passkey::SPACE,
        seeds = [b"passkey", passkey_seed.as_ref()],
        bump,
    )]
    pub passkey: Account<'info, Passkey>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(vault_id: [u8; 16])]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = Vault::SPACE,
        seeds = [b"vault", authority.key().as_ref(), vault_id.as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(passkey_seed: [u8; 32])]
pub struct WithdrawWithPasskey<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
    #[account(
        seeds = [b"passkey", passkey_seed.as_ref()],
        bump = passkey.bump,
        has_one = owner @ ImprintError::PasskeyOwnerMismatch,
    )]
    pub passkey: Account<'info, Passkey>,
    /// CHECK: The account receiving lamports can be any system wallet controlled by the solver.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
    /// CHECK: Native instructions sysvar used to inspect the preceding secp256r1 verification ix.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[account]
pub struct Passkey {
    pub owner: Pubkey,
    pub passkey_pubkey: [u8; PASSKEY_SIZE],
    pub rp_id_hash: [u8; 32],
    pub active: bool,
    pub bump: u8,
}

impl Passkey {
    pub const SPACE: usize = 8 + 32 + PASSKEY_SIZE + 32 + 1 + 1;
}

#[account]
pub struct Vault {
    pub authority: Pubkey,
    pub registered_passkey: [u8; PASSKEY_SIZE],
    pub vault_id: [u8; VAULT_ID_SIZE],
    pub nonce: u64,
    pub bump: u8,
}

impl Vault {
    pub const SPACE: usize = 8 + 32 + PASSKEY_SIZE + VAULT_ID_SIZE + 8 + 1;
}

#[event]
pub struct PasskeyRegistered {
    pub owner: Pubkey,
    pub passkey_pubkey: [u8; PASSKEY_SIZE],
}

#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub authority: Pubkey,
    pub registered_passkey: [u8; PASSKEY_SIZE],
}

#[event]
pub struct VaultWithdrawn {
    pub vault: Pubkey,
    pub destination: Pubkey,
    pub passkey_pubkey: [u8; PASSKEY_SIZE],
    pub amount: u64,
}

#[error_code]
pub enum ImprintError {
    #[msg("clientDataJSON is too large")]
    ClientDataTooLarge,
    #[msg("authenticatorData is too large")]
    AuthenticatorDataTooLarge,
    #[msg("authenticatorData is malformed")]
    InvalidAuthenticatorData,
    #[msg("invalid withdraw amount")]
    InvalidAmount,
    #[msg("passkey is inactive")]
    InactivePasskey,
    #[msg("passkey account does not match the supplied passkey pubkey")]
    PasskeyAccountMismatch,
    #[msg("withdraw must be signed by the wallet that owns the passkey account")]
    PasskeyOwnerMismatch,
    #[msg("passkey PDA seed must be sha256(compressed passkey pubkey)")]
    PasskeySeedMismatch,
    #[msg("passkey registration must be approved by the event registrar")]
    InvalidRegistrar,
    #[msg("clientDataJSON does not exactly match the expected WebAuthn type and challenge")]
    InvalidClientData,
    #[msg("authenticatorData was produced for the wrong WebAuthn RP ID")]
    RpIdHashMismatch,
    #[msg("the WebAuthn assertion must prove user presence")]
    UserPresenceRequired,
    #[msg("the WebAuthn assertion must prove user verification")]
    UserVerificationRequired,
    #[msg("secp256r1 verification instruction not found or malformed")]
    InvalidSecp256r1Instruction,
    #[msg("secp256r1 instruction verified the wrong passkey")]
    Secp256r1PubkeyMismatch,
    #[msg("secp256r1 instruction verified the wrong message")]
    Secp256r1MessageMismatch,
    #[msg("secp256r1 signature must use canonical low-S form")]
    Secp256r1HighS,
    #[msg("vault has insufficient withdrawable lamports")]
    InsufficientVaultLamports,
    #[msg("vault nonce overflow")]
    NonceOverflow,
}

fn withdrawal_challenge(vault: &Pubkey, destination: &Pubkey, amount: u64, nonce: u64) -> Vec<u8> {
    let amount_bytes = amount.to_le_bytes();
    let nonce_bytes = nonce.to_le_bytes();
    let digest = hashv(&[
        b"IMPRINT_WITHDRAW_V1",
        vault.as_ref(),
        destination.as_ref(),
        &amount_bytes,
        &nonce_bytes,
    ]);
    base64url_no_pad(digest.as_ref())
}

fn passkey_seed_for(passkey_pubkey: &[u8; PASSKEY_SIZE]) -> [u8; 32] {
    hash(passkey_pubkey).to_bytes()
}

fn verify_secp256r1_instruction(
    instructions: &AccountInfo,
    secp256r1_instruction_index: u16,
    expected_pubkey: &[u8; PASSKEY_SIZE],
    expected_message: &[u8],
) -> Result<()> {
    let ix = load_instruction_at_checked(secp256r1_instruction_index as usize, instructions)
        .map_err(|_| error!(ImprintError::InvalidSecp256r1Instruction))?;

    require!(
        ix.program_id == SECP256R1_PROGRAM_ID,
        ImprintError::InvalidSecp256r1Instruction
    );
    require!(
        ix.data.len() >= SECP256R1_DATA_START,
        ImprintError::InvalidSecp256r1Instruction
    );
    require!(ix.data[0] == 1, ImprintError::InvalidSecp256r1Instruction);

    let offsets = Secp256r1Offsets::parse(&ix.data[2..SECP256R1_DATA_START])?;
    require!(
        offsets.signature_instruction_index == U16_MAX
            && offsets.public_key_instruction_index == U16_MAX
            && offsets.message_instruction_index == U16_MAX,
        ImprintError::InvalidSecp256r1Instruction
    );

    let pubkey = read_slice(
        &ix.data,
        offsets.public_key_offset as usize,
        SECP256R1_PUBKEY_SIZE,
    )?;
    require!(
        pubkey == expected_pubkey,
        ImprintError::Secp256r1PubkeyMismatch
    );

    let signature = read_slice(
        &ix.data,
        offsets.signature_offset as usize,
        SECP256R1_SIGNATURE_SIZE,
    )?;
    require!(
        signature[32..64] <= P256_HALF_ORDER_BE[..],
        ImprintError::Secp256r1HighS
    );
    let message = read_slice(
        &ix.data,
        offsets.message_data_offset as usize,
        offsets.message_data_size as usize,
    )?;
    require!(
        message == expected_message,
        ImprintError::Secp256r1MessageMismatch
    );

    Ok(())
}

#[derive(Debug)]
struct Secp256r1Offsets {
    signature_offset: u16,
    signature_instruction_index: u16,
    public_key_offset: u16,
    public_key_instruction_index: u16,
    message_data_offset: u16,
    message_data_size: u16,
    message_instruction_index: u16,
}

impl Secp256r1Offsets {
    fn parse(data: &[u8]) -> Result<Self> {
        require!(data.len() == 14, ImprintError::InvalidSecp256r1Instruction);
        Ok(Self {
            signature_offset: read_u16(data, 0)?,
            signature_instruction_index: read_u16(data, 2)?,
            public_key_offset: read_u16(data, 4)?,
            public_key_instruction_index: read_u16(data, 6)?,
            message_data_offset: read_u16(data, 8)?,
            message_data_size: read_u16(data, 10)?,
            message_instruction_index: read_u16(data, 12)?,
        })
    }
}

fn read_u16(data: &[u8], offset: usize) -> Result<u16> {
    let bytes = read_slice(data, offset, 2)?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn read_slice(data: &[u8], offset: usize, len: usize) -> Result<&[u8]> {
    let end = offset
        .checked_add(len)
        .ok_or(ImprintError::InvalidSecp256r1Instruction)?;
    require!(end <= data.len(), ImprintError::InvalidSecp256r1Instruction);
    Ok(&data[offset..end])
}

fn json_string_field_equals(json: &[u8], field: &[u8], value: &[u8]) -> bool {
    if field.is_empty() || value.is_empty() {
        return false;
    }

    let mut needle = Vec::with_capacity(field.len().saturating_add(value.len()).saturating_add(5));
    needle.push(b'"');
    needle.extend_from_slice(field);
    needle.extend_from_slice(b"\":\"");
    needle.extend_from_slice(value);
    needle.push(b'"');

    json.windows(needle.len()).any(|window| window == needle)
}

fn base64url_no_pad(data: &[u8]) -> Vec<u8> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = Vec::with_capacity((data.len() * 4 + 2) / 3);
    let mut i = 0;

    while i + 3 <= data.len() {
        let n = ((data[i] as u32) << 16) | ((data[i + 1] as u32) << 8) | data[i + 2] as u32;
        out.push(TABLE[((n >> 18) & 63) as usize]);
        out.push(TABLE[((n >> 12) & 63) as usize]);
        out.push(TABLE[((n >> 6) & 63) as usize]);
        out.push(TABLE[(n & 63) as usize]);
        i += 3;
    }

    match data.len() - i {
        1 => {
            let n = (data[i] as u32) << 16;
            out.push(TABLE[((n >> 18) & 63) as usize]);
            out.push(TABLE[((n >> 12) & 63) as usize]);
        }
        2 => {
            let n = ((data[i] as u32) << 16) | ((data[i + 1] as u32) << 8);
            out.push(TABLE[((n >> 18) & 63) as usize]);
            out.push(TABLE[((n >> 12) & 63) as usize]);
            out.push(TABLE[((n >> 6) & 63) as usize]);
        }
        _ => {}
    }

    out
}
