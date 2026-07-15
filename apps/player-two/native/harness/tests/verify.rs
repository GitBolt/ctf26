use player_two_harness::{verify, VerifyInput};
use std::path::PathBuf;

fn program() -> PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/player_two_program.so") }

#[test]
fn current_twice_fails() { let result = verify(program(), &VerifyInput { team_id: "team-a".into(), first_generation: 2, second_generation: 2 }).unwrap(); assert!(!result.solved); }

#[test]
fn previous_and_current_open() { let result = verify(program(), &VerifyInput { team_id: "team-a".into(), first_generation: 2, second_generation: 1 }).unwrap(); assert!(result.solved); }
