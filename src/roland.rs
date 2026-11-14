//! Roland/BOSS "exclusive" SysEx: DT1 (data set) and RQ1 (data request).
//!
//! Layout:  F0 41 <dev> <model id...> <cmd> <addr x4> <data | size x4> <checksum> F7
//! The checksum covers address + data and makes their 7-bit sum come out to 0 mod 128.

use anyhow::{Result, bail};

pub const ROLAND: u8 = 0x41;
pub const CMD_RQ1: u8 = 0x11;
pub const CMD_DT1: u8 = 0x12;

/// Katana Gen 3: device id 10, model id 01 05 07.
/// MkI/MkII use device 00, model 00 00 00 33.
pub const DEFAULT_DEVICE_ID: u8 = 0x10;
pub const DEFAULT_MODEL_ID: [u8; 3] = [0x01, 0x05, 0x07];

#[derive(Clone, Debug)]
pub struct Target {
    pub device_id: u8,
    pub model_id: Vec<u8>,
}

impl Default for Target {
    fn default() -> Self {
        Target {
            device_id: DEFAULT_DEVICE_ID,
            model_id: DEFAULT_MODEL_ID.to_vec(),
        }
    }
}

pub fn checksum(bytes: &[u8]) -> u8 {
    let sum: u32 = bytes.iter().map(|&b| b as u32).sum();
    ((128 - (sum % 128)) % 128) as u8
}

fn build(t: &Target, cmd: u8, body: &[u8]) -> Vec<u8> {
    let mut m = vec![0xF0, ROLAND, t.device_id];
    m.extend_from_slice(&t.model_id);
    m.push(cmd);
    m.extend_from_slice(body);
    m.push(checksum(body));
    m.push(0xF7);
    m
}

pub fn dt1(t: &Target, addr: [u8; 4], data: &[u8]) -> Vec<u8> {
    let mut body = addr.to_vec();
    body.extend_from_slice(data);
    build(t, CMD_DT1, &body)
}

pub fn rq1(t: &Target, addr: [u8; 4], size: u32) -> Vec<u8> {
    let mut body = addr.to_vec();
    body.extend_from_slice(&to_7bit4(size));
    build(t, CMD_RQ1, &body)
}

/// Universal non-realtime Identity Request (any device).
pub const IDENTITY_REQUEST: [u8; 6] = [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7];

/// A value as four 7-bit bytes, used for RQ1 sizes and address arithmetic.
pub fn to_7bit4(v: u32) -> [u8; 4] {
    [
        ((v >> 21) & 0x7F) as u8,
        ((v >> 14) & 0x7F) as u8,
        ((v >> 7) & 0x7F) as u8,
        (v & 0x7F) as u8,
    ]
}

pub fn from_7bit(bytes: &[u8]) -> u32 {
    bytes
        .iter()
        .fold(0, |acc, &b| (acc << 7) | (b & 0x7F) as u32)
}

#[derive(Debug)]
pub enum Parsed {
    Dt1 {
        device_id: u8,
        model_id: Vec<u8>,
        addr: [u8; 4],
        data: Vec<u8>,
        checksum_ok: bool,
    },
    Rq1 {
        device_id: u8,
        model_id: Vec<u8>,
        addr: [u8; 4],
        size: u32,
        checksum_ok: bool,
    },
    IdentityReply {
        manufacturer: u8,
        family: [u8; 2],
        member: [u8; 2],
        version: [u8; 4],
    },
    Other,
}

/// Parse a SysEx message. `model_len` is the model id length (4 on Katanas).
pub fn parse(msg: &[u8], model_len: usize) -> Parsed {
    if msg.len() >= 15 && msg[..5] == [0xF0, 0x7E, msg[2], 0x06, 0x02] {
        return Parsed::IdentityReply {
            manufacturer: msg[5],
            family: [msg[6], msg[7]],
            member: [msg[8], msg[9]],
            version: [msg[10], msg[11], msg[12], msg[13]],
        };
    }
    let head = 3 + model_len; // F0 41 dev model...
    if msg.len() < head + 1 + 4 + 2
        || msg[0] != 0xF0
        || msg[1] != ROLAND
        || *msg.last().unwrap() != 0xF7
    {
        return Parsed::Other;
    }
    let device_id = msg[2];
    let model_id = msg[3..head].to_vec();
    let cmd = msg[head];
    let body = &msg[head + 1..msg.len() - 2];
    let checksum_ok = checksum(body) == msg[msg.len() - 2];
    let addr = [body[0], body[1], body[2], body[3]];
    match cmd {
        CMD_DT1 => Parsed::Dt1 {
            device_id,
            model_id,
            addr,
            data: body[4..].to_vec(),
            checksum_ok,
        },
        CMD_RQ1 if body.len() == 8 => Parsed::Rq1 {
            device_id,
            model_id,
            addr,
            size: from_7bit(&body[4..8]),
            checksum_ok,
        },
        _ => Parsed::Other,
    }
}

pub fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Parse "F0 41 00", "f04100", or "0xF0,0x41" into bytes.
pub fn parse_hex(s: &str) -> Result<Vec<u8>> {
    let clean: String = s
        .replace("0x", "")
        .replace("0X", "")
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect();
    if !clean.len().is_multiple_of(2) {
        bail!("odd number of hex digits in {s:?}");
    }
    (0..clean.len())
        .step_by(2)
        .map(|i| Ok(u8::from_str_radix(&clean[i..i + 2], 16)?))
        .collect()
}

pub fn parse_addr(s: &str) -> Result<[u8; 4]> {
    let b = parse_hex(s)?;
    if b.len() != 4 || b.iter().any(|&x| x > 0x7F) {
        bail!("address must be 4 bytes, each 00-7F: {s:?}");
    }
    Ok([b[0], b[1], b[2], b[3]])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edit_mode_on_matches_known_mk2_message() {
        // F0 41 00 00 00 00 33 12 7F 00 00 01 01 7F F7 (documented by TuxKatana for the MkII)
        let mk2 = Target { device_id: 0x00, model_id: vec![0x00, 0x00, 0x00, 0x33] };
        let m = dt1(&mk2, [0x7F, 0, 0, 1], &[1]);
        assert_eq!(hex(&m), "F0 41 00 00 00 00 33 12 7F 00 00 01 01 7F F7");
    }

    #[test]
    fn gen3_edit_mode_on() {
        let m = dt1(&Target::default(), [0x7F, 0, 0, 1], &[1]);
        assert_eq!(hex(&m), "F0 41 10 01 05 07 12 7F 00 00 01 01 7F F7");
    }

    #[test]
    fn round_trip_dt1() {
        let m = dt1(&Target::default(), [0x60, 0, 0x06, 0x50], &[0x10, 0x20]);
        match parse(&m, 3) {
            Parsed::Dt1 {
                addr,
                data,
                checksum_ok,
                ..
            } => {
                assert_eq!(addr, [0x60, 0, 0x06, 0x50]);
                assert_eq!(data, vec![0x10, 0x20]);
                assert!(checksum_ok);
            }
            p => panic!("{p:?}"),
        }
    }

    #[test]
    fn rq1_size_is_7bit() {
        let m = rq1(&Target::default(), [0x60, 0, 0, 0], 200);
        match parse(&m, 3) {
            Parsed::Rq1 {
                size, checksum_ok, ..
            } => {
                assert_eq!(size, 200);
                assert!(checksum_ok);
            }
            p => panic!("{p:?}"),
        }
    }
}
