//! Pre-request + post-response scripting, powered by the pure-Rust
//! [`boa_engine`] JS engine (no C toolchain — builds cleanly on Windows).
//!
//! The design deliberately keeps the Rust<->JS boundary tiny. Instead of
//! registering native Rust functions into the engine (the most
//! version-fragile part of boa's API), we inject the **entire** sandbox API
//! as a JavaScript prelude that maintains all state in plain JS objects:
//!
//!   * `lancer.env.get(name)` / `lancer.env.set(name, value)`
//!   * `lancer.request` (`.url`, `.method`, `.headers`) — read-only context
//!   * `lancer.response` (`.status`, `.body`, `.headers`, `.json()`)
//!   * `lancer.test(name, fn)` — register + run a test, capturing pass/fail
//!   * `lancer.log(...)` and `console.log(...)`
//!   * `expect(actual)` — `.toBe / .toEqual / .toContain / .toBeGreaterThan
//!     / .toBeLessThan / .toBeTruthy / .toBeFalsy / .toBeDefined`
//!
//! After the user's script runs, we evaluate one final expression that
//! `JSON.stringify`s the collected state and parse it back in Rust, returning
//! a structured [`ScriptResult`]. The only boa surface we depend on is
//! `Context`, `Source::from_bytes`, script execution, and runtime limits.

use serde::{Deserialize, Serialize};

/// One assertion result from a `lancer.test(...)` block.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub name: String,
    pub passed: bool,
    /// Failure / error message when `passed` is false; `None` on success.
    pub error: Option<String>,
}

/// Outcome of running one script (pre-request or post-response).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScriptResult {
    /// Variables the script wrote via `lancer.env.set(...)`, in the order set.
    /// Merged into the caller's variable overlay at highest precedence.
    pub vars_set: Vec<(String, String)>,
    /// Registered test outcomes, in registration order.
    pub tests: Vec<TestResult>,
    /// `lancer.log(...)` / `console.log(...)` output lines.
    pub logs: Vec<String>,
    /// A hard error that aborted the script (syntax error, thrown exception
    /// outside a test, engine limit hit). `None` means the script completed.
    pub error: Option<String>,
}

/// Read-only request context exposed to a pre-request (or post-response)
/// script as `lancer.request`.
#[derive(Debug, Clone, Default)]
pub struct RequestContext {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
}

/// Response context exposed to a post-response script as `lancer.response`.
#[derive(Debug, Clone, Default)]
pub struct ResponseContext {
    pub status: u16,
    pub body: String,
    pub headers: Vec<(String, String)>,
}

/// Inputs to a script run. `request` is always present; `response` is only
/// supplied for post-response scripts. `env` seeds `lancer.env` with the
/// currently-resolved variables so scripts can read existing values.
#[derive(Debug, Clone, Default)]
pub struct ScriptContext {
    pub env: Vec<(String, String)>,
    pub request: RequestContext,
    pub response: Option<ResponseContext>,
}

/// The JS sandbox prelude. Defines the `lancer` global, `expect`, and
/// `console.log`, plus the internal result serializer. Values that vary
/// per-run (env seed, request, response) are spliced in by [`build_program`]
/// as JSON literals — never string-concatenated raw, so user data can't
/// break out of the literal.
const PRELUDE: &str = r#"
var __lancer = {
  varsSet: [],   // [[name, value], ...] preserving set order
  tests: [],     // [{name, passed, error}]
  logs: [],
};

var lancer = {
  request: __lancer_request_json,
  response: __lancer_response_json,
  env: {
    _store: __lancer_env_json,
    get: function (name) {
      var v = this._store[name];
      return v === undefined ? null : v;
    },
    set: function (name, value) {
      var s = value === null || value === undefined ? "" : String(value);
      this._store[name] = s;
      __lancer.varsSet.push([String(name), s]);
    },
  },
  log: function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
      parts.push(__lancer_str(arguments[i]));
    }
    __lancer.logs.push(parts.join(" "));
  },
  test: function (name, fn) {
    var rec = { name: String(name), passed: true, error: null };
    try {
      fn();
    } catch (e) {
      rec.passed = false;
      rec.error = e && e.message ? String(e.message) : String(e);
    }
    __lancer.tests.push(rec);
  },
};

// Attach response.json() helper when a response is present.
if (lancer.response) {
  lancer.response.json = function () {
    return JSON.parse(this.body);
  };
}

var console = { log: function () { lancer.log.apply(lancer, arguments); } };

function __lancer_str(v) {
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

function __lancer_deep_eq(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === "object" && typeof b === "object") {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
  }
  return false;
}

