use {
    anyhow::{Context, Result, anyhow, bail},
    base64::{Engine as _, engine::general_purpose::STANDARD as BASE64},
    hmac::{Hmac, Mac},
    litesvm::LiteSVM,
    serde::{Deserialize, Serialize},
    sha2::{Digest, Sha256},
    solana_account::Account,
    solana_address::Address,
    solana_clock::Clock,
    solana_instruction::{Instruction, account_meta::AccountMeta},
    solana_keypair::Keypair,
    solana_message::Message,
    solana_sdk_ids::{system_program, sysvar::clock as clock_sysvar},
    solana_signer::Signer,
    solana_transaction::Transaction,
    std::{
        fs,
        path::{Path, PathBuf},
        str::FromStr,
    },
};

pub const MAX_TRACE_STEPS: usize = 32;
pub const MAX_SUBMISSION_BYTES: usize = 64 * 1024;
pub const ATTACKER_STARTING_BALANCE: u64 = 1_000;
pub const INITIAL_CLOCK: i64 = 1_700_000_000;
pub const MAX_INSTRUCTION_DATA_BYTES: usize = 1_024;
pub const MAX_INSTRUCTION_ACCOUNTS: usize = 16;
pub const MAX_SYSVAR_DATA_BYTES: usize = 4_096;

