//! A live editing session with the amp: one worker thread owns the MIDI connection, runs
//! requests one at a time (read/write patch, set params, write channel) and turns DT1 messages
//! the amp sends on its own (knob turns in editor mode) into `Event::Param`.

use crate::amp::Connection;
use crate::roland::{self, Parsed, Target, from_7bit};
use crate::schema::{PATCH_BASE, Value, encode_patch, schema, stored_patch_base};
use anyhow::{Result, anyhow, bail};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant};

/// Tone Studio waits this long between messages, on top of the MIDI transmission time.
const INTERVAL: Duration = Duration::from_millis(20);
/// Largest DT1/RQ1 payload used when reading or writing a whole patch.
const CHUNK: u32 = 128;
const REPLY_TIMEOUT: Duration = Duration::from_secs(2);

const CMD_EDITOR_LEVEL: [u8; 4] = [0x7F, 0, 0, 0];
const CMD_EDITOR_MODE: [u8; 4] = [0x7F, 0, 0, 1];
const CMD_PATCH_SELECT: [u8; 4] = [0x7F, 0, 1, 0];
const CMD_PATCH_WRITE: [u8; 4] = [0x7F, 0, 1, 4];

#[derive(Clone, Debug)]
pub enum Event {
    /// A parameter changed on the amp (knob turned, channel switched...). Value in display units.
    Param {
        id: String,
        value: Value,
    },
    /// The amp switched to stored patch n (0 = PANEL, 1-4 = A1-A4, 5-8 = B1-B4), e.g. its
    /// channel buttons were pressed. The current patch now holds that patch's sound.
    PatchSelected {
        number: u16,
    },
    Disconnected {
        reason: String,
    },
}

type Reply<T> = Sender<Result<T>>;

enum Cmd {
    SetParams(Vec<(String, Value)>),
    /// Read the current patch (None) or stored patch memory n.
    ReadPatch(Option<u8>, Reply<BTreeMap<String, Value>>),
    WritePatch(BTreeMap<String, Value>, Reply<()>),
    WriteChannel(u8, BTreeMap<String, Value>, Reply<()>),
    SelectPatch(u8, Reply<()>),
    Close,
}

enum Msg {
    Midi(Vec<u8>),
    Cmd(Cmd),
}

pub struct Session {
    tx: Sender<Msg>,
    pub port: String,
}

impl Session {
    /// Connect, do Tone Studio's handshake (editor level, then editor mode on) and start the worker.
    pub fn open(port: &str, on_event: impl Fn(Event) + Send + 'static) -> Result<Session> {
        let (tx, rx) = mpsc::channel::<Msg>();
        let midi_tx = tx.clone();
        let (_unused_tx, unused_rx) = mpsc::channel();
        let conn = Connection::open_with(port, unused_rx, move |m| {
            let _ = midi_tx.send(Msg::Midi(m));
        })?;
        let mut w = Worker {
            conn,
            rx,
            pending: VecDeque::new(),
            t: Target::default(),
            on_event: Box::new(on_event),
        };
        w.handshake()?;
        thread::spawn(move || w.run());
        Ok(Session {
            tx,
            port: port.to_string(),
        })
    }

    fn call<T>(&self, make: impl FnOnce(Reply<T>) -> Cmd, timeout: Duration) -> Result<T> {
        let (rtx, rrx) = mpsc::channel();
        self.tx
            .send(Msg::Cmd(make(rtx)))
            .map_err(|_| anyhow!("amp disconnected"))?;
        rrx.recv_timeout(timeout)
            .map_err(|_| anyhow!("amp did not answer"))?
    }

    /// Send parameter values to the amp's current patch. Rapid calls are coalesced.
    pub fn set_params(&self, values: Vec<(String, Value)>) -> Result<()> {
        self.tx
            .send(Msg::Cmd(Cmd::SetParams(values)))
            .map_err(|_| anyhow!("amp disconnected"))
    }

    /// Read every parameter of the amp's current patch.
    pub fn read_patch(&self) -> Result<BTreeMap<String, Value>> {
        self.call(|r| Cmd::ReadPatch(None, r), Duration::from_secs(60))
    }

    /// Read the patch stored in channel memory `patch` (1 = A1 ... 8 = B4) without loading it.
    pub fn read_channel(&self, patch: u8) -> Result<BTreeMap<String, Value>> {
        self.call(|r| Cmd::ReadPatch(Some(patch), r), Duration::from_secs(60))
    }

    /// Replace the amp's current patch (not saved to a channel).
    pub fn write_patch(&self, values: BTreeMap<String, Value>) -> Result<()> {
        self.call(|r| Cmd::WritePatch(values, r), Duration::from_secs(60))
    }