function expect(actual) {
  function fail(msg) { throw new Error(msg); }
  return {
    toBe: function (expected) {
      if (actual !== expected)
        fail("expected " + __lancer_str(actual) + " to be " + __lancer_str(expected));
    },
    toEqual: function (expected) {
      if (!__lancer_deep_eq(actual, expected))
        fail("expected " + __lancer_str(actual) + " to equal " + __lancer_str(expected));
    },
    toContain: function (expected) {
      var ok = false;
      if (typeof actual === "string") ok = actual.indexOf(expected) !== -1;
      else if (actual && typeof actual.indexOf === "function") ok = actual.indexOf(expected) !== -1;
      if (!ok)
        fail("expected " + __lancer_str(actual) + " to contain " + __lancer_str(expected));
    },
    toBeGreaterThan: function (expected) {
      if (!(actual > expected))
        fail("expected " + __lancer_str(actual) + " to be greater than " + __lancer_str(expected));
    },
    toBeLessThan: function (expected) {
      if (!(actual < expected))
        fail("expected " + __lancer_str(actual) + " to be less than " + __lancer_str(expected));
    },
    toBeTruthy: function () {
      if (!actual) fail("expected " + __lancer_str(actual) + " to be truthy");
    },
    toBeFalsy: function () {
      if (actual) fail("expected " + __lancer_str(actual) + " to be falsy");
    },
    toBeDefined: function () {
      if (actual === undefined || actual === null)
        fail("expected value to be defined");
    },
  };
}
"#;

/// Final expression run after the user script. Produces a JSON string of the
/// collected state, which Rust parses into a [`ScriptResult`].
const RESULT_EXPR: &str = "JSON.stringify(__lancer)";

/// Build the complete program: prelude (with JSON literals spliced in) +
/// the user's code. Splicing JSON literals (not raw strings) means hostile
/// header/body content can't escape into executable code.
fn build_program(code: &str, ctx: &ScriptContext) -> String {
    let env_json = serde_json::to_string(&env_to_map(&ctx.env)).unwrap_or_else(|_| "{}".into());
    let request_json = serde_json::to_string(&serde_json::json!({
        "url": ctx.request.url,
        "method": ctx.request.method,
        "headers": headers_to_map(&ctx.request.headers),
    }))
    .unwrap_or_else(|_| "null".into());
    let response_json = match &ctx.response {
        Some(r) => serde_json::to_string(&serde_json::json!({
            "status": r.status,
            "body": r.body,
            "headers": headers_to_map(&r.headers),
        }))
        .unwrap_or_else(|_| "null".into()),
        None => "null".into(),
    };

    // Assemble the program in a SINGLE pass by direct concatenation rather
    // than chained `.replace()` on the prelude. The earlier approach ran three
    // sequential `.replace("__LANCER_REQUEST__", …)` calls; if an env/request
    // value happened to contain the literal text `__LANCER_RESPONSE__` (or
    // another marker), a later `.replace` would splice into it and corrupt the
    // program. Here each JSON literal is bound to a `var` exactly once and the
    // markers never appear in user-controlled text, so collisions are
    // impossible. A JSON literal is itself a valid JS expression.
    //
    // serde_json escapes `<`, `>`, `&`? No — but the JSON is parsed by boa as a
    // JS object/array/string literal, never embedded in HTML, so the only
    // requirement (valid JS syntax) is met by serde_json's output.
    let mut program = String::with_capacity(PRELUDE.len() + code.len() + 256);
    program.push_str("var __lancer_env_json = ");
    program.push_str(&env_json);
    program.push_str(";\nvar __lancer_request_json = ");
    program.push_str(&request_json);
    program.push_str(";\nvar __lancer_response_json = ");
    program.push_str(&response_json);
    program.push_str(";\n");
    program.push_str(PRELUDE);
    // Wrap the user code in its own function scope so `var`/`function`
    // declarations there don't clobber the prelude, and a top-level `return`
    // (if any) is harmless. Errors propagate out to be reported.
    program.push_str("\n(function () {\n");
    program.push_str(code);
    program.push_str("\n})();\n");
    program
}

fn env_to_map(env: &[(String, String)]) -> serde_json::Map<String, serde_json::Value> {
    let mut m = serde_json::Map::new();
    for (k, v) in env {
        m.insert(k.clone(), serde_json::Value::String(v.clone()));
    }
    m
}

fn headers_to_map(headers: &[(String, String)]) -> serde_json::Map<String, serde_json::Value> {
    let mut m = serde_json::Map::new();
    for (k, v) in headers {
        // Lowercase keys for case-insensitive lookups from scripts.
        m.insert(k.to_lowercase(), serde_json::Value::String(v.clone()));
    }
    m
}

