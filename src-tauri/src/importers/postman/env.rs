use crate::env::schema::Environment;
use crate::importers::postman::schema::PostmanEnv;

/// Convert a Postman environment export into a Lancer [`Environment`].
///
/// Disabled variables are dropped. Secret-typed variables (`"type": "secret"`)
/// are recorded in `secret_names` with an empty value so the user knows they
/// need to be filled in via the secrets store.
pub fn convert_env(pm: PostmanEnv) -> Environment {
    let mut vars: Vec<(String, String)> = Vec::new();
    let mut secret_names: Vec<String> = Vec::new();

    for v in pm.values {
        if !v.enabled {
            continue;
        }
        if v.value_type == "secret" {
            secret_names.push(v.key);
        } else {
            vars.push((v.key, v.value));
        }
    }

    Environment {
        name: pm.name,
        vars,
        secret_names,
    }
}