    /// Switch the amp to stored patch n (0 = PANEL, 1 = A1 ... 8 = B4), like its channel buttons.
    pub fn select_patch(&self, patch: u8) -> Result<()> {
        self.call(|r| Cmd::SelectPatch(patch, r), Duration::from_secs(5))
    }

    /// Load `values` into the current patch, then store it in channel memory `patch` (1 = A1 ... 8 = B4).
    pub fn write_channel(&self, patch: u8, values: BTreeMap<String, Value>) -> Result<()> {
        self.call(
            |r| Cmd::WriteChannel(patch, values, r),
            Duration::from_secs(60),
        )
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.tx.send(Msg::Cmd(Cmd::Close));
    }
}

struct Worker {
    conn: Connection,
    rx: Receiver<Msg>,
    /// Commands that arrived while a request was waiting for the amp.
    pending: VecDeque<Cmd>,
    t: Target,
    on_event: Box<dyn Fn(Event) + Send>,
}

impl Worker {
    fn send(&mut self, msg: &[u8]) -> Result<()> {
        self.conn.send(msg)?;
        // MIDI runs at 3125 bytes/s; give the amp time to take it in.
        thread::sleep(Duration::from_micros(msg.len() as u64 * 320) + INTERVAL);
        Ok(())
    }

    /// Wait for a DT1 at `addr`, handling anything else that arrives meanwhile.
    fn wait_dt1(&mut self, addr: [u8; 4], timeout: Duration) -> Result<Vec<u8>> {
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match self.rx.recv_timeout(left) {
                Ok(Msg::Midi(m)) => {
                    if let Parsed::Dt1 { addr: a, data, .. } =
                        roland::parse(&m, self.t.model_id.len())
                        && a == addr
                    {
                        return Ok(data);
                    }
                    self.unsolicited(&m);
                }
                Ok(Msg::Cmd(c)) => self.pending.push_back(c),
                Err(RecvTimeoutError::Timeout) => bail!("no reply from amp"),
                Err(RecvTimeoutError::Disconnected) => bail!("session closed"),
            }
        }
    }

    fn handshake(&mut self) -> Result<()> {
        let rq = roland::rq1(&self.t, CMD_EDITOR_LEVEL, 1);
        self.send(&rq)?;
        let level = self
            .wait_dt1(CMD_EDITOR_LEVEL, REPLY_TIMEOUT)
            .map_err(|_| {
                anyhow!("amp did not answer; is it a KATANA Gen 3, and is Tone Studio closed?")
            })?;
        if level.first() != Some(&1) {
            bail!("unexpected editor communication level {level:?} (expected 1)");
        }
        let on = roland::dt1(&self.t, CMD_EDITOR_MODE, &[1]);
        self.send(&on)
    }

    fn run(mut self) {
        loop {
            let msg = match self.pending.pop_front() {
                Some(c) => Msg::Cmd(c),
                None => match self.rx.recv() {
                    Ok(m) => m,
                    Err(_) => return,
                },
            };
            let result = match msg {
                Msg::Midi(m) => {
                    self.unsolicited(&m);
                    Ok(())
                }
                Msg::Cmd(Cmd::Close) => {
                    let off = roland::dt1(&self.t, CMD_EDITOR_MODE, &[0]);
                    let _ = self.conn.send(&off);
                    return;
                }
                Msg::Cmd(Cmd::SetParams(v)) => self.set_params(v),
                Msg::Cmd(Cmd::ReadPatch(n, r)) => {
                    let res = self.read_patch(n.map_or(PATCH_BASE, stored_patch_base));
                    let failed = res.is_err();
                    let _ = r.send(res);
                    if failed {
                        Err(anyhow!("read failed"))
                    } else {
                        Ok(())
                    }
                }
                Msg::Cmd(Cmd::WritePatch(v, r)) => {
                    let _ = r.send(self.write_patch(&v));
                    Ok(())
                }
                Msg::Cmd(Cmd::SelectPatch(n, r)) => {
                    // Tone Studio sends this without waiting for a reply.
                    let msg = roland::dt1(&self.t, CMD_PATCH_SELECT, &[0, n]);
                    let _ = r.send(self.send(&msg));
                    Ok(())
                }
                Msg::Cmd(Cmd::WriteChannel(n, v, r)) => {
                    let res = self.write_patch(&v).and_then(|_| self.write_channel(n));
                    let _ = r.send(res);
                    Ok(())
                }
            };
            if let Err(e) = result
                && self.conn.send(&roland::IDENTITY_REQUEST).is_err()
            {
                (self.on_event)(Event::Disconnected {
                    reason: e.to_string(),
                });
                return;
            }
        }
    }

    fn set_params(&mut self, first: Vec<(String, Value)>) -> Result<()> {
        // Coalesce: keep only the latest value per param from everything already queued.
        let mut latest: HashMap<String, Value> = first.into_iter().collect();
        let mut order: Vec<String> = latest.keys().cloned().collect();
        while let Ok(m) = self.rx.try_recv() {
            match m {
                Msg::Cmd(Cmd::SetParams(v)) => {
                    for (id, val) in v {
                        if !latest.contains_key(&id) {
                            order.push(id.clone());
                        }
                        latest.insert(id, val);
                    }
                }
                Msg::Midi(m) => self.unsolicited(&m),
                Msg::Cmd(c) => self.pending.push_back(c),
            }
        }
        let s = schema();
        for id in order {
            let Some(p) = s.get(&id) else { continue };
            if p.readonly {
                continue;
            }
            let msg = roland::dt1(&self.t, p.address(), &p.encode(&latest[&id]));
            self.send(&msg)?;
        }
        Ok(())
    }

    fn read_patch(&mut self, base: u32) -> Result<BTreeMap<String, Value>> {
        let s = schema();
        let mut image: HashMap<u32, u8> = HashMap::new();
        for (start, ps) in s.runs(CHUNK) {
            let len: u32 = ps.iter().map(|p| p.len).sum();
            let addr = roland::to_7bit4(base + start);
            let rq = roland::rq1(&self.t, addr, len);
            self.send(&rq)?;
            // The amp may answer in several DT1 pieces; collect until the run is complete.
            let deadline = Instant::now() + REPLY_TIMEOUT;
            while (start..start + len).any(|o| !image.contains_key(&o)) {
                let left = deadline.saturating_duration_since(Instant::now());
                match self.rx.recv_timeout(left) {
                    Ok(Msg::Midi(m)) => {
                        if let Parsed::Dt1 { addr: a, data, .. } =
                            roland::parse(&m, self.t.model_id.len())
                        {
                            let off = from_7bit(&a).wrapping_sub(base);
                            for (i, b) in data.iter().enumerate() {
                                image.insert(off + i as u32, *b);
                            }
                        }
                    }
                    Ok(Msg::Cmd(c)) => self.pending.push_back(c),
                    Err(_) => bail!(
                        "amp stopped answering while reading the patch (at {})",
                        roland::hex(&addr)
                    ),
                }
            }
        }
        Ok(s.params
            .iter()
            .filter(|p| !p.readonly)
            .map(|p| {
                let bytes: Vec<u8> = (p.offset..p.offset + p.len).map(|o| image[&o]).collect();
                (p.id.clone(), p.decode(&bytes))
            })
            .collect())
    }

    fn write_patch(&mut self, values: &BTreeMap<String, Value>) -> Result<()> {
        for (addr, data) in encode_patch(values, CHUNK) {
            let msg = roland::dt1(&self.t, addr, &data);
            self.send(&msg)?;
        }
        Ok(())
    }

    fn write_channel(&mut self, patch: u8) -> Result<()> {
        let msg = roland::dt1(&self.t, CMD_PATCH_WRITE, &[0, patch]);
        self.send(&msg)?;
        // Tone Studio treats the amp echoing the PATCH_WRITE address as success.
        self.wait_dt1(CMD_PATCH_WRITE, Duration::from_secs(5))
            .map(|_| ())
            .map_err(|_| anyhow!("amp did not confirm the channel write"))
    }

    /// DT1 the amp sent by itself: report every patch param it covers.
    fn unsolicited(&self, m: &[u8]) {
        let Parsed::Dt1 { addr, data, .. } = roland::parse(m, self.t.model_id.len()) else {
            return;
        };
        let lin = from_7bit(&addr);
        // Tone Studio's CURRENT_PATCH_NUMBER (INTEGER2x7): sent when the amp changes patch.
        if lin == 0 && data.len() >= 2 {
            let number = (u16::from(data[0]) << 7) | u16::from(data[1]);
            (self.on_event)(Event::PatchSelected { number });
            return;
        }
        if lin < PATCH_BASE {
            return;
        }
        let off = lin - PATCH_BASE;
        for p in schema().params_in(off, data.len() as u32) {
            if p.readonly {
                continue;
            }
            let s = (p.offset - off) as usize;
            let value = p.decode(&data[s..s + p.len as usize]);
            (self.on_event)(Event::Param {
                id: p.id.clone(),
                value,
            });
        }
    }
}
