//! Pull MIDI messages out of USB packet captures (pcap / pcapng).
//!
//! Supported link types:
//!   249 USBPcap        (Windows: USBPcap + Wireshark, the main way to watch Tone Studio)
//!   220 usbmon mmapped (Linux: Wireshark on usbmonN)
//!   189 usbmon         (Linux, older 48-byte header)
//!
//! USB-MIDI traffic is a stream of 4-byte event packets: [cable<<4 | CIN, b0, b1, b2].
//! SysEx is split across packets with CIN 4 (start/continue) and CIN 5/6/7 (end with 1/2/3 bytes).

use anyhow::{bail, Context, Result};
use pcap_file::pcap::PcapReader;
use pcap_file::pcapng::{Block, PcapNgReader};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Dir {
    /// Host (Tone Studio) → amp
    ToAmp,
    /// Amp → host
    FromAmp,
}

#[derive(Debug)]
pub struct MidiEvent {
    pub index: usize,
    pub dir: Dir,
    pub device: u16,
    pub bytes: Vec<u8>,
}

struct UsbPayload<'a> {
    dir: Dir,
    device: u16,
    data: &'a [u8],
}

fn usb_payload(linktype: u32, pkt: &[u8]) -> Option<UsbPayload<'_>> {
    match linktype {
        249 => {
            // USBPCAP_BUFFER_PACKET_HEADER (little-endian, packed)
            if pkt.len() < 27 {
                return None;
            }
            let hdr_len = u16::from_le_bytes([pkt[0], pkt[1]]) as usize;
            let device = u16::from_le_bytes([pkt[19], pkt[20]]);
            let endpoint = pkt[21];
            let transfer = pkt[22];
            // 1 = interrupt, 3 = bulk. Skip isochronous audio and control.
            if transfer != 1 && transfer != 3 {
                return None;
            }
            let dir = if endpoint & 0x80 != 0 { Dir::FromAmp } else { Dir::ToAmp };
            Some(UsbPayload { dir, device, data: pkt.get(hdr_len..)? })
        }
        220 | 189 => {
            let hdr_len = if linktype == 220 { 64 } else { 48 };
            if pkt.len() < hdr_len {
                return None;
            }
            let xfer_type = pkt[9];
            if xfer_type != 1 && xfer_type != 3 {
                return None;
            }
            let dir = if pkt[10] & 0x80 != 0 { Dir::FromAmp } else { Dir::ToAmp };
            Some(UsbPayload { dir, device: pkt[11] as u16, data: &pkt[hdr_len..] })
        }
        _ => None,
    }
}

/// Reassembles USB-MIDI event packets into complete MIDI messages, per direction/device.
#[derive(Default)]
struct Reassembler {
    sysex: HashMap<(Dir, u16), Vec<u8>>,
}

impl Reassembler {
    fn feed(&mut self, dir: Dir, device: u16, data: &[u8], out: &mut Vec<(Dir, u16, Vec<u8>)>) {
        for p in data.as_chunks::<4>().0 {
            let cin = p[0] & 0x0F;
            let buf = self.sysex.entry((dir, device)).or_default();
            match cin {
                0x4 => buf.extend_from_slice(&p[1..4]),
                0x5..=0x7 => {
                    let n = (cin - 0x4) as usize;
                    // CIN 5 is also used for single-byte system common messages.
                    if buf.is_empty() && p[1] != 0xF0 && p[1] != 0xF7 {
                        out.push((dir, device, vec![p[1]]));
                        continue;
                    }
                    buf.extend_from_slice(&p[1..1 + n]);
                    out.push((dir, device, std::mem::take(buf)));
                }
                0x8..=0xB | 0xE => out.push((dir, device, p[1..4].to_vec())),
                0xC | 0xD => out.push((dir, device, p[1..3].to_vec())),
                _ => {} // 0x0 padding, 0x1 reserved, 0x2/0x3 system common, 0xF single byte
            }
        }
    }
}

pub fn read_midi_events(path: &Path) -> Result<Vec<MidiEvent>> {
    let mut f = File::open(path).with_context(|| format!("opening {}", path.display()))?;
    let mut magic = [0u8; 4];
    f.read_exact(&mut magic)?;
    f.seek(SeekFrom::Start(0))?;
    let reader = BufReader::new(f);

    let mut packets: Vec<(u32, Vec<u8>)> = Vec::new();
    if magic == [0x0A, 0x0D, 0x0D, 0x0A] {
        let mut r = PcapNgReader::new(reader)?;
        let mut linktypes: Vec<u32> = Vec::new();
        while let Some(block) = r.next_block() {
            match block? {
                Block::InterfaceDescription(idb) => linktypes.push(u32::from(idb.linktype)),
                Block::EnhancedPacket(epb) => {
                    let lt = *linktypes.get(epb.interface_id as usize).unwrap_or(&0);
                    packets.push((lt, epb.data.into_owned()));
                }
                Block::SimplePacket(spb) => {
                    let lt = *linktypes.first().unwrap_or(&0);
                    packets.push((lt, spb.data.into_owned()));
                }
                _ => {}
            }
        }
    } else {
        let mut r = PcapReader::new(reader)?;
        let lt = u32::from(r.header().datalink);
        while let Some(pkt) = r.next_packet() {
            packets.push((lt, pkt?.data.into_owned()));
        }
    }

    let linktypes: std::collections::BTreeSet<u32> = packets.iter().map(|(lt, _)| *lt).collect();
    if !linktypes.iter().any(|lt| matches!(lt, 249 | 220 | 189)) {
        bail!("no USB packets in capture (link types {linktypes:?}); capture with USBPcap or usbmon");
    }

    let mut rs = Reassembler::default();
    let mut raw = Vec::new();
    for (lt, pkt) in &packets {
        if let Some(p) = usb_payload(*lt, pkt)
            && p.data.len() % 4 == 0 {
                rs.feed(p.dir, p.device, p.data, &mut raw);
            }
    }
    Ok(raw
        .into_iter()
        .enumerate()
        .map(|(index, (dir, device, bytes))| MidiEvent { index, dir, device, bytes })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reassembles_sysex_across_packets() {
        // F0 41 00 00 00 00 33 12 7F 00 00 01 01 7F F7 as USB-MIDI packets
        let usb = [
            0x04, 0xF0, 0x41, 0x00, 0x04, 0x00, 0x00, 0x00, 0x04, 0x33, 0x12, 0x7F, 0x04, 0x00, 0x00, 0x01,
            0x07, 0x01, 0x7F, 0xF7, 0x0C, 0xC5, 0x00, 0x00,
        ];
        let mut out = Vec::new();
        Reassembler::default().feed(Dir::ToAmp, 1, &usb, &mut out);
        assert_eq!(out.len(), 2);
        assert_eq!(
            crate::roland::hex(&out[0].2),
            "F0 41 00 00 00 00 33 12 7F 00 00 01 01 7F F7"
        );
        assert_eq!(out[1].2, vec![0xC5, 0x00]); // program change, channel 6
    }
}
