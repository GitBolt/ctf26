use {
    anyhow::{anyhow, bail, Context, Result},
    litesvm::LiteSVM,
    serde::{Deserialize, Serialize},
    sha2::{Digest, Sha256},
    solana_account::Account,
    solana_address::Address,
    solana_instruction::{account_meta::AccountMeta, Instruction},
    solana_keypair::Keypair,
    solana_message::Message,
    solana_sdk_ids::system_program,
    solana_signer::Signer,
    solana_transaction::Transaction,
    std::{fs, path::Path},
};

const TRANSIT_LEN: usize = 80;
const TRANSIT_MAGIC: [u8; 8] = *b"LASTSTOP";
const PROGRAM_ID_BYTES: [u8; 32] = *b"last-stop-sbf-program-ctf26-v01!";
const MAX_ACTIONS: usize = 12;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Buy { route: String },
    Enter {
        line: String,
        station: String,
        #[serde(rename = "cardRoute")]
        card_route: String,
    },
    Arrive,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplayInput {
    pub team_id: String,
    #[serde(default)]
    pub actions: Vec<Action>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayOutput {
    pub team_id: String,
    pub program_id: String,
    pub program_sha256: String,
    pub passenger: String,
    pub transit: String,
    pub cards: Vec<CardResult>,
    pub red_line_card: String,
    pub red_line_open: bool,
    pub arrived: bool,
    pub solved: bool,
    pub executed_transactions: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardResult {
    pub route: String,
    pub address: String,
}

pub fn replay(program_path: impl AsRef<Path>, input: &ReplayInput) -> Result<ReplayOutput> {
    validate_team_id(&input.team_id)?;
    if input.actions.len() > MAX_ACTIONS {
        bail!("journey contains too many on-chain actions");
    }
    let program_bytes = fs::read(program_path.as_ref())
        .with_context(|| format!("read SBF artifact {}", program_path.as_ref().display()))?;
    if !program_bytes.starts_with(b"\x7fELF") {
        bail!("program artifact is not an ELF binary");
    }
    let program_sha256 = hex(&Sha256::digest(&program_bytes));
    let program_id = Address::new_from_array(PROGRAM_ID_BYTES);
    let passenger = deterministic_keypair(&input.team_id)?;
    let team_seed: [u8; 8] = Sha256::digest(input.team_id.as_bytes())[..8]
        .try_into()
        .expect("fixed slice");
    let transit =
        Address::find_program_address(&[b"transit", passenger.pubkey().as_ref()], &program_id).0;

    let mut svm = LiteSVM::new();
    svm.add_program(program_id, &program_bytes)
        .map_err(|error| anyhow!("load SBF artifact: {error}"))?;
    svm.airdrop(&passenger.pubkey(), 10_000_000_000)
        .map_err(|error| anyhow!("fund passenger: {error:?}"))?;
    let mut transit_data = vec![0_u8; TRANSIT_LEN];
    transit_data[..8].copy_from_slice(&TRANSIT_MAGIC);
    transit_data[8..40].copy_from_slice(passenger.pubkey().as_ref());
    transit_data[40..48].copy_from_slice(&team_seed);
    svm.set_account(
        transit,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(TRANSIT_LEN),
            data: transit_data,
            owner: program_id,
            ..Account::default()
        },
    )
    .map_err(|error| anyhow!("seed transit account: {error}"))?;

    let mut cards = Vec::new();
    let mut executed = 0;
    for action in &input.actions {
        let instruction = match action {
            Action::Buy { route } => {
                validate_word(route)?;
                let card = Address::find_program_address(
                    &[b"card", &team_seed, route.as_bytes()],
                    &program_id,
                )
                .0;
                let mut data = vec![0, route.len() as u8];
                data.extend_from_slice(route.as_bytes());
                cards.push(CardResult {
                    route: route.clone(),
                    address: card.to_string(),
                });
                Instruction {
                    program_id,
                    accounts: vec![
                        AccountMeta::new(passenger.pubkey(), true),
                        AccountMeta::new_readonly(transit, false),
                        AccountMeta::new(card, false),
                        AccountMeta::new_readonly(system_program::id(), false),
                    ],
                    data,
                }
            }
            Action::Enter {
                line,
                station,
                card_route,
            } => {
                validate_word(line)?;
                validate_word(station)?;
                validate_word(card_route)?;
                let card = Address::find_program_address(
                    &[b"card", &team_seed, card_route.as_bytes()],
                    &program_id,
                )
                .0;
                let mut data = vec![1, line.len() as u8];
                data.extend_from_slice(line.as_bytes());
                data.push(station.len() as u8);
                data.extend_from_slice(station.as_bytes());
                Instruction {
                    program_id,
                    accounts: vec![
                        AccountMeta::new(passenger.pubkey(), true),
                        AccountMeta::new(transit, false),
                        AccountMeta::new_readonly(card, false),
                    ],
                    data,
                }
            }
            Action::Arrive => Instruction {
                program_id,
                accounts: vec![
                    AccountMeta::new(passenger.pubkey(), true),
                    AccountMeta::new(transit, false),
                ],
                data: vec![2],
            },
        };
        send(&mut svm, &passenger, instruction)
            .with_context(|| format!("action {} was rejected", executed + 1))?;
        executed += 1;
    }

    let transit_account = svm
        .get_account(&transit)
        .ok_or_else(|| anyhow!("transit account disappeared"))?;
    let red_line_card =
        Address::find_program_address(&[b"card", &team_seed, b"red", b"terminus"], &program_id).0;
    let red_line_open = transit_account.data.get(72) == Some(&1);
    let arrived = transit_account.data.get(73) == Some(&1);
    Ok(ReplayOutput {
        team_id: input.team_id.clone(),
        program_id: program_id.to_string(),
        program_sha256,
        passenger: passenger.pubkey().to_string(),
        transit: transit.to_string(),
        cards,
        red_line_card: red_line_card.to_string(),
        red_line_open,
        arrived,
        solved: red_line_open && arrived,
        executed_transactions: executed,
    })
}

fn send(svm: &mut LiteSVM, passenger: &Keypair, instruction: Instruction) -> Result<()> {
    svm.expire_blockhash();
    let message = Message::new(&[instruction], Some(&passenger.pubkey()));
    let tx = Transaction::new(&[passenger], message, svm.latest_blockhash());
    svm.send_transaction(tx)
        .map_err(|error| anyhow!("native SBF transaction failed: {error:?}"))?;
    Ok(())
}

fn deterministic_keypair(team_id: &str) -> Result<Keypair> {
    let mut hasher = Sha256::new();
    hasher.update(b"ctf26-last-stop-passenger-v1");
    hasher.update(team_id.as_bytes());
    Ok(Keypair::new_from_array(hasher.finalize().into()))
}

fn validate_team_id(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        bail!("invalid team id");
    }
    Ok(())
}

fn validate_word(value: &str) -> Result<()> {
    if value.is_empty() || value.len() > 24 || !value.bytes().all(|b| b.is_ascii_lowercase()) {
        bail!("route words use 1-24 lowercase ASCII letters");
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(ALPHABET[(byte >> 4) as usize] as char);
        output.push(ALPHABET[(byte & 0xf) as usize] as char);
    }
    output
}
