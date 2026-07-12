use {
    overclock_harness::{
        ATTACKER_STARTING_BALANCE, INITIAL_CLOCK, MAX_TRACE_STEPS, ReplayHarness, Step, Submission,
        check_submission, default_program_path, parse_submission, reference_rewind_steps,
        replay_submission, team_config,
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

#[test]
fn checker_executes_the_exact_real_elf() {
    let path = default_program_path();
    let bytes = fs::read(&path).expect("build SBF artifact before native tests");
    assert_eq!(&bytes[..4], b"\x7fELF");
    assert!(bytes.len() > 10_000);

    let result = replay_submission(&path, &submission("native-elf", vec![Step::Accrue])).unwrap();
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
                Step::Deposit {
                    amount: "100".to_owned(),
                },
                Step::Withdraw {
                    amount: "100".to_owned(),
                },
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
                Step::Deposit {
                    amount: amount.clone(),
                },
                Step::Withdraw { amount },
            ],
        ),
    )
    .unwrap_err();
    assert!(error.to_string().contains("native SBF transaction failed"));
}

#[test]
fn forward_clock_exploit_solves_through_sbf_execution() {
    let team_id = "native-forward";
    let config = team_config(team_id);
    let result = replay_submission(
        default_program_path(),
        &submission(
            team_id,
            vec![
                Step::Deposit {
                    amount: "10".to_owned(),
                },
                Step::SetClock {
                    unix_timestamp: (INITIAL_CLOCK + 1_000_000).to_string(),
                },
                Step::Accrue,
                Step::Withdraw {
                    amount: config.reserve.to_string(),
                },
            ],
        ),
    )
    .unwrap();
    assert!(result.solved);
    assert!(result.accounting_consistent);
    assert_eq!(result.reserve_drain, result.attacker_profit);
    assert_eq!(result.reserve_drain, result.net_withdrawn);
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

    let unsolved = submission("native-unsolved", vec![Step::Accrue]);
    assert!(check_submission(default_program_path(), &unsolved, &[0x5a; 32]).is_err());
    assert!(check_submission(default_program_path(), &solved, b"short").is_err());
}

#[test]
fn parser_rejects_unknown_operations_fields_and_oversized_traces() {
    assert!(
        parse_submission(br#"{"teamId":"native-parse","steps":[{"op":"set_account"}]}"#).is_err()
    );
    assert!(
        parse_submission(br#"{"teamId":"native-parse","steps":[{"op":"accrue","balance":"9"}]}"#)
            .is_err()
    );
    assert!(
        parse_submission(br#"{"teamId":"native-parse","steps":[{"op":"deposit","amount":"010"}]}"#)
            .is_err()
    );

    let steps = (0..=MAX_TRACE_STEPS).map(|_| Step::Accrue).collect();
    let oversized = submission("native-too-many", steps);
    let bytes = serde_json::to_vec(&oversized).unwrap();
    assert!(parse_submission(&bytes).is_err());
}
