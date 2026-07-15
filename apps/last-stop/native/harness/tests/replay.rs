use last_stop_harness::{replay, Action, ReplayInput};
use std::path::PathBuf;

fn program() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/last_stop_program.so")
}

#[test]
fn concatenated_route_opens_segmented_gate() {
    let output = replay(
        program(),
        &ReplayInput {
            team_id: "team-test".into(),
            actions: vec![
                Action::Buy {
                    route: "redterminus".into(),
                },
                Action::Enter {
                    line: "red".into(),
                    station: "terminus".into(),
                },
                Action::Arrive,
            ],
        },
    )
    .unwrap();
    assert!(output.solved);
    assert_eq!(output.cards[0].address, output.red_line_card);
}

#[test]
fn ordinary_route_does_not_open_red_line() {
    let error = replay(
        program(),
        &ReplayInput {
            team_id: "team-test".into(),
            actions: vec![
                Action::Buy {
                    route: "red".into(),
                },
                Action::Enter {
                    line: "red".into(),
                    station: "terminus".into(),
                },
            ],
        },
    )
    .unwrap_err();
    assert!(error.to_string().contains("action 2 was rejected"));
}
