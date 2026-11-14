mod capture;
mod log;
mod roland;

use anyhow::{Context, Result, anyhow, bail};
use clap::{Parser, Subcommand};
use midir::{Ignore, MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use roland::{Parsed, Target, hex, parse, parse_addr, parse_hex};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant};

#[derive(Parser)]
#[command(about = "Talk to a BOSS Katana over USB MIDI and decode BOSS Tone Studio captures")]
struct Cli {
    /// Substring of the MIDI port name to use (case-insensitive)
    #[arg(long, global = true, default_value = "katana")]
    port: String,
    /// Roland device id byte
    #[arg(long, global = true, default_value = "00")]
    device_id: String,
    /// Roland model id bytes (4 on MkI/MkII; Gen 3 to be confirmed)
    #[arg(long, global = true, default_value = "00 00 00 33")]
    model_id: String,
    /// Don't write a log file to logs\ next to the exe
    #[arg(long, global = true)]
    no_log: bool,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// List MIDI input and output ports
    Ports,
    /// Send a universal Identity Request and print the reply
    Identify,
    /// Print every message the amp sends; turn knobs on the amp to map addresses
    Monitor {
        /// Send "editor mode on" first (7F 00 00 01 = 01) so the amp reports knob changes
        #[arg(long)]
        edit_mode: bool,
    },
    /// Send raw bytes, e.g. "F0 7E 7F 06 01 F7"; prints anything received for 1 s
    Send { hex: String },
    /// RQ1: read SIZE bytes starting at ADDR (e.g. "60 00 00 00" 32)
    Read { addr: String, size: u32 },
    /// DT1: write bytes at ADDR (e.g. "60 00 06 51" "40")
    Write { addr: String, data: String },
    /// Decode MIDI from a USBPcap/usbmon capture (.pcapng/.pcap) of Tone Studio talking to the amp
    Decode {
        capture: PathBuf,
        /// Print a table of every DT1 address seen and its last value instead of the message log
        #[arg(long)]
        summary: bool,
    },
}

fn target(cli: &Cli) -> Result<Target> {
    let dev = parse_hex(&cli.device_id)?;
    if dev.len() != 1 {
        bail!("--device-id must be one byte");
    }
    Ok(Target {
        device_id: dev[0],
        model_id: parse_hex(&cli.model_id)?,
    })
}

fn describe(msg: &[u8], model_len: usize) -> String {
    match parse(msg, model_len) {
        Parsed::Dt1 {
            device_id,
            addr,
            data,
            checksum_ok,
            model_id,
        } => format!(
            "DT1 dev {device_id:02X} model[{}] addr {}  data [{}]{}",
            hex(&model_id),
            hex(&addr),
            hex(&data),
            if checksum_ok { "" } else { "  (BAD CHECKSUM)" }
        ),
        Parsed::Rq1 {
            device_id,
            addr,
            size,
            checksum_ok,
            model_id,
        } => format!(
            "RQ1 dev {device_id:02X} model[{}] addr {}  size {}{}",
            hex(&model_id),
            hex(&addr),
            size,
            if checksum_ok { "" } else { "  (BAD CHECKSUM)" }
        ),
        Parsed::IdentityReply {
            manufacturer,
            family,
            member,
            version,
        } => format!(
            "IDENTITY manufacturer {:02X} family {} member {} version {}",
            manufacturer,
            hex(&family),
            hex(&member),
            hex(&version)
        ),
        Parsed::Other => match msg.first() {
            Some(s) if s & 0xF0 == 0xC0 => format!("PC  ch{} program {}", (s & 0x0F) + 1, msg[1]),
            Some(s) if s & 0xF0 == 0xB0 => {
                format!("CC  ch{} cc {} = {}", (s & 0x0F) + 1, msg[1], msg[2])
            }
            _ => format!("RAW {}", hex(msg)),
        },
    }
}

fn find_port<T: midir::MidiIO>(io: &T, needle: &str) -> Result<T::Port> {
    let needle = needle.to_lowercase();
    io.ports()
        .into_iter()
        .find(|p| {
            io.port_name(p)
                .map(|n| n.to_lowercase().contains(&needle))
                .unwrap_or(false)
        })
        .ok_or_else(|| anyhow!("no MIDI port matching {needle:?}; run `ports` to list them"))
}

struct Amp {
    out: MidiOutputConnection,
    _in: MidiInputConnection<()>,
    rx: mpsc::Receiver<Vec<u8>>,
}

impl Amp {
    fn open(port: &str) -> Result<Amp> {
        let mut input = MidiInput::new("katana-control-in")?;
        input.ignore(Ignore::None); // keep SysEx
        let in_port = find_port(&input, port)?;
        let (tx, rx) = mpsc::channel();
        let _in = input
            .connect(
                &in_port,
                "katana-in",
                move |_, msg, _| {
                    let _ = tx.send(msg.to_vec());
                },
                (),
            )
            .map_err(|e| anyhow!("opening MIDI input: {e} (is Tone Studio still running?)"))?;
        let output = MidiOutput::new("katana-control-out")?;
        let out_port = find_port(&output, port)?;
        let out = output
            .connect(&out_port, "katana-out")
            .map_err(|e| anyhow!("opening MIDI output: {e} (is Tone Studio still running?)"))?;
        Ok(Amp { out, _in, rx })
    }

