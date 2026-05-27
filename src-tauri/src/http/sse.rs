//! Server-Sent Events frame parsing.
//!
//! SSE is a line-oriented text protocol: each event is a block of fields
//! (`event:`, `data:`, `id:`, `retry:`) terminated by a blank line. `data`
//! fields accumulate across multiple lines (joined with `\n`). Lines starting
//! with `:` are comments and ignored. See the WHATWG HTML living standard,
//! "Server-sent events" → "Interpreting an event stream".
//!
//! Kept as a standalone, side-effect-free parser so it can be unit-tested
//! without spinning up a network connection.

/// One fully-parsed SSE event (a block delimited by a blank line).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SseEvent {
    /// `event:` field — the event type. Empty when not specified ("message").
    pub event: String,
    /// `data:` field(s), joined by `\n` when multiple `data:` lines appear.
    pub data: String,
    /// `id:` field — the last event id, used for reconnection.
    pub id: Option<String>,
    /// `retry:` field — reconnection time in ms, if the server sent one.
    pub retry: Option<u64>,
}

impl SseEvent {
    fn is_empty(&self) -> bool {
        self.event.is_empty() && self.data.is_empty() && self.id.is_none() && self.retry.is_none()
    }
}

/// Incremental SSE stream parser. Feed it raw bytes as they arrive off the
/// wire; it buffers partial lines and emits complete events on blank-line
/// boundaries. Handles `\n`, `\r\n`, and lone `\r` line endings.
#[derive(Debug, Default)]
pub struct SseParser {
    /// Bytes received but not yet split into a complete line.
    buf: String,
    /// The event currently being assembled across field lines.
    current: SseEvent,
    /// True once any `data:` line has been seen for the current event, so an
    /// event with an explicit empty data payload still dispatches.
    saw_data: bool,
}

