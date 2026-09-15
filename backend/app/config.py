from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT_DIR / ".env", extra="ignore")

    anthropic_api_key: str = ""
    google_maps_api_key: str = ""
    claude_model: str = "claude-sonnet-5"

    basic_auth_user: str = ""
    basic_auth_pass: str = ""

    db_path: Path = ROOT_DIR / "backend" / "data" / "profiles.db"
    static_dir: Path = ROOT_DIR / "frontend" / "dist"

    profile_ttl_days: int = 7
    enrich_concurrency: int = 4
    enrich_timeout_s: float = 120


settings = Settings()
