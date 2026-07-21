use {
    anyhow::{Context, Result, bail},
    drift_harness::{
        MAX_SUBMISSION_BYTES, ReplayHarness, Submission, check_submission, default_program_path,
        parse_submission, reference_rewind_steps,
    },
    std::{
        env,
        io::{self, Read},
        path::PathBuf,
    },
};

fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "target".to_owned());
    let program_path = env::var_os("DRIFT_PROGRAM_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(default_program_path);

    match command.as_str() {
        "target" => {
            let participant_id = args.next().unwrap_or_else(|| "participant-local".to_owned());
            reject_extra_args(args)?;
            let harness = ReplayHarness::new(&participant_id, &program_path)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&harness.metadata(&participant_id))?
            );
        }
        "demo" => {
            let participant_id = args.next().unwrap_or_else(|| "participant-local".to_owned());
            reject_extra_args(args)?;
            let steps = reference_rewind_steps(&participant_id);
            let result = ReplayHarness::new(&participant_id, &program_path)?.replay(&steps)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "participantId": participant_id,
                    "steps": steps,
                    "result": result,
                }))?
            );
        }
        "replay" => {
            reject_extra_args(args)?;
            let submission = read_submission()?;
            let result = ReplayHarness::new(&submission.participant_id, &program_path)?
                .replay(&submission.steps)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        "check" => {
            reject_extra_args(args)?;
            let submission = read_submission()?;
            let secret =
                env::var("FLAG_SECRET").context("FLAG_SECRET is required for scored checks")?;
            let output = check_submission(&program_path, &submission, secret.as_bytes())?;
            println!("{}", serde_json::to_string_pretty(&output)?);
        }
        _ => bail!("usage: drift-harness [target [PARTICIPANT]|demo [PARTICIPANT]|replay|check]"),
    }
    Ok(())
}

fn read_submission() -> Result<Submission> {
    let mut bytes = Vec::new();
    io::stdin()
        .take((MAX_SUBMISSION_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .context("read submission from stdin")?;
    parse_submission(&bytes)
}

fn reject_extra_args(mut args: impl Iterator<Item = String>) -> Result<()> {
    if args.next().is_some() {
        bail!("unexpected command arguments");
    }
    Ok(())
}