const VAULT_LEN: usize = 16;
const POSITION_LEN: usize = 104;
const VAULT_MAGIC: [u8; 8] = [0x71, 0x26, 0x93, 0x4d, 0xc8, 0x15, 0xae, 0x30];
const POSITION_MAGIC: [u8; 8] = [0xb4, 0x5f, 0x08, 0xe1, 0x62, 0x9a, 0x37, 0xcd];
const PROGRAM_ID_BYTES: [u8; 32] = [
    0x6f, 0x76, 0x65, 0x72, 0x63, 0x6c, 0x6f, 0x63, 0x6b, 0x2d, 0x73, 0x62, 0x66, 0x2d, 0x76, 0x31,
    0x91, 0x0d, 0x44, 0x82, 0xa7, 0x36, 0xfe, 0x15, 0x28, 0xbc, 0x50, 0xe9, 0x73, 0x11, 0xd4, 0x6a,
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SubmittedAccountMeta {
    pub account: String,
    pub is_signer: bool,
    pub is_writable: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Step {
    Invoke {
        #[serde(rename = "dataHex")]
        data_hex: String,
        accounts: Vec<SubmittedAccountMeta>,
    },
    SetSysvar {
        address: String,
        #[serde(rename = "dataBase64")]
        data_base64: String,
    },
}

impl<'de> Deserialize<'de> for Step {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct RawStep {
            op: String,
            #[serde(rename = "dataHex")]
            data_hex: Option<String>,
            accounts: Option<Vec<SubmittedAccountMeta>>,
            address: Option<String>,
            #[serde(rename = "dataBase64")]
            data_base64: Option<String>,
        }

        let raw = RawStep::deserialize(deserializer)?;
        match (
            raw.op.as_str(),
            raw.data_hex,
            raw.accounts,
            raw.address,
            raw.data_base64,
        ) {
            ("invoke", Some(data_hex), Some(accounts), None, None) => {
                Ok(Step::Invoke { data_hex, accounts })
            }
            ("set_sysvar", None, None, Some(address), Some(data_base64)) => Ok(Step::SetSysvar {
                address,
                data_base64,
            }),
            _ => Err(serde::de::Error::custom(
                "unknown operation or invalid operation fields",
            )),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Submission {
    #[serde(rename = "participantId")]
    pub participant_id: String,
    pub steps: Vec<Step>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayResult {
    pub program_id: String,
    pub program_sha256: String,
    pub initial_reserve: String,
    pub reserve: String,
    pub reserve_drain: String,
    pub attacker_starting_balance: String,
    pub attacker_balance: String,
    pub attacker_profit: String,
    pub gross_deposited: String,
    pub gross_withdrawn: String,
    pub net_withdrawn: String,
    pub threshold: String,
    pub final_position_balance: String,
    pub accounting_consistent: bool,
    pub solved: bool,
    pub executed_transactions: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetMetadata {
    pub participant_id: String,
    pub program_id: String,
    pub program_sha256: String,
    pub execution: &'static str,
    pub exact_replay_ready: bool,
    pub production_ready: bool,
    pub rate: String,
    pub reserve: String,
    pub threshold: String,
    pub attacker_starting_balance: String,
    pub max_trace_steps: usize,
}

#[derive(Debug, Serialize)]
pub struct CheckOutput {
    pub ok: bool,
    pub flag: String,
    pub result: ReplayResult,
}

#[derive(Clone, Copy, Debug)]
pub struct ParticipantConfig {
    pub rate: u64,
    pub reserve: u64,
    pub threshold: u64,
}

#[derive(Clone, Debug)]
enum ValidatedStep {
    Invoke {
        data: Vec<u8>,
        accounts: Vec<SubmittedAccountMeta>,
    },
    SetSysvar {
        address: Address,
        data: Vec<u8>,
    },
}

pub struct ReplayHarness {
    svm: LiteSVM,
    program_id: Address,
    program_sha256: String,
    fee_payer: Keypair,
    attacker: Keypair,
    vault: Address,
    position: Address,
    vault_rent_floor: u64,
    attacker_rent_floor: u64,
    config: ParticipantConfig,
    gross_deposited: u128,
    gross_withdrawn: u128,
    executed_transactions: usize,
}

impl ReplayHarness {
    pub fn new(participant_id: &str, program_path: impl AsRef<Path>) -> Result<Self> {
        validate_participant_id(participant_id)?;
        let config = participant_config(participant_id);
        let program_bytes = fs::read(program_path.as_ref())
            .with_context(|| format!("read SBF artifact {}", program_path.as_ref().display()))?;
        validate_elf(&program_bytes)?;
        let program_sha256 = hex(&Sha256::digest(&program_bytes));
        let program_id = Address::new_from_array(PROGRAM_ID_BYTES);

        let mut svm = LiteSVM::new();
        // Load exactly the bytes that are hashed and reported in every replay result.
        svm.add_program(program_id, &program_bytes)
            .map_err(|error| anyhow!("load SBF artifact into LiteSVM: {error}"))?;

        let fee_payer = Keypair::new();
        let attacker = Keypair::new();
        svm.airdrop(&fee_payer.pubkey(), 1_000_000_000)
            .map_err(|error| anyhow!("fund fee payer: {error:?}"))?;
        let attacker_rent_floor = svm.minimum_balance_for_rent_exemption(0);
        svm.airdrop(
            &attacker.pubkey(),
            attacker_rent_floor
                .checked_add(ATTACKER_STARTING_BALANCE)
                .ok_or_else(|| anyhow!("attacker funding overflow"))?,
        )
        .map_err(|error| anyhow!("fund attacker: {error:?}"))?;

        let vault = Address::new_unique();
        let position = Address::new_unique();
        let vault_rent_floor = svm.minimum_balance_for_rent_exemption(VAULT_LEN);
        let position_rent_floor = svm.minimum_balance_for_rent_exemption(POSITION_LEN);

        let mut vault_data = vec![0_u8; VAULT_LEN];
        vault_data[..8].copy_from_slice(&VAULT_MAGIC);
        vault_data[8..16].copy_from_slice(&vault_rent_floor.to_le_bytes());
        svm.set_account(
            vault,
            Account {
                lamports: vault_rent_floor
                    .checked_add(config.reserve)
                    .ok_or_else(|| anyhow!("vault funding overflow"))?,
                data: vault_data,
                owner: program_id,
                ..Account::default()
            },
        )
        .map_err(|error| anyhow!("seed vault account: {error}"))?;

        let mut position_data = vec![0_u8; POSITION_LEN];
        position_data[..8].copy_from_slice(&POSITION_MAGIC);
        position_data[8..40].copy_from_slice(attacker.pubkey().as_ref());
        position_data[40..72].copy_from_slice(vault.as_ref());
        position_data[96..104].copy_from_slice(&config.rate.to_le_bytes());
        svm.set_account(
            position,
            Account {
                lamports: position_rent_floor,
                data: position_data,
                owner: program_id,
                ..Account::default()
            },
        )
        .map_err(|error| anyhow!("seed position account: {error}"))?;

        let mut clock = svm.get_sysvar::<Clock>();
        clock.unix_timestamp = INITIAL_CLOCK;
        svm.set_sysvar::<Clock>(&clock);

        Ok(Self {
            svm,
            program_id,
            program_sha256,
            fee_payer,
            attacker,
            vault,
            position,
            vault_rent_floor,
            attacker_rent_floor,
            config,
            gross_deposited: 0,
            gross_withdrawn: 0,
            executed_transactions: 0,
        })
    }

    pub fn replay(mut self, steps: &[Step]) -> Result<ReplayResult> {
        let validated = validate_steps(steps)?;
        for step in validated {
            match step {
                ValidatedStep::Invoke { data, accounts } => self.invoke(data, &accounts)?,
                ValidatedStep::SetSysvar { address, data } => self.set_sysvar(address, &data)?,
            }
        }
        self.result()
    }

    pub fn metadata(&self, participant_id: &str) -> TargetMetadata {
        TargetMetadata {
            participant_id: participant_id.to_owned(),
            program_id: self.program_id.to_string(),
            program_sha256: self.program_sha256.clone(),
            execution: "litesvm-exact-sbf",
            exact_replay_ready: true,
            production_ready: true,
            rate: self.config.rate.to_string(),
            reserve: self.config.reserve.to_string(),
            threshold: self.config.threshold.to_string(),
            attacker_starting_balance: ATTACKER_STARTING_BALANCE.to_string(),
            max_trace_steps: MAX_TRACE_STEPS,
        }
    }

    fn invoke(&mut self, data: Vec<u8>, accounts: &[SubmittedAccountMeta]) -> Result<()> {
        let attacker_before = self
            .svm
            .get_balance(&self.attacker.pubkey())
            .ok_or_else(|| anyhow!("attacker account disappeared"))?;
        let mut attacker_signs = false;
        let accounts = accounts
            .iter()
            .map(|meta| {
                let address = match meta.account.as_str() {
                    "attacker" => self.attacker.pubkey(),
                    "vault" => self.vault,
                    "position" => self.position,
                    value => Address::from_str(value)
                        .with_context(|| format!("invalid account address {value}"))?,
                };
                if meta.is_signer {
                    if address != self.attacker.pubkey() {
                        bail!("only the attacker alias may sign an invocation");
                    }
                    attacker_signs = true;
                }
                Ok(if meta.is_writable {
                    AccountMeta::new(address, meta.is_signer)
                } else {
                    AccountMeta::new_readonly(address, meta.is_signer)
                })
            })
            .collect::<Result<Vec<_>>>()?;
        self.send(
            Instruction {
                program_id: self.program_id,
                accounts,
                data,
            },
            attacker_signs,
        )?;
        let attacker_after = self
            .svm
            .get_balance(&self.attacker.pubkey())
            .ok_or_else(|| anyhow!("attacker account disappeared"))?;
        if attacker_after > attacker_before {
            self.gross_withdrawn += u128::from(attacker_after - attacker_before);
        } else {
            self.gross_deposited += u128::from(attacker_before - attacker_after);
        }
        Ok(())
    }

    fn send(&mut self, instruction: Instruction, attacker_signs: bool) -> Result<()> {
        self.svm.expire_blockhash();
        let blockhash = self.svm.latest_blockhash();
        let message = Message::new(&[instruction], Some(&self.fee_payer.pubkey()));
        let transaction = if attacker_signs {
            Transaction::new(&[&self.fee_payer, &self.attacker], message, blockhash)
        } else {
            Transaction::new(&[&self.fee_payer], message, blockhash)
        };
        self.svm
            .send_transaction(transaction)
            .map_err(|error| anyhow!("native SBF transaction failed: {error:?}"))?;
        self.executed_transactions += 1;
        Ok(())
    }

    fn set_sysvar(&mut self, address: Address, data: &[u8]) -> Result<()> {
        if address != clock_sysvar::id() {
            bail!("unsupported sysvar address");
        }
        let value: Clock = bincode::deserialize(data).context("decode canonical sysvar bytes")?;
        let canonical = bincode::serialize(&value).context("encode canonical sysvar bytes")?;
        if canonical != data {
            bail!("sysvar bytes are not canonical");
        }
        self.svm.set_sysvar::<Clock>(&value);
        Ok(())
    }

    fn result(self) -> Result<ReplayResult> {
        let vault_account = self
            .svm
            .get_account(&self.vault)
            .ok_or_else(|| anyhow!("vault account disappeared"))?;
        let position_account = self
            .svm
            .get_account(&self.position)
            .ok_or_else(|| anyhow!("position account disappeared"))?;
        let attacker_lamports = self
            .svm
            .get_balance(&self.attacker.pubkey())
            .ok_or_else(|| anyhow!("attacker account disappeared"))?;
        let attacker_balance = attacker_lamports
            .checked_sub(self.attacker_rent_floor)
            .ok_or_else(|| anyhow!("attacker fell below its committed rent floor"))?;
        let reserve = vault_account
            .lamports
            .checked_sub(self.vault_rent_floor)
            .ok_or_else(|| anyhow!("vault fell below its committed rent floor"))?;
        let reserve_drain = self.config.reserve.saturating_sub(reserve);
        let attacker_profit = i128::from(attacker_balance) - i128::from(ATTACKER_STARTING_BALANCE);
        let net_withdrawn = i128::try_from(self.gross_withdrawn)
            .and_then(|withdrawn| {
                i128::try_from(self.gross_deposited).map(|deposited| withdrawn - deposited)
            })
            .map_err(|_| anyhow!("trace accounting overflow"))?;
        let final_position_balance = read_u64(&position_account.data, 80)?;
        let conserved_value = reserve
            .checked_add(attacker_balance)
            .ok_or_else(|| anyhow!("conservation check overflow"))?;
        let initial_value = self
            .config
            .reserve
            .checked_add(ATTACKER_STARTING_BALANCE)
            .ok_or_else(|| anyhow!("initial accounting overflow"))?;
        let accounting_consistent = conserved_value == initial_value
            && net_withdrawn == attacker_profit
            && attacker_profit == i128::from(reserve_drain);
        let solved = accounting_consistent
            && reserve_drain >= self.config.threshold
            && attacker_profit >= i128::from(self.config.threshold)
            && net_withdrawn >= i128::from(self.config.threshold);

        Ok(ReplayResult {
            program_id: self.program_id.to_string(),
            program_sha256: self.program_sha256,
            initial_reserve: self.config.reserve.to_string(),
            reserve: reserve.to_string(),
            reserve_drain: reserve_drain.to_string(),
            attacker_starting_balance: ATTACKER_STARTING_BALANCE.to_string(),
            attacker_balance: attacker_balance.to_string(),
            attacker_profit: attacker_profit.to_string(),
            gross_deposited: self.gross_deposited.to_string(),
            gross_withdrawn: self.gross_withdrawn.to_string(),
            net_withdrawn: net_withdrawn.to_string(),
            threshold: self.config.threshold.to_string(),
            final_position_balance: final_position_balance.to_string(),
            accounting_consistent,
            solved,
            executed_transactions: self.executed_transactions,
        })
    }
}

pub fn default_program_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../player-kit/dist/drift_vault.so")
}

pub fn parse_submission(bytes: &[u8]) -> Result<Submission> {
    if bytes.is_empty() {
        bail!("submission must not be empty");
    }
    if bytes.len() > MAX_SUBMISSION_BYTES {
        bail!("submission exceeds {MAX_SUBMISSION_BYTES} bytes");
    }
    let submission: Submission = serde_json::from_slice(bytes).context("parse submission JSON")?;
    validate_participant_id(&submission.participant_id)?;
    validate_steps(&submission.steps)?;
    Ok(submission)
}

pub fn replay_submission(
    program_path: impl AsRef<Path>,
    submission: &Submission,
) -> Result<ReplayResult> {
    ReplayHarness::new(&submission.participant_id, program_path)?.replay(&submission.steps)
}

pub fn check_submission(
    program_path: impl AsRef<Path>,
    submission: &Submission,
    flag_secret: &[u8],
) -> Result<CheckOutput> {
    if flag_secret.len() < 32 {
        bail!("FLAG_SECRET must contain at least 32 bytes");
    }
    let result = replay_submission(program_path, submission)?;
    if !result.solved {
        bail!("native replay did not produce enough net drain of the original reserve");
    }
    let flag = flag_for(&submission.participant_id, &result, flag_secret)?;
    Ok(CheckOutput {
        ok: true,
        flag,
        result,
    })
}

pub fn participant_config(participant_id: &str) -> ParticipantConfig {
    let digest = Sha256::digest(participant_id.as_bytes());
    let rate = u64::from(3 + digest[0] % 5);
    let reserve = 40_000 + u64::from(digest[1]) * 100;
    ParticipantConfig {
        rate,
        reserve,
        threshold: reserve - 1_000,
    }
}

pub fn reference_rewind_steps(participant_id: &str) -> Vec<Step> {
    let config = participant_config(participant_id);
    let high = INITIAL_CLOCK + 1_000_000;
    let sysvar = |unix_timestamp| {
        let mut clock = Clock::default();
        clock.unix_timestamp = unix_timestamp;
        Step::SetSysvar {
            address: clock_sysvar::id().to_string(),
            data_base64: BASE64.encode(bincode::serialize(&clock).expect("serialize Clock")),
        }
    };
    let invoke = |data: Vec<u8>, accounts: &[(&str, bool, bool)]| Step::Invoke {
        data_hex: hex(&data),
        accounts: accounts
            .iter()
            .map(|(account, is_signer, is_writable)| SubmittedAccountMeta {
                account: (*account).to_owned(),
                is_signer: *is_signer,
                is_writable: *is_writable,
            })
            .collect(),
    };
    let mut deposit = vec![0];
    deposit.extend_from_slice(&10_u64.to_le_bytes());
    let mut withdraw = vec![2];
    withdraw.extend_from_slice(&config.reserve.to_le_bytes());
    vec![
        sysvar(high),
        invoke(
            deposit,
            &[
                ("attacker", true, true),
                ("vault", false, true),
                ("position", false, true),
                (&clock_sysvar::id().to_string(), false, false),
                (&system_program::id().to_string(), false, false),
            ],
        ),
        sysvar(high - 1),
        invoke(
            vec![1],
            &[
                ("position", false, true),
                (&clock_sysvar::id().to_string(), false, false),
            ],
        ),
        invoke(
            withdraw,
            &[
                ("attacker", true, true),
                ("vault", false, true),
                ("position", false, true),
            ],
        ),
    ]
}

fn validate_steps(steps: &[Step]) -> Result<Vec<ValidatedStep>> {
    if steps.is_empty() {
        bail!("steps must not be empty");
    }
    if steps.len() > MAX_TRACE_STEPS {
        bail!("trace exceeds {MAX_TRACE_STEPS} steps");
    }
    steps
        .iter()
        .enumerate()
        .map(|(index, step)| match step {
            Step::Invoke { data_hex, accounts } => {
                if accounts.is_empty() || accounts.len() > MAX_INSTRUCTION_ACCOUNTS {
                    bail!(
                        "step {index} accounts must contain 1 to {MAX_INSTRUCTION_ACCOUNTS} entries"
                    );
                }
                for (account_index, meta) in accounts.iter().enumerate() {
                    if meta.account.is_empty() || meta.account.len() > 64 {
                        bail!(
                            "step {index} account {account_index} has an invalid account identifier"
                        );
                    }
                }
                let data = decode_hex(data_hex, index)?;
                if data.len() > MAX_INSTRUCTION_DATA_BYTES {
                    bail!(
                        "step {index} instruction data exceeds {MAX_INSTRUCTION_DATA_BYTES} bytes"
                    );
                }
                Ok(ValidatedStep::Invoke {
                    data,
                    accounts: accounts.clone(),
                })
            }
            Step::SetSysvar {
                address,
                data_base64,
            } => {
                let address = Address::from_str(address)
                    .with_context(|| format!("step {index} address is not canonical base58"))?;
                let data = BASE64
                    .decode(data_base64)
                    .with_context(|| format!("step {index} dataBase64 is invalid"))?;
                if BASE64.encode(&data) != *data_base64 {
                    bail!("step {index} dataBase64 must be canonical");
                }
                if data.len() > MAX_SYSVAR_DATA_BYTES {
                    bail!("step {index} sysvar data exceeds {MAX_SYSVAR_DATA_BYTES} bytes");
                }
                Ok(ValidatedStep::SetSysvar { address, data })
            }
        })
        .collect()
}

fn decode_hex(value: &str, index: usize) -> Result<Vec<u8>> {
    if value.len() % 2 != 0
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        bail!("step {index} dataHex must be canonical lowercase hex");
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let text = std::str::from_utf8(pair).expect("hex is ASCII");
            u8::from_str_radix(text, 16).with_context(|| format!("step {index} dataHex is invalid"))
        })
        .collect()
}

fn validate_participant_id(participant_id: &str) -> Result<()> {
    let bytes = participant_id.as_bytes();
    if bytes.is_empty()
        || bytes.len() > 128
        || !bytes[0].is_ascii_alphanumeric()
        || !bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        bail!("invalid participantId");
    }
    Ok(())
}

fn validate_elf(bytes: &[u8]) -> Result<()> {
    if bytes.len() < 64 || bytes.get(..4) != Some(b"\x7fELF") {
        bail!("program artifact is not an ELF");
    }
    Ok(())
}

fn read_u64(data: &[u8], offset: usize) -> Result<u64> {
    let bytes: [u8; 8] = data
        .get(offset..offset + 8)
        .ok_or_else(|| anyhow!("position account has invalid layout"))?
        .try_into()
        .map_err(|_| anyhow!("position account has invalid layout"))?;
    Ok(u64::from_le_bytes(bytes))
}

fn flag_for(participant_id: &str, result: &ReplayResult, secret: &[u8]) -> Result<String> {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret).map_err(|_| anyhow!("invalid flag secret"))?;
    mac.update(participant_id.as_bytes());
    mac.update(b"\0");
    mac.update(result.program_sha256.as_bytes());
    mac.update(b"\0");
    mac.update(result.reserve_drain.as_bytes());
    let digest = mac.finalize().into_bytes();
    Ok(format!("CTF26{{drift_{}}}", hex(&digest[..12])))
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(output, "{byte:02x}");
    }
    output
}