/// Wall-clock budget for a single script run. A `while(true){}` or huge-alloc
/// script that defeats the loop-iteration / recursion limits below (or that
/// merely runs a colossal but finite loop) is killed at this deadline so it
/// can't hang the request indefinitely.
const SCRIPT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Run a user script with the given context, bounded by a wall-clock timeout.
///
/// Never panics — engine errors, thrown exceptions, and limit hits are captured
/// into `ScriptResult::error`. Test failures are NOT errors: they populate
/// `tests` with `passed: false`.
///
/// The boa engine is synchronous and single-threaded (its `Context` is
/// `!Send` + `!Sync`), so we run it inside `spawn_blocking` — keeping the async
/// reactor free — and race it against [`SCRIPT_TIMEOUT`]. On timeout we return
/// an error result; the orphaned blocking task still finishes on its own
/// (bounded by the loop-iteration/recursion limits) without blocking the
/// caller. The `Context` is created *inside* the closure, so nothing `!Send`
/// crosses the `spawn_blocking` boundary.
pub async fn run_script(code: &str, ctx: &ScriptContext) -> ScriptResult {
    let program = build_program(code, ctx);

    let join = tokio::task::spawn_blocking(move || run_engine(&program));

    match tokio::time::timeout(SCRIPT_TIMEOUT, join).await {
        Ok(Ok(result)) => result,
        // The blocking task panicked (should never happen — run_engine is
        // panic-free) — surface it rather than hanging.
        Ok(Err(join_err)) => ScriptResult {
            error: Some(format!("script task failed: {join_err}")),
            ..Default::default()
        },
        // Wall-clock budget exceeded (infinite loop, runaway alloc, etc.).
        Err(_elapsed) => ScriptResult {
            error: Some(format!(
                "script exceeded the {}s time limit and was aborted",
                SCRIPT_TIMEOUT.as_secs()
            )),
            ..Default::default()
        },
    }
}

/// Synchronous boa execution of an already-assembled program. Split out so it
/// can run inside `spawn_blocking` and be unit-tested without a tokio runtime.
fn run_engine(program: &str) -> ScriptResult {
    use boa_engine::{Context, Source};

    let mut result = ScriptResult::default();

    let mut context = Context::default();
    // Bound execution so an accidental infinite loop can't hang the engine
    // thread forever. These complement the wall-clock timeout in `run_script`:
    // the limits cap pathological-but-finite work; the timeout backstops true
    // infinite loops the iteration counter can't reach a bound on.
    context
        .runtime_limits_mut()
        .set_loop_iteration_limit(10_000_000);
    context.runtime_limits_mut().set_recursion_limit(2_000);

    if let Err(e) = context.eval(Source::from_bytes(program.as_bytes())) {
        result.error = Some(format!("{e}"));
        return result;
    }

    // Pull the collected state back out as a JSON string, then parse it.
    let json_str = match context.eval(Source::from_bytes(RESULT_EXPR.as_bytes())) {
        Ok(v) => match v.to_json(&mut context) {
            Ok(Some(serde_json::Value::String(s))) => s,
            Ok(other) => {
                result.error = Some(format!("unexpected result shape: {other:?}"));
                return result;
            }
            Err(e) => {
                result.error = Some(format!("failed to read script result: {e}"));
                return result;
            }
        },
        Err(e) => {
            result.error = Some(format!("failed to collect script result: {e}"));
            return result;
        }
    };

    parse_result_json(&json_str, &mut result);
    result
}

