use anyhow::{anyhow, Context, Result};
use litesvm::LiteSVM;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{account_meta::AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::{fs, path::Path};

const PASS_LEN: usize = 42;
const PROGRAM_ID: [u8; 32] = *b"player-two-sbf-program-ctf26-v01";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VerifyInput {
    pub participant_id: String,
    pub first_generation: u8,
    pub second_generation: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyOutput {
    pub solved: bool,
    pub first_generation: u8,
    pub second_generation: u8,
}

pub fn verify(program_path: impl AsRef<Path>, input: &VerifyInput) -> Result<VerifyOutput> {
    if input.participant_id.is_empty() || input.participant_id.len() > 128 {
        anyhow::bail!("invalid participant id");
    }
    let bytes = fs::read(program_path.as_ref()).context("read player two SBF")?;
    let program_id = Address::new_from_array(PROGRAM_ID);
    let holder = deterministic_holder(&input.participant_id)?;
    let first = address("pass-one", &input.participant_id);
    let second = address("pass-two", &input.participant_id);
    let jackpot = address("jackpot", &input.participant_id);
    let context_one = address("context-one", &input.participant_id);
    let context_two = address("context-two", &input.participant_id);
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, &bytes)
        .map_err(|error| anyhow!("load SBF: {error}"))?;
    svm.airdrop(&holder.pubkey(), 1_000_000_000)
        .map_err(|error| anyhow!("fund holder: {error:?}"))?;
    svm.set_account(
        first,
        Account {
            lamports: 1_000_000,
            data: vec![0; PASS_LEN],
            owner: program_id,
            ..Account::default()
        },
    )
    .map_err(|error| anyhow!("seed pass one: {error}"))?;
    svm.set_account(
        second,
        Account {
            lamports: 1_000_000,
            data: vec![0; PASS_LEN],
            owner: program_id,
            ..Account::default()
        },
    )
    .map_err(|error| anyhow!("seed pass two: {error}"))?;
    svm.set_account(
        jackpot,
        Account {
            lamports: 1_000_000,
            data: vec![0; 9],
            owner: program_id,
            ..Account::default()
        },
    )
    .map_err(|error| anyhow!("seed jackpot: {error}"))?;
    svm.set_account(
        context_one,
        Account {
            lamports: 1_000_000,
            data: vec![0; PASS_LEN],
            owner: program_id,
            ..Account::default()
        },
    )
    .map_err(|error| anyhow!("seed context one: {error}"))?;
    svm.set_account(
        context_two,
        Account {
            lamports: 1_000_000,
            data: vec![0; PASS_LEN],
            owner: program_id,
            ..Account::default()
        },
    )
    .map_err(|error| anyhow!("seed context two: {error}"))?;
    send(
        &mut svm,
        &holder,
        Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new_readonly(holder.pubkey(), true),
                AccountMeta::new(first, false),
                AccountMeta::new(second, false),
                AccountMeta::new(jackpot, false),
            ],
            data: vec![2],
        },
    )?;
    send(
        &mut svm,
        &holder,
        Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(context_one, false),
                AccountMeta::new(context_two, false),
            ],
            data: vec![3],
        },
    )?;
    send(
        &mut svm,
        &holder,
        Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new_readonly(holder.pubkey(), true),
                AccountMeta::new(first, false),
                AccountMeta::new(second, false),
                AccountMeta::new(context_one, false),
                AccountMeta::new(context_two, false),
            ],
            data: vec![0],
        },
    )?;
    let pass = |generation| if generation == 1 { first } else { second };
    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(jackpot, false),
            AccountMeta::new_readonly(pass(input.first_generation), false),
            AccountMeta::new_readonly(holder.pubkey(), true),
            AccountMeta::new_readonly(pass(input.second_generation), false),
            AccountMeta::new_readonly(holder.pubkey(), true),
        ],
        data: vec![1],
    };
    let solved = send(&mut svm, &holder, instruction).is_ok()
        && svm
            .get_account(&jackpot)
            .and_then(|account| account.data.get(8).copied())
            == Some(1);
    Ok(VerifyOutput {
        solved,
        first_generation: input.first_generation,
        second_generation: input.second_generation,
    })
}

fn address(label: &str, participant: &str) -> Address {
    let mut hash = Sha256::new();
    hash.update(b"player-two-address");
    hash.update(label);
    hash.update(participant);
    Address::new_from_array(hash.finalize().into())
}
fn deterministic_holder(participant: &str) -> Result<Keypair> {
    let mut hash = Sha256::new();
    hash.update(b"player-two-holder");
    hash.update(participant);
    Ok(Keypair::new_from_array(hash.finalize().into()))
}
fn send(svm: &mut LiteSVM, signer: &Keypair, instruction: Instruction) -> Result<()> {
    svm.expire_blockhash();
    let message = Message::new(&[instruction], Some(&signer.pubkey()));
    let tx = Transaction::new(&[signer], message, svm.latest_blockhash());
    svm.send_transaction(tx)
        .map_err(|error| anyhow!("native transaction failed: {error:?}"))?;
    Ok(())
}
