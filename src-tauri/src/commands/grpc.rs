//! gRPC support with **runtime** `.proto` loading.
//!
//! Users bring an arbitrary `.proto` file; we parse it at runtime (no
//! `protoc` binary, no build-time codegen) and let them invoke unary methods
//! with a JSON request body. The pipeline is:
//!
//! ```text
//!   .proto text ──protox-parse──▶ FileDescriptorProto
//!                                       │
//!                                       ▼
//!               prost-reflect DescriptorPool (services + messages)
//!                                       │
//!   JSON body ──serde──▶ DynamicMessage (input type) ──prost──▶ bytes
//!                                       │
//!                              tonic unary over HTTP/2
//!                                       │
//!   bytes ──prost──▶ DynamicMessage (output type) ──serde──▶ JSON
//! ```
//!
//! Only **unary** methods are supported in this MVP. Client- or server-
//! streaming methods are listed (so the UI can grey them out) but calling one
//! returns a clear "streaming not supported yet" error rather than hanging.
//!
//! The hard part — parse + descriptor build + JSON↔protobuf round-trip — is
//! covered by a unit test (no live server needed). The transport leg
//! (`grpc_unary_call`) can only be exercised against a real gRPC server.

use std::time::{Duration, Instant};

use prost::Message;
use prost_reflect::{DescriptorPool, DynamicMessage, MessageDescriptor, MethodDescriptor};
use prost_types::FileDescriptorSet;
use serde::Serialize;

use crate::commands::http::CANCELLED_SENTINEL;
use crate::state::AppState;

/// Time budget for establishing the HTTP/2 connection to the gRPC endpoint.
/// Without this, an unreachable-but-routable host hangs for the OS TCP default
/// (can be minutes). Mirrors the HTTP client's connect timeout.
const GRPC_CONNECT_TIMEOUT_SECS: u64 = 10;
/// Overall time budget for the unary call (connect + request + response).
const GRPC_REQUEST_TIMEOUT_SECS: u64 = 30;

// ─── Wire types (camelCase to match the TS frontend) ────────────────────────

/// One RPC method enumerated from a parsed `.proto`. `client_streaming` /
/// `server_streaming` tell the UI whether the method is unary (both false).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcMethod {
    /// Fully-qualified service name, e.g. `greet.Greeter`.
    pub service: String,
    /// Bare method name, e.g. `SayHello`.
    pub method: String,
    pub client_streaming: bool,
    pub server_streaming: bool,
    /// Fully-qualified input message type, e.g. `greet.HelloRequest`.
    pub input_type: String,
    /// Fully-qualified output message type.
    pub output_type: String,
}

/// Result of a unary call. A non-OK gRPC status is reported here (not as a
/// command error) so the UI can show the status code + message like a normal
/// response rather than a red transport failure.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcResponse {
    /// Numeric gRPC status code (0 = OK). See <https://grpc.io/docs/guides/status-codes/>.
    pub status_code: i32,
    /// Status message — `"OK"` on success, otherwise the server's detail.
    pub message: String,
    /// Decoded response message as pretty JSON. Empty string when status != OK.
    pub body_json: String,
    /// Wall-clock time for the call (connect + request + response), in ms.
    pub time_ms: u64,
}

// ─── Descriptor pool from a .proto file ─────────────────────────────────────

