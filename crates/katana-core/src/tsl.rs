//! BOSS Tone Studio liveset files (`.tsl`), as exported by Tone Studio's librarian and
//! BOSS Tone Exchange. The format is JSON:
//!
//! ```json
//! { "name": "My set", "formatRev": "0000", "device": "KATANA Gen3",
//!   "data": [[ { "memo": "" or { "memo": "", ... }, "paramSet": { "PATCH%COM": ["4B", "41", ...], "PATCH%AMP": [...] } } ]] }
//! ```
//!
//! Each `PATCH%<BLOCK>` array holds that block's bytes as hex strings, starting at the block's
//! address in the patch (the same layout as the amp's memory), so params decode as they do
//! when read from the amp.

use crate::schema::{Value, schema};
use anyhow::{Result, bail};
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};

pub const DEVICE: &str = "KATANA Gen3";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct File {
    #[serde(default)]
    name: String,
    #[serde(default)]
    device: String,
    #[serde(default)]
    data: Vec<Vec<RawPatch>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPatch {
    #[serde(default)]
    memo: Memo,
    #[serde(default)]
    param_set: HashMap<String, Vec<String>>,
}

/// A plain string, or `{ "memo": "...", "isToneCentralPatch": bool }` in files saved by newer
/// Tone Studio versions.
#[derive(Deserialize)]
#[serde(untagged)]
enum Memo {
    Text(String),
    Object {
        #[serde(default)]
        memo: String,
    },
}

impl Default for Memo {
    fn default() -> Self {
        Memo::Text(String::new())
    }
}

impl Memo {
    fn into_text(self) -> String {
        match self {
            Memo::Text(t) | Memo::Object { memo: t } => t,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Patch {
    /// The patch name stored in the patch (trailing padding removed).
    pub name: String,
    pub memo: String,
    /// Every non-readonly param; ones the file doesn't cover keep their defaults.
    pub values: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Liveset {
    pub name: String,
    pub patches: Vec<Patch>,
}

pub fn parse(text: &str) -> Result<Liveset> {
    let f: File = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| anyhow::anyhow!("not a Tone Studio liveset file: {e}"))?;
    if f.device != DEVICE {
        bail!(
            "this liveset is for {:?}, not the {DEVICE}; only Gen 3 files can be imported",
            if f.device.is_empty() {
                "an unknown amp"
            } else {
                &f.device
            }
        );
    }
    let s = schema();
    // Start of each block in the patch: its first param's row (rows are 128 bytes apart).
    let mut base: HashMap<&str, u32> = HashMap::new();
    for p in &s.params {
        let b = base.entry(p.block.as_str()).or_insert(u32::MAX);
        *b = (*b).min(p.offset / 128 * 128);
    }
    let defaults = s.defaults();
    let mut patches = Vec::new();
    // data[0] is the user-patch list (Tone Studio's only librarian mode for this amp).
    for raw in f.data.into_iter().next().unwrap_or_default() {
        let mut blocks: HashMap<&str, Vec<u8>> = HashMap::new();
        for (key, hex) in &raw.param_set {
            let Some(block) = key.strip_prefix("PATCH%") else {
                continue;
            };
            let bytes = hex
                .iter()
                .map(|h| u8::from_str_radix(h.trim(), 16).map(|b| b & 0x7F))
                .collect::<Result<Vec<u8>, _>>()
                .map_err(|_| anyhow::anyhow!("bad byte in block {key}"))?;
            blocks.insert(block, bytes);
        }
        let mut values = BTreeMap::new();
        for p in s.params.iter().filter(|p| !p.readonly) {
            let v = blocks.get(p.block.as_str()).and_then(|bytes| {
                let start = (p.offset - base[p.block.as_str()]) as usize;
                bytes
                    .get(start..start + p.len as usize)
                    .map(|b| p.decode(b))
            });
            if let Some(v) = v.or_else(|| defaults.get(&p.id).cloned()) {
                values.insert(p.id.clone(), v);
            }
        }
        let name = values
            .get("com.name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim_end()
            .to_string();
        patches.push(Patch {
            name,
            memo: raw.memo.into_text(),
            values,
        });
    }
    Ok(Liveset {
        name: f.name,
        patches,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a one-patch liveset from raw block bytes.
    fn file(device: &str, blocks: &[(&str, Vec<u8>)]) -> String {
        let set: serde_json::Map<String, serde_json::Value> = blocks
            .iter()
            .map(|(k, b)| {
                let hex: Vec<String> = b.iter().map(|x| format!("{x:02x}")).collect();
                (k.to_string(), serde_json::json!(hex))
            })
            .collect();
        serde_json::json!({ "name": "Set", "formatRev": "0000", "device": device,
            "data": [[{ "memo": "hi", "paramSet": set }]] })
        .to_string()
    }

    #[test]
    fn decodes_name_and_amp_gain() {
        let s = schema();
        let gain = s.get("amp.gain").unwrap();
        let amp_base = gain.offset / 128 * 128;
        let mut amp = vec![0u8; 128];
        amp[(gain.offset - amp_base) as usize] = 77;
        let mut com = b"Brown crunch    ".to_vec();
        com.resize(256, 0);
        let l = parse(&file(DEVICE, &[("PATCH%COM", com), ("PATCH%AMP", amp)])).unwrap();
        assert_eq!(l.name, "Set");
        assert_eq!(l.patches.len(), 1);
        let p = &l.patches[0];
        assert_eq!(p.name, "Brown crunch");
        assert_eq!(p.memo, "hi");
        assert_eq!(p.values["amp.gain"], gain.decode(&[77]));
        // Blocks missing from the file keep their defaults.
        assert_eq!(
            p.values["reverb1.effect_level"],
            s.defaults()["reverb1.effect_level"]
        );
    }

    #[test]
    fn rejects_other_models() {
        let e = parse(&file("KATANA MkII", &[])).unwrap_err().to_string();
        assert!(e.contains("KATANA MkII"), "{e}");
    }

    #[test]
    fn reads_object_memo() {
        let f = file(DEVICE, &[]).replace(r#""memo":"hi""#, r#""memo":{"memo":"from TC","isToneCentralPatch":true}"#);
        assert_eq!(parse(&f).unwrap().patches[0].memo, "from TC");
    }
}
