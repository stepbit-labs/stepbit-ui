use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Deserialize, Clone)]
pub struct DatabaseConfig {
    pub path: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct AuthConfig {
    pub api_keys: Vec<String>,
    pub token_expiry_hours: u32,
}

#[derive(Debug, Deserialize, Clone)]
pub struct OpenAiConfig {
    pub api_base: String,
    pub api_key: String,
    pub default_model: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct AnthropicConfig {
    pub api_base: String,
    pub api_key: String,
    pub default_model: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct OllamaConfig {
    pub base_url: String,
    pub default_model: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct CopilotConfig {
    pub api_base: String,
    pub api_key: String,
    pub default_model: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct StepbitCoreConfig {
    pub base_url: String,
    pub default_model: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct StepbitMemoryConfig {
    pub base_url: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct LlmConfig {
    pub provider: String,
    pub model: String,
    pub openai: Option<OpenAiConfig>,
    pub anthropic: Option<AnthropicConfig>,
    pub ollama: Option<OllamaConfig>,
    pub copilot: Option<CopilotConfig>,
    pub stepbit_core: Option<StepbitCoreConfig>,
    pub stepbit_memory: Option<StepbitMemoryConfig>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ChatConfig {
    pub max_history_messages: u32,
    pub system_prompt: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub auth: AuthConfig,
    pub llm: LlmConfig,
    pub chat: ChatConfig,
}

impl AppConfig {
    pub fn load(path: &str) -> Result<Self, config::ConfigError> {
        dotenv::dotenv().ok();

        let settings = config::Config::builder()
            .add_source(config::File::with_name(path).required(false))
            .add_source(config::Environment::with_prefix("STEPBIT").separator("__"))
            .build()?;

        let mut app_config: AppConfig = settings.try_deserialize()?;

        // Expand environment variables if present like ${OPENAI_API_KEY}
        app_config.server.host = expand_env(&app_config.server.host);
        app_config.database.path = expand_env(&app_config.database.path);

        if let Some(ref mut openai) = app_config.llm.openai {
            openai.api_key = expand_env(&openai.api_key);
        }
        if let Some(ref mut anthropic) = app_config.llm.anthropic {
            anthropic.api_key = expand_env(&anthropic.api_key);
        }
        if let Some(ref mut copilot) = app_config.llm.copilot {
            copilot.api_key = expand_env(&copilot.api_key);
        }
        if let Some(ref mut stepbit_core) = app_config.llm.stepbit_core {
            if let Some(ref key) = stepbit_core.api_key {
                let expanded = expand_env(key);
                if expanded == "${STEPBIT_CORE_API_KEY}" || expanded.is_empty() {
                    // Fallback to the same default master_token defined in stepbit-core
                    stepbit_core.api_key = Some("sk-dev-key-123".to_string());
                } else {
                    stepbit_core.api_key = Some(expanded);
                }
            }
        }
        if let Some(ref mut stepbit_memory) = app_config.llm.stepbit_memory {
            stepbit_memory.base_url = expand_env(&stepbit_memory.base_url);
            if let Some(ref key) = stepbit_memory.api_key {
                let expanded = expand_env(key);
                if expanded == "${STEPBIT_MEMORY_API_KEY}" || expanded.is_empty() {
                    stepbit_memory.api_key = None;
                } else {
                    stepbit_memory.api_key = Some(expanded);
                }
            }
        }

        Ok(app_config)
    }
}

fn expand_env(val: &str) -> String {
    if val.starts_with("${") && val.ends_with('}') {
        let var_name = &val[2..val.len() - 1];
        std::env::var(var_name).unwrap_or_else(|_| val.to_string())
    } else {
        val.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::AppConfig;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn load_expands_stepbit_memory_config() {
        let temp_path = std::env::temp_dir().join(format!(
            "stepbit-ui-config-{}.yaml",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock before unix epoch")
                .as_nanos()
        ));

        fs::write(
            &temp_path,
            r#"
server:
  host: "127.0.0.1"
  port: 8080

database:
  path: "./chat.db"

auth:
  api_keys: ["sk-dev-key-123"]
  token_expiry_hours: 24

llm:
  provider: "stepbit-core"
  model: "mistral-7b.gguf"
  stepbit_memory:
    base_url: "${STEPBIT_MEMORY_BASE_URL}"
    api_key: "${STEPBIT_MEMORY_API_KEY}"

chat:
  max_history_messages: 50
  system_prompt: "Hello"
"#,
        )
        .expect("write temp config");

        std::env::set_var("STEPBIT_MEMORY_BASE_URL", "http://127.0.0.1:7077");
        std::env::set_var("STEPBIT_MEMORY_API_KEY", "sk-memory");

        let config = AppConfig::load(temp_path.to_str().expect("temp path utf-8"))
            .expect("load config");

        assert_eq!(
            config.llm.stepbit_memory.as_ref().unwrap().base_url,
            "http://127.0.0.1:7077"
        );
        assert_eq!(
            config.llm.stepbit_memory.as_ref().unwrap().api_key.as_deref(),
            Some("sk-memory")
        );

        let _ = fs::remove_file(temp_path);
        std::env::remove_var("STEPBIT_MEMORY_BASE_URL");
        std::env::remove_var("STEPBIT_MEMORY_API_KEY");
    }
}