/// Parse a single `.proto` file (by path) into a [`DescriptorPool`].
///
/// Uses `protox-parse` so no external `protoc` is needed. Import resolution is
/// limited to a single file in this MVP — protos with `import` statements that
/// pull in other local files aren't resolved (the parse will error clearly).
fn pool_from_proto(proto_path: &str) -> Result<DescriptorPool, String> {
    let text = std::fs::read_to_string(proto_path)
        .map_err(|e| format!("failed to read {proto_path}: {e}"))?;
    // The file name embedded in the descriptor is cosmetic for a single file.
    let file_name = std::path::Path::new(proto_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("input.proto");
    let fd =
        protox_parse::parse(file_name, &text).map_err(|e| format!("failed to parse proto: {e}"))?;
    let mut set = FileDescriptorSet::default();
    set.file.push(fd);
    DescriptorPool::from_file_descriptor_set(set)
        .map_err(|e| format!("failed to build descriptor pool: {e}"))
}

/// Look up the method descriptor for a `(service, method)` pair within a pool.
fn find_method(
    pool: &DescriptorPool,
    service: &str,
    method: &str,
) -> Result<MethodDescriptor, String> {
    let svc = pool
        .get_service_by_name(service)
        .ok_or_else(|| format!("service '{service}' not found in proto"))?;
    // Bind before the block ends — the `methods()` iterator borrows `svc`,
    // but `MethodDescriptor` itself is owned (holds an Arc to the pool).
    let found = svc.methods().find(|m| m.name() == method);
    found.ok_or_else(|| format!("method '{method}' not found in service '{service}'"))
}

// ─── Dynamic tonic codec ─────────────────────────────────────────────────────

/// A tonic [`Codec`](tonic::codec::Codec) that encodes/decodes
/// [`DynamicMessage`]s for a specific input/output type. This is what lets us
/// make a unary call without compile-time-generated stubs.
/// Only the output descriptor is needed at codec level — decoding the response
/// requires it, while encoding the request reads the descriptor off the
/// `DynamicMessage` itself.
#[derive(Clone)]
struct DynamicCodec {
    output: MessageDescriptor,
}

/// The encoder needs no descriptor — a `DynamicMessage` already carries its
/// own, and prost encodes straight from it.
struct DynamicEncoder;
struct DynamicDecoder(MessageDescriptor);

impl tonic::codec::Encoder for DynamicEncoder {
    type Item = DynamicMessage;
    type Error = tonic::Status;

    fn encode(
        &mut self,
        item: Self::Item,
        dst: &mut tonic::codec::EncodeBuf<'_>,
    ) -> Result<(), Self::Error> {
        // `EncodeBuf` implements `BufMut`, so prost can write straight into it.
        item.encode(dst)
            .map_err(|e| tonic::Status::internal(format!("encode error: {e}")))
    }
}

impl tonic::codec::Decoder for DynamicDecoder {
    type Item = DynamicMessage;
    type Error = tonic::Status;

    fn decode(
        &mut self,
        src: &mut tonic::codec::DecodeBuf<'_>,
    ) -> Result<Option<Self::Item>, Self::Error> {
        let msg = DynamicMessage::decode(self.0.clone(), src)
            .map_err(|e| tonic::Status::internal(format!("decode error: {e}")))?;
        Ok(Some(msg))
    }
}

impl tonic::codec::Codec for DynamicCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = DynamicEncoder;
    type Decoder = DynamicDecoder;

    fn encoder(&mut self) -> Self::Encoder {
        DynamicEncoder
    }

    fn decoder(&mut self) -> Self::Decoder {
        DynamicDecoder(self.output.clone())
    }
}

// ─── Tauri commands ──────────────────────────────────────────────────────────

