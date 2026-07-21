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
            participant_id: "participant-test".into(),
            actions: vec![
                Action::Buy {
                    route: "redterminus".into(),
                },
                Action::Enter {
                    line: "red".into(),
                    station: "terminus".into(),
                    card_route: "redterminus".into(),
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
            participant_id: "participant-test".into(),
            actions: vec![
                Action::Buy {
                    route: "red".into(),
                },
                Action::Enter {
                    line: "red".into(),
                    station: "terminus".into(),
                    card_route: "red".into(),
                },
            ],
        },
    )
    .unwrap_err();
    assert!(error.to_string().contains("action 2 was rejected"));
}

#[test]
fn redline_route_does_not_open_red_terminus_gate() {
    let error = replay(
        program(),
        &ReplayInput {
            participant_id: "participant-test".into(),
            actions: vec![
                Action::Buy {
                    route: "redline".into(),
                },
                Action::Enter {
                    line: "red".into(),
                    station: "terminus".into(),
                    card_route: "redline".into(),
                },
            ],
        },
    )
    .unwrap_err();
    assert!(error.to_string().contains("action 2 was rejected"));
}
