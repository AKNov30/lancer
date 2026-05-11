use crate::collection::schema::Auth;
use crate::importers::postman::schema::PostmanAuth;

/// Convert a Postman auth object to a Lancer [`Auth`] variant.
///
/// Supported types: noauth, bearer, basic, apikey, oauth2 (client_credentials), awsv4.
/// Any unrecognised type returns `None` so the caller can record a warning.
pub fn convert_auth(pm: &PostmanAuth) -> Option<Auth> {
    match pm.kind.as_str() {
        "noauth" | "" => Some(Auth::None),
        "bearer" => {
            let token = pm.get(&pm.bearer, "token");
            Some(Auth::Bearer { token })
        }
        "basic" => {
            let username = pm.get(&pm.basic, "username");
            let password = pm.get(&pm.basic, "password");
            Some(Auth::Basic { username, password })
        }
        "apikey" => {
            let key = pm.get(&pm.apikey, "key");
            let value = pm.get(&pm.apikey, "value");
            // Postman stores location as "header" | "query"
            let location = {
                let raw = pm.get(&pm.apikey, "in");
                if raw.is_empty() {
                    "header".into()
                } else {
                    raw
                }
            };
            Some(Auth::ApiKey {
                key,
                value,
                location,
            })
        }
        "oauth2" => {
            // We map Postman OAuth2 client-credentials fields to our OAuth2Cc variant.
            let token_url = pm.get(&pm.oauth2, "accessTokenUrl");
            let client_id = pm.get(&pm.oauth2, "clientId");
            let client_secret = pm.get(&pm.oauth2, "clientSecret");
            let scope = pm.get(&pm.oauth2, "scope");
            let audience = pm.get(&pm.oauth2, "audience");
            Some(Auth::OAuth2Cc {
                token_url,
                client_id,
                client_secret,
                scope,
                audience,
            })
        }
        "awsv4" => {
            let access_key_id = pm.get(&pm.awsv4, "accessKey");
            let secret_access_key = pm.get(&pm.awsv4, "secretKey");
            let session_token = {
                let v = pm.get(&pm.awsv4, "sessionToken");
                if v.is_empty() {
                    None
                } else {
                    Some(v)
                }
            };
            let region = pm.get(&pm.awsv4, "region");
            let service = pm.get(&pm.awsv4, "service");
            Some(Auth::AwsSigV4 {
                access_key_id,
                secret_access_key,
                session_token,
                region,
                service,
            })
        }
        _ => None, // unsupported — caller records warning
    }
}
