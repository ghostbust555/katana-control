//! Copy of all console output to logs\<UTC timestamp>-<command>.log next to the exe,
//! so runs on a Windows PC land on the network share where they can be read back.

use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static LOG: OnceLock<Mutex<File>> = OnceLock::new();

/// Print a line to stdout and to the log file.
#[macro_export]
macro_rules! out {
    ($($t:tt)*) => {{
        let s = format!($($t)*);
        println!("{s}");
        $crate::log::write(&s);
    }};
}

/// Same as `out!` but on stderr.
#[macro_export]
macro_rules! err {
    ($($t:tt)*) => {{
        let s = format!($($t)*);
        eprintln!("{s}");
        $crate::log::write(&s);
    }};
}

pub fn init(command: &str) -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.join("logs");
    fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!("{}-{command}.log", utc_stamp()));
    let mut f = File::create(&path).ok()?;
    let args: Vec<String> = std::env::args().collect();
    writeln!(f, "$ {}", args.join(" ")).ok()?;
    LOG.set(Mutex::new(f)).ok()?;
    Some(path)
}

pub fn write(line: &str) {
    if let Some(m) = LOG.get()
        && let Ok(mut f) = m.lock()
    {
        let _ = writeln!(f, "{line}");
    }
}

/// YYYYMMDD-HHMMSS in UTC, without pulling in a date crate.
fn utc_stamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (days, rem) = ((secs / 86400) as i64, secs % 86400);
    // Howard Hinnant's civil_from_days
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}{m:02}{d:02}-{:02}{:02}{:02}",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}
