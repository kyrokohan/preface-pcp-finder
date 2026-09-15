from fastapi.testclient import TestClient

from app import main

# Not used as a context manager, so the lifespan (API clients, database) never starts: these
# requests only exercise the auth middleware and static routes.
client = TestClient(main.app)


def configure_auth(monkeypatch, user: str, password: str) -> None:
    monkeypatch.setattr(main.settings, "basic_auth_user", user)
    monkeypatch.setattr(main.settings, "basic_auth_pass", password)


def test_health_check_stays_open_for_the_platform(monkeypatch):
    configure_auth(monkeypatch, "navigator", "secret")
    assert client.get("/api/health").status_code == 200


def test_routes_require_the_configured_credentials(monkeypatch):
    configure_auth(monkeypatch, "navigator", "secret")
    assert client.get("/api/payers").status_code == 401
    assert client.get("/api/payers", auth=("navigator", "wrong")).status_code == 401
    assert client.get("/api/payers", auth=("navigator", "secret")).status_code == 200


def test_empty_configured_password_never_matches(monkeypatch):
    configure_auth(monkeypatch, "navigator", "")
    assert client.get("/api/payers", auth=("navigator", "")).status_code == 401
