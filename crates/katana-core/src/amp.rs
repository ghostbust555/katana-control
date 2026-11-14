//! USB MIDI connection to the amp. Incoming messages arrive on a channel.

use anyhow::{Context, Result, anyhow};
use midir::{Ignore, MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use std::sync::mpsc;
use std::time::Duration;

pub const DEFAULT_PORT: &str = "katana";

pub fn find_port<T: midir::MidiIO>(io: &T, needle: &str) -> Result<T::Port> {
    let needle = needle.to_lowercase();
    io.ports()
        .into_iter()
        .find(|p| {
            io.port_name(p)
                .map(|n| n.to_lowercase().contains(&needle))
                .unwrap_or(false)
        })
        .ok_or_else(|| anyhow!("no MIDI port matching {needle:?}"))
}

/// Names of all MIDI (input, output) ports.
pub fn port_names() -> Result<(Vec<String>, Vec<String>)> {
    let i = MidiInput::new("katana-control")?;
    let o = MidiOutput::new("katana-control")?;
    let ins = i
        .ports()
        .iter()
        .filter_map(|p| i.port_name(p).ok())
        .collect();
    let outs = o
        .ports()
        .iter()
        .filter_map(|p| o.port_name(p).ok())
        .collect();
    Ok((ins, outs))
}

pub struct Connection {
    out: MidiOutputConnection,
    _in: MidiInputConnection<()>,
    pub rx: mpsc::Receiver<Vec<u8>>,
}

impl Connection {
    pub fn open(port: &str) -> Result<Connection> {
        let (tx, rx) = mpsc::channel();
        Self::open_with(port, rx, move |msg| {
            let _ = tx.send(msg);
        })
    }

    /// Open with a custom handler for incoming messages; `rx` is stored for callers that
    /// still want `recv_timeout` (pass a dummy receiver otherwise).
    pub fn open_with(
        port: &str,
        rx: mpsc::Receiver<Vec<u8>>,
        on_message: impl Fn(Vec<u8>) + Send + 'static,
    ) -> Result<Connection> {
        let mut input = MidiInput::new("katana-control-in")?;
        input.ignore(Ignore::None); // keep SysEx
        let in_port = find_port(&input, port)?;
        let _in = input
            .connect(
                &in_port,
                "katana-in",
                move |_, msg, _| on_message(msg.to_vec()),
                (),
            )
            .map_err(|e| anyhow!("opening MIDI input: {e} (is Tone Studio still running?)"))?;
        let output = MidiOutput::new("katana-control-out")?;
        let out_port = find_port(&output, port)?;
        let out = output
            .connect(&out_port, "katana-out")
            .map_err(|e| anyhow!("opening MIDI output: {e} (is Tone Studio still running?)"))?;
        Ok(Connection { out, _in, rx })
    }

    pub fn send(&mut self, msg: &[u8]) -> Result<()> {
        self.out.send(msg).context("MIDI send")
    }

    pub fn recv_timeout(&self, timeout: Duration) -> Option<Vec<u8>> {
        self.rx.recv_timeout(timeout).ok()
    }
}
