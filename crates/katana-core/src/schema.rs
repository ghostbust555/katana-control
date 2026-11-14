//! Gen 3 parameter schema.
//!
//! Values are in display units (what Tone Studio shows); on the wire raw = value + ofs, packed per
//! the parameter's encoding.

use crate::roland;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

pub const SCHEMA_JSON: &str = include_str!("../schema/katana-gen3.json");

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Param {
    pub id: String,
    pub block: String,
    pub name: String,
    pub addr: String,
    /// Linear byte offset from the patch base (20 00 00 00).
    pub offset: u32,
    /// u7: one 7-bit byte; n2/n4: 2/4 nibbles; u14: two 7-bit bytes; ascii: text of `len` bytes.
    pub enc: String,
    pub len: u32,
    pub min: i32,
    pub max: i32,
    pub ofs: i32,
    pub init: serde_json::Value,
    pub label: String,
    #[serde(default)]
    pub options: Option<Vec<String>>,
    #[serde(default)]
    pub switch: bool,
    #[serde(default)]
    pub readonly: bool,
    #[serde(default)]
    pub unit: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Channel {
    pub key: String,
    pub patch: u8,
}

#[derive(Deserialize)]
struct SchemaFile {
    channels: Vec<Channel>,
    params: Vec<Param>,
}

pub struct Schema {
    pub params: Vec<Param>,
    pub channels: Vec<Channel>,
    by_id: HashMap<String, usize>,
    /// Patch byte offset -> param index, for decoding DT1 sent by the amp.
    by_offset: BTreeMap<u32, usize>,
}

/// A parameter value: a number in display units, or text for the patch name.
pub type Value = serde_json::Value;

pub fn schema() -> &'static Schema {
    static S: OnceLock<Schema> = OnceLock::new();
    S.get_or_init(|| {
        let f: SchemaFile = serde_json::from_str(SCHEMA_JSON).expect("embedded schema");
        let by_id = f
            .params
            .iter()
            .enumerate()
            .map(|(i, p)| (p.id.clone(), i))
            .collect();
        let by_offset = f
            .params
            .iter()
            .enumerate()
            .map(|(i, p)| (p.offset, i))
            .collect();
        Schema {
            params: f.params,
            channels: f.channels,
            by_id,
            by_offset,
        }
    })
}

pub const PATCH_BASE: u32 = 0x20 << 21; // 20 00 00 00 in linear form

impl Schema {
    pub fn get(&self, id: &str) -> Option<&Param> {
        self.by_id.get(id).map(|&i| &self.params[i])
    }

    /// Writable params grouped into runs of adjacent bytes: (start offset, params).
    /// Used to read or write a whole patch with a few large messages.
    pub fn runs(&self, max_len: u32) -> Vec<(u32, Vec<&Param>)> {
        let mut sorted: Vec<&Param> = self.params.iter().filter(|p| !p.readonly).collect();
        sorted.sort_by_key(|p| p.offset);
        let mut runs: Vec<(u32, Vec<&Param>)> = Vec::new();
        for p in sorted {
            if let Some((start, ps)) = runs.last_mut() {
                let last = ps.last().unwrap();
                if p.offset == last.offset + last.len && p.offset + p.len - *start <= max_len {
                    ps.push(p);
                    continue;
                }
            }
            runs.push((p.offset, vec![p]));
        }
        runs
    }

    /// Params whose bytes lie in [offset, offset + len), for decoding a DT1 from the amp.
    pub fn params_in(&self, offset: u32, len: u32) -> Vec<&Param> {
        // A param may start before `offset` (amp sends only part of a multi-byte value);
        // those are skipped because a partial value can't be decoded.
        self.by_offset
            .range(offset..offset + len)
            .map(|(_, &i)| &self.params[i])
            .filter(|p| p.offset + p.len <= offset + len)
            .collect()
    }

    pub fn defaults(&self) -> BTreeMap<String, Value> {
        self.params
            .iter()
            .filter(|p| !p.readonly)
            .map(|p| (p.id.clone(), p.init.clone()))
            .collect()
    }
}

impl Param {
    /// Address of this param on the amp.
    pub fn address(&self) -> [u8; 4] {
        roland::to_7bit4(PATCH_BASE + self.offset)
    }

