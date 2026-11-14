// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use katana_core::amp;
use katana_core::schema::{Value, schema};
use katana_core::session::{Event, Session};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

mod web;

// ---- log: logs\<unix time>-studio.log next to the exe (on the share when run from there) ----

static LOG: OnceLock<Mutex<fs::File>> = OnceLock::new();
static START: OnceLock<Instant> = OnceLock::new();

fn init_log() {
    START.get_or_init(Instant::now);
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dir = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.join("logs")));
    if let Some(dir) = dir
        && fs::create_dir_all(&dir).is_ok()
        && let Ok(f) = fs::File::create(dir.join(format!("{secs}-studio.log")))
    {
        let _ = LOG.set(Mutex::new(f));
        log(&format!(
            "Katana Studio {} started (unix {secs})",
            env!("CARGO_PKG_VERSION")
        ));
    }
}

fn log(line: &str) {
    if let Some(f) = LOG.get() {
        let t = START
            .get()
            .map(|s| s.elapsed().as_secs_f64())
            .unwrap_or(0.0);
        let _ = writeln!(f.lock().unwrap(), "[{t:9.3}] {line}");
    }
}

#[tauri::command]
fn log_line(line: String) {
    log(&line);
}

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
    PatchSelected { number: u16 },
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
            Event::PatchSelected { number } => {
                log(&format!("amp selected patch {number}"));
                AmpEvent::PatchSelected { number }
            }
            Event::Disconnected { reason } => {
                log(&format!("amp disconnected: {reason}"));
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
async fn read_channel(app: AppHandle, patch: u8) -> CmdResult<BTreeMap<String, Value>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let raw = session(&state)?
            .as_ref()
            .unwrap()
            .read_channel(patch)
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
async fn current_patch(app: AppHandle) -> CmdResult<u16> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        session(&state)?
            .as_ref()
            .unwrap()
            .current_patch()
            .map_err(err)
    })
    .await
    .map_err(err)?
}

/// Decode a Tone Studio `.tsl` liveset (file text) into tones' values.
#[tauri::command]
fn import_tsl(text: String) -> CmdResult<katana_core::tsl::Liveset> {
    katana_core::tsl::parse(&text).map_err(err)
}

#[tauri::command]
fn select_patch(state: State<AppState>, patch: u8) -> CmdResult<()> {
    session(&state)?
        .as_ref()
        .unwrap()
        .select_patch(patch)
        .map_err(err)
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

/// HTTP request for AI Studio's web tools; public hosts only (see web.rs).
#[tauri::command]
async fn http_request(
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> CmdResult<web::Fetched> {
    web::request(url, method, headers, body).await
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
    init_log();
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            http_request,
            list_ports,
            connect,
            disconnect,
            set_params,
            read_patch,
            read_channel,
            write_patch,
            write_channel,
            select_patch,
            current_patch,
            import_tsl,
            set_deltas,
            list_tones,
            save_tone,
            delete_tone,
            load_doc,
            save_doc,
            data_folder,
            log_line
        ])
        .run(tauri::generate_context!())
        .expect("error while running Katana Studio");
}
