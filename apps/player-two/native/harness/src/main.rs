use anyhow::{bail, Context, Result};
use player_two_harness::{verify, VerifyInput};
use std::{env, io::{self, Read}, path::PathBuf};

fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    if args.next().as_deref().unwrap_or("verify") != "verify" || args.next().is_some() { bail!("usage: player-two-harness verify"); }
    let path = env::var_os("PLAYER_TWO_PROGRAM_PATH").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/player_two_program.so"));
    let mut bytes = Vec::new(); io::stdin().take(16_385).read_to_end(&mut bytes).context("read input")?;
    if bytes.is_empty() || bytes.len() > 16_384 { bail!("input must contain at most 16384 bytes"); }
    let input: VerifyInput = serde_json::from_slice(&bytes).context("parse input")?;
    println!("{}", serde_json::to_string(&verify(path, &input)?)?);
    Ok(())
}