    pub fn clamp(&self, v: i32) -> i32 {
        v.clamp(self.min, self.max)
    }

    pub fn encode(&self, value: &Value) -> Vec<u8> {
        if self.enc == "ascii" {
            let s = value.as_str().unwrap_or("");
            let mut b: Vec<u8> = s
                .bytes()
                .map(|c| if (32..=125).contains(&c) { c } else { b' ' })
                .take(self.len as usize)
                .collect();
            b.resize(self.len as usize, b' ');
            return b;
        }
        let v = self.clamp(value.as_i64().unwrap_or(self.min as i64) as i32);
        let raw = (v + self.ofs).max(0) as u32;
        match self.enc.as_str() {
            "n2" => vec![(raw >> 4 & 0xF) as u8, (raw & 0xF) as u8],
            "n4" => vec![
                (raw >> 12 & 0xF) as u8,
                (raw >> 8 & 0xF) as u8,
                (raw >> 4 & 0xF) as u8,
                (raw & 0xF) as u8,
            ],
            "u14" => vec![(raw >> 7 & 0x7F) as u8, (raw & 0x7F) as u8],
            _ => vec![(raw & 0x7F) as u8],
        }
    }

    pub fn decode(&self, bytes: &[u8]) -> Value {
        if self.enc == "ascii" {
            return Value::String(bytes.iter().map(|&b| b as char).collect());
        }
        let raw: u32 = match self.enc.as_str() {
            "n2" | "n4" => bytes.iter().fold(0, |a, &b| a << 4 | (b & 0xF) as u32),
            "u14" => bytes.iter().fold(0, |a, &b| a << 7 | (b & 0x7F) as u32),
            _ => bytes[0] as u32,
        };
        Value::from(raw as i32 - self.ofs)
    }
}

/// Encode a set of values as DT1 payloads: (address, data) per run of adjacent params.
/// Params missing from `values` are sent as their defaults so the amp gets a complete patch.
pub fn encode_patch(values: &BTreeMap<String, Value>, max_len: u32) -> Vec<([u8; 4], Vec<u8>)> {
    let s = schema();
    s.runs(max_len)
        .into_iter()
        .map(|(start, ps)| {
            let data = ps
                .iter()
                .flat_map(|p| p.encode(values.get(&p.id).unwrap_or(&p.init)))
                .collect();
            (roland::to_7bit4(PATCH_BASE + start), data)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_addresses() {
        let s = schema();
        assert_eq!(
            s.get("amp.gain").unwrap().address(),
            [0x20, 0x00, 0x06, 0x00]
        );
        assert_eq!(
            s.get("reverb1.effect_level").unwrap().address(),
            [0x20, 0x00, 0x34, 0x0A]
        );
        assert_eq!(
            s.get("sw.reverb_sw").unwrap().address(),
            [0x20, 0x00, 0x08, 0x05]
        );
    }

    #[test]
    fn encodings_round_trip() {
        let s = schema();
        for (id, v) in [
            ("booster1.bottom", -20),
            ("reverb1.time", 1),
            ("delay1.time", 1234),
            ("amp.gain", 56),
        ] {
            let p = s.get(id).unwrap();
            let b = p.encode(&Value::from(v));
            assert_eq!(b.len() as u32, p.len, "{id}");
            assert!(b.iter().all(|&x| x < 0x80), "{id}");
            assert_eq!(p.decode(&b), Value::from(v), "{id}");
        }
        let name = s.get("com.name").unwrap();
        assert_eq!(
            name.decode(&name.encode(&Value::from("Brown crunch"))),
            Value::from("Brown crunch    ")
        );
    }

    #[test]
    fn delay_time_is_nibbles() {
        // 400 ms = 0x190 -> 00 01 09 00
        let p = schema().get("delay1.time").unwrap();
        assert_eq!(p.encode(&Value::from(400)), vec![0, 1, 9, 0]);
    }

    #[test]
    fn patch_runs_cover_every_writable_param_once() {
        let s = schema();
        let n: usize = s.runs(128).iter().map(|(_, ps)| ps.len()).sum();
        assert_eq!(n, s.params.iter().filter(|p| !p.readonly).count());
        assert!(
            s.runs(128)
                .iter()
                .all(|(_, ps)| ps.iter().map(|p| p.len).sum::<u32>() <= 128)
        );
    }
}
