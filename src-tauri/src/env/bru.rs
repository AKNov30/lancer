use crate::env::schema::Environment;

#[derive(Debug, thiserror::Error)]
pub enum EnvBruError {
    #[error("malformed line: {0}")]
    MalformedLine(String),
    #[error("unterminated block: {0}")]
    UnterminatedBlock(String),
}

pub fn parse(name: &str, input: &str) -> Result<Environment, EnvBruError> {
    let mut vars = Vec::<(String, String)>::new();
    let mut secret_names = Vec::<String>::new();
    let bytes = input.as_bytes();
    let mut i = 0usize;

    while i < bytes.len() {
        // skip whitespace
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }

        // read header until '{' or '[' or newline
        let header_start = i;
        while i < bytes.len() && bytes[i] != b'{' && bytes[i] != b'[' && bytes[i] != b'\n' {
            i += 1;
        }
        let header = input[header_start..i].trim().to_string();
        if header.is_empty() {
            continue;
        }
        if i >= bytes.len() {
            return Err(EnvBruError::UnterminatedBlock(header));
        }

        let (closer, is_list) = match bytes[i] {
            b'{' => (b'}', false),
            b'[' => (b']', true),
            _ => return Err(EnvBruError::UnterminatedBlock(header)),
        };
        i += 1; // consume opener

        // Scan to the closer, but ignore closers inside a `"…"` string literal
        // (with `\` escapes) so a var value containing `}`/`]` isn't truncated.
        let body_start = i;
        let mut in_string = false;
        let mut escaped = false;
        while i < bytes.len() {
            let b = bytes[i];
            if in_string {
                if escaped {
                    escaped = false;
                } else if b == b'\\' {
                    escaped = true;
                } else if b == b'"' {
                    in_string = false;
                }
            } else if b == b'"' {
                in_string = true;
            } else if b == closer {
                break;
            }
            i += 1;
        }
        if i >= bytes.len() {
            return Err(EnvBruError::UnterminatedBlock(header));
        }
        let body = input[body_start..i].trim();
        i += 1; // consume closer

        match header.as_str() {
            "vars" => {
                for raw in body.lines() {
                    let line = raw.trim();
                    if line.is_empty() {
                        continue;
                    }
                    let (k, v) = line
                        .split_once(':')
                        .ok_or_else(|| EnvBruError::MalformedLine(line.to_string()))?;
                    vars.push((k.trim().to_string(), v.trim().to_string()));
                }
            }
            "vars:secret" => {
                if !is_list {
                    return Err(EnvBruError::MalformedLine(
                        "vars:secret must use `[ ... ]` list syntax".into(),
                    ));
                }
                for raw in body.split([',', '\n']) {
                    let s = raw.trim();
                    if !s.is_empty() {
                        secret_names.push(s.to_string());
                    }
                }
            }
            _ => {} // forward-compat: ignore unknown blocks
        }
    }

    Ok(Environment {
        name: name.to_string(),
        vars,
        secret_names,
    })
}

pub fn serialize(env: &Environment) -> String {
    let mut out = String::new();
    if !env.vars.is_empty() {
        out.push_str("vars {\n");
        for (k, v) in &env.vars {
            out.push_str(&format!("  {k}: {v}\n"));
        }
        out.push_str("}\n\n");
    }
    if !env.secret_names.is_empty() {
        out.push_str("vars:secret [\n");
        for (i, n) in env.secret_names.iter().enumerate() {
            if i + 1 == env.secret_names.len() {
                out.push_str(&format!("  {n}\n"));
            } else {
                out.push_str(&format!("  {n},\n"));
            }
        }
        out.push_str("]\n");
    }
    out
}
