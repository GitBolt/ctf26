use {
    anyhow::{bail, Context, Result},
    last_stop_harness::{replay, ReplayInput},
    std::{
        env,
        io::{self, Read},
        path::PathBuf,
    },
};

fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "replay".to_owned());
    if args.next().is_some() || command != "replay" {
        bail!("usage: last-stop-harness replay");
    }
    let program_path = env::var_os("LAST_STOP_PROGRAM_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/last_stop_program.so")
        });
    let mut bytes = Vec::new();
    io::stdin()
        .take(65_537)
        .read_to_end(&mut bytes)
        .context("read replay JSON")?;
    if bytes.is_empty() || bytes.len() > 65_536 {
        bail!("replay input must contain at most 65536 bytes");
    }
    let input: ReplayInput = serde_json::from_slice(&bytes).context("parse replay JSON")?;
    println!("{}", serde_json::to_string(&replay(program_path, &input)?)?);
    Ok(())
}