/// List every RPC method across all services declared in `proto_path`.
#[tauri::command]
pub async fn grpc_list_methods(proto_path: String) -> Result<Vec<GrpcMethod>, String> {
    // Parsing is CPU-bound + does blocking file IO; run it off the async
    // executor so we don't stall the runtime on a large proto.
    tokio::task::spawn_blocking(move || {
        let pool = pool_from_proto(&proto_path)?;
        let mut methods = Vec::new();
        for svc in pool.services() {
            for m in svc.methods() {
                methods.push(GrpcMethod {
                    service: svc.full_name().to_string(),
                    method: m.name().to_string(),
                    client_streaming: m.is_client_streaming(),
                    server_streaming: m.is_server_streaming(),
                    input_type: m.input().full_name().to_string(),
                    output_type: m.output().full_name().to_string(),
                });
            }
        }
        Ok(methods)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

/// Invoke a **unary** gRPC method with a JSON request body.
///
/// `endpoint` is the server origin, e.g. `http://localhost:50051`. `metadata`
/// pairs are sent as request headers (gRPC metadata). A non-OK gRPC status is
/// returned inside [`GrpcResponse`] rather than as an `Err`, so the caller can
/// surface it like a normal response.
#[tauri::command]
// Tauri command — args map to the frontend invoke payload.
#[allow(clippy::too_many_arguments)]
pub async fn grpc_unary_call(
    proto_path: String,
    endpoint: String,
    service: String,
    method: String,
    json_body: String,
    metadata: Vec<(String, String)>,
    // Frontend-generated id used to cancel this call mid-flight via
    // `cancel_request`. `None` → the call can't be cancelled and behaves
    // exactly as before (no registry entry, no `select!`). Mirrors
    // `send_request`'s cancellation contract.
    request_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<GrpcResponse, String> {
    // Parse + build the input DynamicMessage on a blocking thread. This stays
    // a hard error (bad proto / bad JSON is a client mistake, not a server
    // status), surfaced before we touch the network.
    let (output_desc, full_path, req_msg) = {
        let proto_path = proto_path.clone();
        let service = service.clone();
        let method = method.clone();
        let json_body = json_body.clone();
        tokio::task::spawn_blocking(move || {
            let pool = pool_from_proto(&proto_path)?;
            let md = find_method(&pool, &service, &method)?;
            if md.is_client_streaming() || md.is_server_streaming() {
                return Err(
                    "streaming not supported yet — only unary methods can be called".to_string(),
                );
            }
            let input = md.input();
            let output = md.output();
            // Build the request message from the JSON body.
            let mut de = serde_json::Deserializer::from_str(&json_body);
            let msg = DynamicMessage::deserialize(input.clone(), &mut de)
                .map_err(|e| format!("invalid JSON for {}: {e}", input.full_name()))?;
            de.end()
                .map_err(|e| format!("trailing data in JSON body: {e}"))?;
            // gRPC path is `/<fully.qualified.Service>/<Method>`.
            let path = format!("/{}/{}", md.parent_service().full_name(), md.name());
            Ok::<_, String>((output, path, msg))
        })
        .await
        .map_err(|e| format!("task join error: {e}"))??
    };

    // Build the request, attaching user metadata as request headers. Parse
    // failures are collected (not silently dropped) so a typo'd metadata key —
    // e.g. an invalid `authorization` header value — surfaces as a hard error
    // rather than vanishing and producing a confusing UNAUTHENTICATED later.
    let mut request = tonic::Request::new(req_msg);
    let mut bad_metadata: Vec<String> = Vec::new();
    for (k, v) in &metadata {
        match (
            k.parse::<tonic::metadata::MetadataKey<_>>(),
            v.parse::<tonic::metadata::MetadataValue<_>>(),
        ) {
            (Ok(key), Ok(val)) => {
                request.metadata_mut().insert(key, val);
            }
            _ => bad_metadata.push(k.clone()),
        }
    }
    if !bad_metadata.is_empty() {
        return Err(format!(
            "invalid metadata key/value for: {}",
            bad_metadata.join(", ")
        ));
    }

    // Register a oneshot cancel channel keyed by the id (when supplied), exactly
    // like `send_request`. The whole connect+call is raced against the cancel
    // receiver below; on cancel the call future is dropped and we return the
    // shared `CANCELLED_SENTINEL` so the frontend treats it identically to a
    // cancelled HTTP request. The registry entry is removed on EVERY exit path
    // via `take_cancel` so the map can never leak a stale sender.
    let cancel_rx = match request_id.as_ref() {
        Some(id) => {
            let (tx, rx) = tokio::sync::oneshot::channel::<()>();
            state
                .inner()
                .cancellations
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(id.clone(), tx);
            Some(rx)
        }
        None => None,
    };
    let take_cancel = || {
        if let Some(id) = request_id.as_ref() {
            state
                .inner()
                .cancellations
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(id);
        }
    };

    let codec = DynamicCodec {
        output: output_desc,
    };
    let path = match tonic::codegen::http::uri::PathAndQuery::from_maybe_shared(full_path) {
        Ok(p) => p,
        Err(e) => {
            take_cancel();
            return Err(format!("bad method path: {e}"));
        }
    };

    let started = Instant::now();

    // The whole connect + call leg, bounded by connect/overall timeouts. A
    // routable-but-dead endpoint would otherwise hang for the OS TCP default.
    let call_fut = async {
        let channel = tonic::transport::Channel::from_shared(endpoint.clone())
            .map_err(|e| format!("invalid endpoint '{endpoint}': {e}"))?
            .connect_timeout(Duration::from_secs(GRPC_CONNECT_TIMEOUT_SECS))
            .timeout(Duration::from_secs(GRPC_REQUEST_TIMEOUT_SECS))
            .connect()
            .await
            .map_err(|e| format!("failed to connect to {endpoint}: {e}"))?;

        let mut client = tonic::client::Grpc::new(channel);
        client
            .ready()
            .await
            .map_err(|e| format!("connection not ready: {e}"))?;

        Ok::<_, String>(client.unary(request, path, codec).await)
    };

    // Race the call against the cancel receiver. When `request_id` is `None`,
    // there is no receiver and the call is awaited plainly.
    let result = match cancel_rx {
        Some(rx) => {
            tokio::select! {
                res = call_fut => res,
                _ = rx => {
                    // Cancelled: dropping `call_fut` aborts the in-flight call.
                    take_cancel();
                    return Err(CANCELLED_SENTINEL.to_string());
                }
            }
        }
        None => call_fut.await,
    };
    // Whether the call succeeded or errored, it is done — clear the id.
    take_cancel();
    let result = result?;
    let time_ms = started.elapsed().as_millis() as u64;

    match result {
        Ok(resp) => {
            let dynamic = resp.into_inner();
            let body_json = serde_json::to_value(&dynamic)
                .and_then(|v| serde_json::to_string_pretty(&v))
                .unwrap_or_else(|e| format!("<failed to serialize response: {e}>"));
            Ok(GrpcResponse {
                status_code: tonic::Code::Ok as i32,
                message: "OK".to_string(),
                body_json,
                time_ms,
            })
        }
        // A gRPC status (e.g. NOT_FOUND, INVALID_ARGUMENT) is reported as a
        // normal result so the UI shows the code + message, not a red error.
        Err(status) => Ok(GrpcResponse {
            status_code: status.code() as i32,
            message: status.message().to_string(),
            body_json: String::new(),
            time_ms,
        }),
    }
}

#[cfg(test)]
mod grpc_unit_tests {
    use super::*;

    const PROTO: &str = r#"
        syntax = "proto3";
        package greet;
        message HelloRequest {
            string name = 1;
            int32 count = 2;
        }
        message HelloReply {
            string message = 1;
        }
        service Greeter {
            rpc SayHello (HelloRequest) returns (HelloReply);
            rpc SayHelloStream (HelloRequest) returns (stream HelloReply);
        }
    "#;

    /// Build a pool from inline proto text (mirrors `pool_from_proto` but
    /// without touching the filesystem).
    fn inline_pool(text: &str) -> DescriptorPool {
        let fd = protox_parse::parse("test.proto", text).expect("parse proto");
        let mut set = FileDescriptorSet::default();
        set.file.push(fd);
        DescriptorPool::from_file_descriptor_set(set).expect("build pool")
    }

    #[test]
    fn lists_methods_with_streaming_flags() {
        let pool = inline_pool(PROTO);
        let svc = pool
            .get_service_by_name("greet.Greeter")
            .expect("service present");

        let methods: Vec<_> = svc.methods().collect();
        assert_eq!(methods.len(), 2);

        let unary = find_method(&pool, "greet.Greeter", "SayHello").unwrap();
        assert!(!unary.is_client_streaming());
        assert!(!unary.is_server_streaming());
        assert_eq!(unary.input().full_name(), "greet.HelloRequest");
        assert_eq!(unary.output().full_name(), "greet.HelloReply");

        let server_stream = find_method(&pool, "greet.Greeter", "SayHelloStream").unwrap();
        assert!(server_stream.is_server_streaming());
        assert!(!server_stream.is_client_streaming());
    }

    #[test]
    fn json_to_dynamic_message_to_bytes_roundtrip() {
        let pool = inline_pool(PROTO);
        let md = find_method(&pool, "greet.Greeter", "SayHello").unwrap();
        let input = md.input();

        // JSON → DynamicMessage
        let json = r#"{"name":"world","count":7}"#;
        let mut de = serde_json::Deserializer::from_str(json);
        let msg = DynamicMessage::deserialize(input.clone(), &mut de).expect("deserialize");
        de.end().unwrap();

        // DynamicMessage → protobuf bytes
        let mut buf = Vec::new();
        msg.encode(&mut buf).expect("encode");
        assert!(!buf.is_empty(), "encoded protobuf should not be empty");

        // bytes → DynamicMessage → JSON, and confirm the values survived.
        let decoded = DynamicMessage::decode(input.clone(), buf.as_slice()).expect("decode");
        let value = serde_json::to_value(&decoded).expect("serialize back to JSON");
        assert_eq!(value["name"], "world");
        // proto3 JSON encodes int32 as a number.
        assert_eq!(value["count"], 7);
    }

    #[test]
    fn rejects_unknown_service_and_method() {
        let pool = inline_pool(PROTO);
        assert!(find_method(&pool, "greet.Nope", "SayHello").is_err());
        assert!(find_method(&pool, "greet.Greeter", "Nope").is_err());
    }

    /// The cancellation wiring races the call future against a oneshot cancel
    /// receiver in a `tokio::select!`; when the sender fires first, the call is
    /// dropped and the shared `CANCELLED_SENTINEL` (same constant HTTP uses) is
    /// returned. This exercises that exact race in isolation — a never-resolving
    /// call future stands in for the live transport leg, which can't be tested
    /// without a real gRPC server.
    #[tokio::test]
    async fn cancel_oneshot_wins_race_and_returns_sentinel() {
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        // A call that never resolves on its own — only cancellation ends it.
        let never = std::future::pending::<Result<(), String>>();
        // Fire the cancel before the select so the cancel arm wins immediately.
        tx.send(()).expect("receiver alive");

        let outcome: Result<(), String> = tokio::select! {
            res = never => res,
            _ = rx => Err(CANCELLED_SENTINEL.to_string()),
        };

        assert_eq!(outcome.unwrap_err(), CANCELLED_SENTINEL);
        // Contract guard: the gRPC path must reuse HTTP's exact sentinel string
        // so the frontend treats a cancelled gRPC call identically.
        assert_eq!(CANCELLED_SENTINEL, "__cancelled__");
    }
}
