use {
    drift_harness::{
        ATTACKER_STARTING_BALANCE, MAX_TRACE_STEPS, ReplayHarness, Step, Submission,
        SubmittedAccountMeta, check_submission, default_program_path, parse_submission,
        reference_rewind_steps, replay_submission, team_config,
    },
    sha2::{Digest, Sha256},
    std::fs,
};

fn submission(team_id: &str, steps: Vec<Step>) -> Submission {
    Submission {
        team_id: team_id.to_owned(),
        steps,
    }
}

fn account(account: &str, is_signer: bool, is_writable: bool) -> SubmittedAccountMeta {
    SubmittedAccountMeta {
        account: account.to_owned(),
        is_signer,
        is_writable,
    }
}

fn invoke(data: &[u8], accounts: Vec<SubmittedAccountMeta>) -> Step {
    Step::Invoke {
        data_hex: data.iter().map(|byte| format!("{byte:02x}")).collect(),
        accounts,
    }
}

fn amount_instruction(tag: u8, amount: u64, accounts: Vec<SubmittedAccountMeta>) -> Step {
    let mut data = vec![tag];
    data.extend_from_slice(&amount.to_le_bytes());
    invoke(&data, accounts)
}

#[test]
fn checker_executes_the_exact_real_elf() {
    let path = default_program_path();
    let bytes = fs::read(&path).expect("build SBF artifact before native tests");
    assert_eq!(&bytes[..4], b"\x7fELF");
    assert!(bytes.len() > 10_000);

    let result = replay_submission(
        &path,
        &submission(
            "native-elf",
            vec![invoke(
                &[1],
                vec![
                    account("position", false, true),
                    account("SysvarC1ock11111111111111111111111111111111", false, false),
                ],
            )],
        ),
    )
    .unwrap();
    let expected_hash = Sha256::digest(&bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    assert_eq!(result.program_sha256, expected_hash);
    assert_eq!(result.executed_transactions, 1);
}

#[test]
fn funded_deposit_withdraw_round_trip_is_not_a_solve() {
    let result = replay_submission(
        default_program_path(),
        &submission(
            "native-round-trip",
            vec![
                amount_instruction(
                    0,
                    100,
                    vec![
                        account("attacker", true, true),
                        account("vault", false, true),
                        account("position", false, true),
                        account("SysvarC1ock11111111111111111111111111111111", false, false),
                        account("11111111111111111111111111111111", false, false),
                    ],
                ),
                amount_instruction(
                    2,
                    100,
                    vec![
                        account("attacker", true, true),
                        account("vault", false, true),
                        account("position", false, true),
                    ],
                ),
            ],
        ),
    )
    .unwrap();
    assert_eq!(result.gross_deposited, "100");
    assert_eq!(result.gross_withdrawn, "100");
    assert_eq!(result.net_withdrawn, "0");
    assert_eq!(result.reserve_drain, "0");
    assert_eq!(result.attacker_profit, "0");
    assert_eq!(
        result.attacker_balance,
        ATTACKER_STARTING_BALANCE.to_string()
    );
    assert!(result.accounting_consistent);
    assert!(!result.solved);
}

#[test]
fn old_self_funding_bypass_fails_in_the_native_system_transfer() {
    let team_id = "native-old-bypass";
    let amount = team_config(team_id).reserve.to_string();
    let error = replay_submission(
        default_program_path(),
        &submission(
            team_id,
            vec![
                amount_instruction(
                    0,
                    amount.parse().unwrap(),
                    vec![
                        account("attacker", true, true),
                        account("vault", false, true),
                        account("position", false, true),
                        account("SysvarC1ock11111111111111111111111111111111", false, false),
                        account("11111111111111111111111111111111", false, false),
                    ],
                ),
                amount_instruction(
                    2,
                    amount.parse().unwrap(),
                    vec![
                        account("attacker", true, true),
                        account("vault", false, true),
                        account("position", false, true),
                    ],
                ),
            ],
        ),
    )
    .unwrap_err();
    assert!(error.to_string().contains("native SBF transaction failed"));
}

#[test]
fn rewind_underflow_exploit_solves_through_sbf_execution() {
    let team_id = "native-rewind";
    let result = ReplayHarness::new(team_id, default_program_path())
        .unwrap()
        .replay(&reference_rewind_steps(team_id))
        .unwrap();
    assert!(result.solved);
    assert!(result.accounting_consistent);
    assert_eq!(result.executed_transactions, 3);
    assert!(result.final_position_balance.parse::<u64>().unwrap() > (1_u64 << 63));
}

#[test]
fn scored_checker_requires_a_real_solve_and_a_server_secret() {
    let team_id = "native-scored";
    let solved = submission(team_id, reference_rewind_steps(team_id));
    let output = check_submission(default_program_path(), &solved, &[0x5a; 32]).unwrap();
    assert!(output.ok);
    assert!(output.flag.starts_with("CTF26{drift_"));

    let unsolved = submission(
        "native-unsolved",
        vec![invoke(
            &[1],
            vec![
                account("position", false, true),
                account("SysvarC1ock11111111111111111111111111111111", false, false),
            ],
        )],
    );
    assert!(check_submission(default_program_path(), &unsolved, &[0x5a; 32]).is_err());
    assert!(check_submission(default_program_path(), &solved, b"short").is_err());
}

#[test]
fn parser_rejects_unknown_operations_fields_and_oversized_traces() {
    assert!(
        parse_submission(br#"{"teamId":"native-parse","steps":[{"op":"set_account"}]}"#).is_err()
    );
    for semantic_op in ["deposit", "accrue", "withdraw", "set_clock"] {
        let bytes = format!(
            r#"{{"teamId":"native-parse","steps":[{{"op":"{semantic_op}"}}]}}"#
        );
        assert!(parse_submission(bytes.as_bytes()).is_err());
    }
    assert!(
        parse_submission(br#"{"teamId":"native-parse","steps":[{"op":"invoke","dataHex":"01","accounts":[],"balance":"9"}]}"#)
            .is_err()
    );
    assert!(
        parse_submission(br#"{"teamId":"native-parse","steps":[{"op":"invoke","dataHex":"0A","accounts":[{"account":"position","isSigner":false,"isWritable":true}]}]}"#)
            .is_err()
    );

    let steps = (0..=MAX_TRACE_STEPS)
        .map(|_| invoke(&[1], vec![account("position", false, true)]))
        .collect();
    let oversized = submission("native-too-many", steps);
    let bytes = serde_json::to_vec(&oversized).unwrap();
    assert!(parse_submission(&bytes).is_err());
}