/// Parse the `__lancer` JSON blob produced by [`RESULT_EXPR`] into the
/// already-defaulted [`ScriptResult`]. Kept separate so it's unit-testable
/// without the engine.
fn parse_result_json(json_str: &str, result: &mut ScriptResult) {
    let parsed: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(e) => {
            result.error = Some(format!("invalid script result JSON: {e}"));
            return;
        }
    };

    if let Some(arr) = parsed.get("varsSet").and_then(|v| v.as_array()) {
        for pair in arr {
            if let Some(p) = pair.as_array() {
                if p.len() == 2 {
                    let k = p[0].as_str().unwrap_or_default().to_string();
                    let v = p[1].as_str().unwrap_or_default().to_string();
                    result.vars_set.push((k, v));
                }
            }
        }
    }

    if let Some(arr) = parsed.get("tests").and_then(|v| v.as_array()) {
        for t in arr {
            let name = t
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let passed = t.get("passed").and_then(|v| v.as_bool()).unwrap_or(false);
            let error = t
                .get("error")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            result.tests.push(TestResult {
                name,
                passed,
                error,
            });
        }
    }

    if let Some(arr) = parsed.get("logs").and_then(|v| v.as_array()) {
        for l in arr {
            if let Some(s) = l.as_str() {
                result.logs.push(s.to_string());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_ctx() -> ScriptContext {
        ScriptContext::default()
    }

    #[tokio::test]
    async fn sets_a_variable() {
        let res = run_script("lancer.env.set('token', 'abc123');", &empty_ctx()).await;
        assert!(res.error.is_none(), "unexpected error: {:?}", res.error);
        assert_eq!(
            res.vars_set,
            vec![("token".to_string(), "abc123".to_string())]
        );
    }

    #[tokio::test]
    async fn passing_and_failing_assertions() {
        let ctx = ScriptContext {
            response: Some(ResponseContext {
                status: 200,
                body: r#"{"id":42,"name":"alice"}"#.into(),
                headers: vec![("content-type".into(), "application/json".into())],
            }),
            ..Default::default()
        };
        let code = r#"
            lancer.test('status is 200', function () {
              expect(lancer.response.status).toBe(200);
            });
            lancer.test('id is 99 (should fail)', function () {
              expect(lancer.response.json().id).toBe(99);
            });
        "#;
        let res = run_script(code, &ctx).await;
        assert!(res.error.is_none(), "unexpected error: {:?}", res.error);
        assert_eq!(res.tests.len(), 2);
        assert_eq!(res.tests[0].name, "status is 200");
        assert!(res.tests[0].passed);
        assert!(res.tests[0].error.is_none());
        assert_eq!(res.tests[1].name, "id is 99 (should fail)");
        assert!(!res.tests[1].passed);
        assert!(res.tests[1].error.is_some());
    }

    #[tokio::test]
    async fn reads_env_and_request_context() {
        let ctx = ScriptContext {
            env: vec![("base".into(), "https://api.example.com".into())],
            request: RequestContext {
                url: "https://api.example.com/users".into(),
                method: "GET".into(),
                headers: vec![("Authorization".into(), "Bearer xyz".into())],
            },
            response: None,
        };
        let code = r#"
            lancer.env.set('derived', lancer.env.get('base') + '/v2');
            lancer.test('request url present', function () {
              expect(lancer.request.url).toContain('/users');
            });
            lancer.test('auth header readable', function () {
              expect(lancer.request.headers['authorization']).toBe('Bearer xyz');
            });
        "#;
        let res = run_script(code, &ctx).await;
        assert!(res.error.is_none(), "unexpected error: {:?}", res.error);
        assert_eq!(
            res.vars_set,
            vec![(
                "derived".to_string(),
                "https://api.example.com/v2".to_string()
            )]
        );
        assert!(res.tests.iter().all(|t| t.passed), "tests: {:?}", res.tests);
    }

    #[tokio::test]
    async fn syntax_error_is_reported_not_panicked() {
        let res = run_script("this is not valid javascript !!!", &empty_ctx()).await;
        assert!(res.error.is_some());
    }

    #[tokio::test]
    async fn captures_console_log() {
        let res = run_script("console.log('hello', 42);", &empty_ctx()).await;
        assert!(res.error.is_none(), "unexpected error: {:?}", res.error);
        assert_eq!(res.logs, vec!["hello 42".to_string()]);
    }

    /// An infinite loop must be aborted by the wall-clock timeout rather than
    /// hanging the request forever. We don't wait the full 5s in the test —
    /// boa's loop-iteration limit usually trips first — but either way the
    /// call must RETURN with an error, never block indefinitely.
    #[tokio::test]
    async fn infinite_loop_is_bounded() {
        let res = run_script("while (true) {}", &empty_ctx()).await;
        assert!(
            res.error.is_some(),
            "an infinite loop must produce an error result, not hang"
        );
    }

    /// An env/request value that contains a prelude marker token (e.g. the
    /// literal `__lancer_response_json` or the old `__LANCER_REQUEST__`) must
    /// NOT corrupt the assembled program. With single-pass concatenation the
    /// value is just data inside a JSON literal.
    #[tokio::test]
    async fn marker_lookalike_value_does_not_corrupt_program() {
        let ctx = ScriptContext {
            env: vec![(
                "evil".into(),
                "__lancer_response_json __LANCER_REQUEST__".into(),
            )],
            request: RequestContext {
                url: "__LANCER_RESPONSE__".into(),
                method: "GET".into(),
                headers: vec![],
            },
            response: None,
        };
        let code = r#"
            lancer.test('value preserved verbatim', function () {
              expect(lancer.env.get('evil'))
                .toBe('__lancer_response_json __LANCER_REQUEST__');
            });
            lancer.test('url preserved verbatim', function () {
              expect(lancer.request.url).toBe('__LANCER_RESPONSE__');
            });
        "#;
        let res = run_script(code, &ctx).await;
        assert!(res.error.is_none(), "unexpected error: {:?}", res.error);
        assert!(res.tests.iter().all(|t| t.passed), "tests: {:?}", res.tests);
    }
}
