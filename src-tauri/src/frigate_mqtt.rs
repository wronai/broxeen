use crate::logging::{backend_error, backend_info, backend_warn};
use rumqttc::{AsyncClient, Event, Incoming, MqttOptions, QoS};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

const FRIGATE_EVENT_NAME: &str = "broxeen:frigate_event";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrigateMqttEvent {
    pub topic: String,
    pub payload: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrigateMqttConfig {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub topic: String,
    pub client_id: Option<String>,
}

struct FrigateMqttRuntime {
    shutdown_tx: oneshot::Sender<()>,
    join_handle: JoinHandle<()>,
}

lazy_static::lazy_static! {
    static ref RUNTIME: Arc<Mutex<Option<FrigateMqttRuntime>>> = Arc::new(Mutex::new(None));
}

#[tauri::command]
pub async fn frigate_mqtt_start(app: AppHandle, config: FrigateMqttConfig) -> Result<String, String> {
    {
        let mut guard = RUNTIME.lock().map_err(|_| "frigate_mqtt runtime lock poisoned".to_string())?;
        if guard.is_some() {
            return Ok("already_running".to_string());
        }

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        let join_handle = tokio::spawn(async move {
            if let Err(err) = run_loop(app, config, shutdown_rx).await {
                backend_error(format!("frigate_mqtt loop exited with error: {}", err));
            }
        });

        *guard = Some(FrigateMqttRuntime {
            shutdown_tx,
            join_handle,
        });
    }

    backend_info("frigate_mqtt started");
    Ok("started".to_string())
}

#[tauri::command]
pub async fn frigate_mqtt_stop() -> Result<String, String> {
    let runtime = {
        let mut guard = RUNTIME.lock().map_err(|_| "frigate_mqtt runtime lock poisoned".to_string())?;
        guard.take()
    };

    if let Some(rt) = runtime {
        let _ = rt.shutdown_tx.send(());
        let _ = rt.join_handle.await;
        backend_info("frigate_mqtt stopped");
        Ok("stopped".to_string())
    } else {
        Ok("not_running".to_string())
    }
}

async fn run_loop(app: AppHandle, config: FrigateMqttConfig, mut shutdown_rx: oneshot::Receiver<()>) -> Result<(), String> {
    let client_id = config
        .client_id
        .clone()
        .unwrap_or_else(|| format!("broxeen-frigate-{}", chrono::Utc::now().timestamp()));

    let mut mqttoptions = MqttOptions::new(client_id, config.host.clone(), config.port);
    mqttoptions.set_keep_alive(Duration::from_secs(30));

    if let Some(username) = config.username.clone() {
        mqttoptions.set_credentials(username, config.password.clone().unwrap_or_default());
    }

    let (client, mut eventloop) = AsyncClient::new(mqttoptions, 10);

    backend_info(format!(
        "frigate_mqtt connecting to {}:{} topic={}...",
        config.host, config.port, config.topic
    ));

    client
        .subscribe(config.topic.clone(), QoS::AtMostOnce)
        .await
        .map_err(|e| format!("MQTT subscribe failed: {}", e))?;

    backend_info("frigate_mqtt subscribed");

    loop {
        tokio::select! {
            _ = &mut shutdown_rx => {
                backend_info("frigate_mqtt shutdown requested");
                break;
            }
            evt = eventloop.poll() => {
                match evt {
                    Ok(Event::Incoming(Incoming::Publish(p))) => {
                        let topic = p.topic.clone();
                        let payload = String::from_utf8_lossy(&p.payload).to_string();

                        let msg = FrigateMqttEvent {
                            topic,
                            payload,
                            timestamp: chrono::Utc::now().timestamp_millis(),
                        };

                        if let Err(err) = app.emit(FRIGATE_EVENT_NAME, msg) {
                            backend_warn(format!("frigate_mqtt emit failed: {}", err));
                        }
                    }
                    Ok(Event::Incoming(Incoming::ConnAck(_))) => {
                        backend_info("frigate_mqtt connected".to_string());
                    }
                    Ok(Event::Incoming(Incoming::Disconnect)) => {
                        backend_warn("frigate_mqtt disconnected".to_string());
                    }
                    Ok(_) => {
                        // ignore other events
                    }
                    Err(e) => {
                        backend_error(format!("frigate_mqtt poll error: {}", e));
                        tokio::time::sleep(Duration::from_secs(2)).await;
                    }
                }
            }
        }
    }

    // Best-effort disconnect
    if let Err(e) = client.disconnect().await {
        backend_warn(format!("frigate_mqtt disconnect failed: {}", e));
    }

    Ok(())
}
