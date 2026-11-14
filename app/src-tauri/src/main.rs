// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use katana_core::amp;
use katana_core::schema::{Value, schema};
use katana_core::session::{Event, Session};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

/// Tone values in the UI are guitar-independent; the active guitar's deltas are added on the way
/// to the amp and removed on the way back.
#[derive(Default)]
struct AppState {
    session: Mutex<Option<Session>>,
    deltas: Mutex<HashMap<String, i64>>,
}

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn with_delta(deltas: &HashMap<String, i64>, id: &str, v: &Value, sign: i64) -> Value {
    match (deltas.get(id), v.as_i64(), schema().get(id)) {
        (Some(d), Some(n), Some(p)) => {
            let shifted = n + sign * d;
            // Clamp on the way out only; coming back, show what the amp value implies.
            Value::from(if sign > 0 {
                p.clamp(shifted as i32) as i64
            } else {
                shifted
            })
        }
        _ => v.clone(),
    }
}

fn to_amp(state: &AppState, values: BTreeMap<String, Value>) -> BTreeMap<String, Value> {
    let d = state.deltas.lock().unwrap();
    values
        .into_iter()
        .map(|(id, v)| {
            let e = with_delta(&d, &id, &v, 1);
            (id, e)
        })
        .collect()
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum AmpEvent {
    Param { id: String, value: Value },
    Disconnected { reason: String },
}

#[tauri::command]
fn list_ports() -> CmdResult<Vec<String>> {
    amp::port_names().map(|(_, outs)| outs).map_err(err)
}

#[tauri::command]
fn connect(app: AppHandle, state: State<AppState>, port: Option<String>) -> CmdResult<String> {
    let port = port.unwrap_or_else(|| amp::DEFAULT_PORT.to_string());
    *state.session.lock().unwrap() = None; // close any previous session first
    let handle = app.clone();
    let session = Session::open(&port, move |ev| {
        let st = handle.state::<AppState>();
        let out = match ev {
            Event::Param { id, value } => {
                let d = st.deltas.lock().unwrap();
                let v = with_delta(&d, &id, &value, -1);
                AmpEvent::Param { id, value: v }
            }
            Event::Disconnected { reason } => {
                *st.session.lock().unwrap() = None;
                AmpEvent::Disconnected { reason }
            }
        };
        let _ = handle.emit("amp-event", out);
    })
    .map_err(err)?;
    let name = session.port.clone();
    *state.session.lock().unwrap() = Some(session);
    Ok(name)
}

#[tauri::command]
fn disconnect(state: State<AppState>) {
    *state.session.lock().unwrap() = None;
}

fn session<'a>(
    state: &'a State<AppState>,
) -> CmdResult<std::sync::MutexGuard<'a, Option<Session>>> {
    let g = state.session.lock().unwrap();
    if g.is_none() {
        return Err("amp not connected".into());
    }
    Ok(g)
}

#[tauri::command]
fn set_params(state: State<AppState>, values: BTreeMap<String, Value>) -> CmdResult<()> {
    let v = to_amp(&state, values);
    session(&state)?
        .as_ref()
        .unwrap()
        .set_params(v.into_iter().collect())
        .map_err(err)
}

#[tauri::command]
async fn read_patch(app: AppHandle) -> CmdResult<BTreeMap<String, Value>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let raw = session(&state)?
            .as_ref()
            .unwrap()
            .read_patch()
            .map_err(err)?;
        let d = state.deltas.lock().unwrap();
        Ok(raw
            .into_iter()
            .map(|(id, v)| {
                let t = with_delta(&d, &id, &v, -1);
                (id, t)
            })
            .collect())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
async fn write_patch(app: AppHandle, values: BTreeMap<String, Value>) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let v = to_amp(&state, values);
        session(&state)?
            .as_ref()
            .unwrap()
            .write_patch(v)
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
async fn write_channel(
    app: AppHandle,
    patch: u8,
    values: BTreeMap<String, Value>,
) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let v = to_amp(&state, values);
        session(&state)?
            .as_ref()
            .unwrap()
            .write_channel(patch, v)
            .map_err(err)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
fn set_deltas(state: State<AppState>, deltas: HashMap<String, i64>) {
    *state.deltas.lock().unwrap() = deltas;
}

// ---- storage: tones/<id>.json plus named documents (guitars, channels, settings) ----

fn data_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    let dir = app.path().app_data_dir().map_err(err)?;
    fs::create_dir_all(dir.join("tones")).map_err(err)?;
    Ok(dir)
}

fn safe_name(s: &str) -> CmdResult<&str> {
    if s.is_empty()
        || !s
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("bad name {s:?}"));
    }
    Ok(s)
}

#[tauri::command]
fn list_tones(app: AppHandle) -> CmdResult<Vec<Value>> {
    let mut out = Vec::new();
    for e in fs::read_dir(data_dir(&app)?.join("tones")).map_err(err)? {
        let path = e.map_err(err)?.path();
        if path.extension().is_some_and(|x| x == "json")
            && let Ok(v) = fs::read_to_string(&path)
                .map_err(err)
                .and_then(|s| serde_json::from_str(&s).map_err(err))
        {
            out.push(v);
        }
    }
    Ok(out)
}

fn write_atomic(path: PathBuf, value: &Value) -> CmdResult<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(value).map_err(err)?).map_err(err)?;
    fs::rename(&tmp, &path).map_err(err)
}

#[tauri::command]
fn save_tone(app: AppHandle, tone: Value) -> CmdResult<()> {
    let id = tone
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("tone has no id")?;
    write_atomic(
        data_dir(&app)?
            .join("tones")
            .join(format!("{}.json", safe_name(id)?)),
        &tone,
    )
}

#[tauri::command]
fn delete_tone(app: AppHandle, id: String) -> CmdResult<()> {
    fs::remove_file(
        data_dir(&app)?
            .join("tones")
            .join(format!("{}.json", safe_name(&id)?)),
    )
    .map_err(err)
}

#[tauri::command]
fn load_doc(app: AppHandle, name: String) -> CmdResult<Option<Value>> {
    let path = data_dir(&app)?.join(format!("{}.json", safe_name(&name)?));
    match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map(Some).map_err(err),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
fn save_doc(app: AppHandle, name: String, value: Value) -> CmdResult<()> {
    write_atomic(
        data_dir(&app)?.join(format!("{}.json", safe_name(&name)?)),
        &value,
    )
}

#[tauri::command]
fn data_folder(app: AppHandle) -> CmdResult<String> {
    Ok(data_dir(&app)?.display().to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            list_ports,
            connect,
            disconnect,
            set_params,
            read_patch,
            write_patch,
            write_channel,
            set_deltas,
            list_tones,
            save_tone,
            delete_tone,
            load_doc,
            save_doc,
            data_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Katana Studio");
}