impl SseParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed a chunk of raw bytes, returning any events completed by this chunk.
    /// Invalid UTF-8 is replaced lossily rather than erroring the stream.
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<SseEvent> {
        self.buf.push_str(&String::from_utf8_lossy(chunk));
        let mut out = Vec::new();
        // Process every complete line currently in the buffer. A line is
        // complete once a line terminator follows it; we keep any trailing
        // partial line in `buf` for the next chunk.
        while let Some(idx) = self.buf.find(['\n', '\r']) {
            // If the terminator is a `\r` that is the LAST byte we currently
            // have, we can't yet tell whether it's a lone `\r` line ending or
            // the first half of a `\r\n`. Defer until the next byte arrives —
            // otherwise a `\r` ending a chunk would be consumed here and a
            // leading `\n` in the next chunk would dispatch a spurious empty
            // line (blank-line = event boundary in SSE).
            let is_cr = self.buf.as_bytes()[idx] == b'\r';
            if is_cr && idx + 1 == self.buf.len() {
                break;
            }
            let line: String = self.buf[..idx].to_string();
            // Consume the terminator. `\r\n` counts as a single terminator.
            let after = &self.buf[idx..];
            let consumed = if after.starts_with("\r\n") {
                idx + 2
            } else {
                idx + 1
            };
            self.buf = self.buf[consumed..].to_string();
            if let Some(ev) = self.process_line(&line) {
                out.push(ev);
            }
        }
        out
    }

    /// Apply one logical line. Returns a completed event on a blank line.
    fn process_line(&mut self, line: &str) -> Option<SseEvent> {
        if line.is_empty() {
            // Blank line → dispatch the buffered event (if it carried anything).
            if self.current.is_empty() && !self.saw_data {
                return None;
            }
            let ev = std::mem::take(&mut self.current);
            self.saw_data = false;
            return Some(ev);
        }
        if line.starts_with(':') {
            // Comment line — ignore.
            return None;
        }
        // Split on the first colon. No colon → whole line is the field name
        // with an empty value (per spec).
        let (field, value) = match line.find(':') {
            Some(i) => {
                let v = &line[i + 1..];
                // A single leading space after the colon is stripped.
                let v = v.strip_prefix(' ').unwrap_or(v);
                (&line[..i], v)
            }
            None => (line, ""),
        };
        match field {
            "event" => self.current.event = value.to_string(),
            "data" => {
                if self.saw_data {
                    self.current.data.push('\n');
                }
                self.current.data.push_str(value);
                self.saw_data = true;
            }
            "id" => self.current.id = Some(value.to_string()),
            "retry" => {
                if let Ok(ms) = value.parse::<u64>() {
                    self.current.retry = Some(ms);
                }
            }
            // Unknown field — ignored per spec.
            _ => {}
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_event() {
        let mut p = SseParser::new();
        let evs = p.feed(b"data: hello\n\n");
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].data, "hello");
        assert_eq!(evs[0].event, "");
    }

    #[test]
    fn parses_named_event_with_id() {
        let mut p = SseParser::new();
        let evs = p.feed(b"event: ping\nid: 42\ndata: {\"x\":1}\n\n");
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].event, "ping");
        assert_eq!(evs[0].id.as_deref(), Some("42"));
        assert_eq!(evs[0].data, "{\"x\":1}");
    }

    #[test]
    fn joins_multiline_data() {
        let mut p = SseParser::new();
        let evs = p.feed(b"data: line1\ndata: line2\n\n");
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].data, "line1\nline2");
    }

    #[test]
    fn handles_split_chunks() {
        let mut p = SseParser::new();
        assert!(p.feed(b"data: par").is_empty());
        assert!(p.feed(b"tial").is_empty());
        let evs = p.feed(b"\n\n");
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].data, "partial");
    }

    #[test]
    fn ignores_comments_and_parses_retry() {
        let mut p = SseParser::new();
        let evs = p.feed(b": keep-alive comment\nretry: 3000\ndata: x\n\n");
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].retry, Some(3000));
        assert_eq!(evs[0].data, "x");
    }

    #[test]
    fn handles_crlf_endings() {
        let mut p = SseParser::new();
        let evs = p.feed(b"event: a\r\ndata: b\r\n\r\n");
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].event, "a");
        assert_eq!(evs[0].data, "b");
    }

    #[test]
    fn dispatches_multiple_events_in_one_chunk() {
        let mut p = SseParser::new();
        let evs = p.feed(b"data: one\n\ndata: two\n\n");
        assert_eq!(evs.len(), 2);
        assert_eq!(evs[0].data, "one");
        assert_eq!(evs[1].data, "two");
    }

    /// A `\r\n` split across two chunks (chunk ends on `\r`, next starts with
    /// `\n`) must be treated as ONE line terminator, not two — otherwise the
    /// stray `\n` dispatches a spurious empty event at the wrong boundary.
    #[test]
    fn crlf_split_across_chunk_boundary_is_single_terminator() {
        let mut p = SseParser::new();
        // First chunk ends right on the `\r` of a `\r\n` line ending.
        let evs = p.feed(b"data: hello\r");
        assert!(evs.is_empty(), "trailing \\r must be deferred, got {evs:?}");
        // Second chunk supplies the `\n` (completing the data line) plus the
        // blank `\r\n` that ends the event.
        let evs = p.feed(b"\n\r\n");
        assert_eq!(evs.len(), 1, "expected exactly one event, got {evs:?}");
        assert_eq!(evs[0].data, "hello");
    }

    /// A genuine lone-`\r` line ending still works once the following byte
    /// confirms it isn't part of a `\r\n`.
    #[test]
    fn lone_cr_line_ending_still_parses() {
        let mut p = SseParser::new();
        let evs = p.feed(b"data: x\r\r");
        // First `\r` ends the data line; second `\r` is deferred (it's the last
        // byte). Feeding a non-`\n` byte resolves the deferred `\r` as a blank
        // line → dispatch.
        assert!(evs.is_empty(), "got {evs:?}");
        let evs = p.feed(b"data: y\r\r");
        assert_eq!(evs.len(), 1, "expected one event, got {evs:?}");
        assert_eq!(evs[0].data, "x");
    }
}