    fn send(&mut self, msg: &[u8]) -> Result<()> {
        out!(">> {}", hex(msg));
        self.out.send(msg).context("MIDI send")
    }

    /// Print everything received until `quiet` passes with no new message.
    fn drain(&self, quiet: Duration, model_len: usize) -> Vec<Vec<u8>> {
        let mut got = Vec::new();
        while let Ok(msg) = self.rx.recv_timeout(quiet) {
            out!("<< {}\n   {}", hex(&msg), describe(&msg, model_len));
            got.push(msg);
        }
        got
    }
}

impl Cmd {
    fn name(&self) -> &'static str {
        match self {
            Cmd::Ports => "ports",
            Cmd::Identify => "identify",
            Cmd::Monitor { .. } => "monitor",
            Cmd::Send { .. } => "send",
            Cmd::Read { .. } => "read",
            Cmd::Write { .. } => "write",
            Cmd::Decode { .. } => "decode",
        }
    }
}

fn main() -> std::process::ExitCode {
    let cli = Cli::parse();
    if !cli.no_log
        && let Some(path) = log::init(cli.cmd.name())
    {
        eprintln!("logging to {}", path.display());
    }
    match run(&cli) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            err!("error: {e:#}");
            std::process::ExitCode::FAILURE
        }
    }
}

fn run(cli: &Cli) -> Result<()> {
    let t = target(cli)?;
    let ml = t.model_id.len();
    match &cli.cmd {
        Cmd::Ports => {
            let i = MidiInput::new("katana-control")?;
            let o = MidiOutput::new("katana-control")?;
            out!("inputs:");
            for p in i.ports() {
                out!("  {}", i.port_name(&p)?);
            }
            out!("outputs:");
            for p in o.ports() {
                out!("  {}", o.port_name(&p)?);
            }
        }
        Cmd::Identify => {
            let mut amp = Amp::open(&cli.port)?;
            amp.send(&roland::IDENTITY_REQUEST)?;
            if amp.drain(Duration::from_millis(1000), ml).is_empty() {
                out!("no reply");
            }
        }
        Cmd::Monitor { edit_mode } => {
            let mut amp = Amp::open(&cli.port)?;
            if *edit_mode {
                amp.send(&roland::dt1(&t, [0x7F, 0, 0, 1], &[1]))?;
            }
            out!("listening; Ctrl+C to stop");
            let start = Instant::now();
            for msg in amp.rx.iter() {
                out!(
                    "[{:8.3}] << {}\n           {}",
                    start.elapsed().as_secs_f64(),
                    hex(&msg),
                    describe(&msg, ml)
                );
            }
        }
        Cmd::Send { hex: h } => {
            let mut amp = Amp::open(&cli.port)?;
            amp.send(&parse_hex(h)?)?;
            amp.drain(Duration::from_millis(1000), ml);
        }
        Cmd::Read { addr, size } => {
            let mut amp = Amp::open(&cli.port)?;
            amp.send(&roland::rq1(&t, parse_addr(addr)?, *size))?;
            if amp.drain(Duration::from_millis(1000), ml).is_empty() {
                out!("no reply (wrong model id, or the address is not readable)");
            }
        }
        Cmd::Write { addr, data } => {
            let mut amp = Amp::open(&cli.port)?;
            amp.send(&roland::dt1(&t, parse_addr(addr)?, &parse_hex(data)?))?;
            amp.drain(Duration::from_millis(300), ml);
        }
        Cmd::Decode { capture, summary } => {
            let events = capture::read_midi_events(capture)?;
            if *summary {
                // addr -> (writes seen, last data)
                let mut seen: BTreeMap<[u8; 4], (usize, Vec<u8>)> = BTreeMap::new();
                for e in &events {
                    if let Parsed::Dt1 { addr, data, .. } = parse(&e.bytes, ml) {
                        let entry = seen.entry(addr).or_default();
                        entry.0 += 1;
                        entry.1 = data;
                    }
                }
                out!("{:<12} {:>5}  last data", "address", "count");
                for (addr, (n, data)) in seen {
                    let shown = if data.len() > 24 {
                        format!("{} ... ({} bytes)", hex(&data[..24]), data.len())
                    } else {
                        hex(&data)
                    };
                    out!("{:<12} {:>5}  {}", hex(&addr), n, shown);
                }
            } else {
                for e in &events {
                    let arrow = match e.dir {
                        capture::Dir::ToAmp => "PC ->amp",
                        capture::Dir::FromAmp => "amp-> PC",
                    };
                    out!(
                        "#{:<5} dev{:<3} {}  {}",
                        e.index,
                        e.device,
                        arrow,
                        describe(&e.bytes, ml)
                    );
                }
            }
            err!("{} MIDI messages", events.len());
        }
    }
    Ok(())
}
