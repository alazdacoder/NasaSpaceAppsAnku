import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    import os
    os.environ["HUB_DB"] = str(tmp_path_factory.mktemp("db") / "hub.db")
    from app.main import app
    with TestClient(app) as c:
        c.post("/api/demo/speed", json={"day_seconds": 0})
        yield c


@pytest.mark.parametrize("path", [
    "/api/meta", "/api/clock", "/api/crew/c1/today", "/api/crew/c1/alerts", "/api/crew/c1/body",
    "/api/crew/c1/exercise", "/api/crew/c1/nutrition", "/api/crew/c1/lab", "/api/crew/c1/environment",
    "/api/devices?crew=c1", "/api/surgeon/overview", "/api/surgeon/crew/c1/series", "/api/surgeon/correlations",
    "/api/surgeon/events", "/api/link", "/api/sources", "/api/demo/events",
])
def test_endpoints_respond(client, path):
    r = client.get(path)
    assert r.status_code == 200, r.text


def test_unknown_crew_404(client):
    assert client.get("/api/crew/zz/today").status_code == 404


def test_demo_flow_over_api(client):
    today = client.get("/api/crew/c1/today").json()
    assert today["overall"] == "red"
    task = next(t for t in today["tasks"] if t["task_id"] == "supplement_start:potassium_citrate")
    r = client.post(f"/api/crew/c1/tasks/{task['task_id']}/confirm")
    assert r.status_code == 200
    lab = client.get("/api/crew/c1/lab").json()
    assert any(p["started_by"] == "crew" for p in lab["protocols"])
    client.post("/api/demo/skip", json={"days": 8})
    lab = client.get("/api/crew/c1/lab").json()
    p = next(p for p in lab["protocols"] if p["started_by"] == "crew")
    assert p["score"] > 0.4


def test_workout_and_manual_entries(client):
    r = client.post("/api/crew/c2/workout/start", json={"device": "ared", "settings": {"load_kg": 999}})
    assert r.status_code == 200 and r.json()["settings"]["load_kg"] == 272
    r = client.post("/api/crew/c2/workout/update", json={"settings": {"load_kg": 500}, "log_set": True})
    assert r.json()["settings"]["load_kg"] == 272          # capped at ARED peak load
    r = client.post("/api/crew/c2/workout/finish")
    assert r.status_code == 200 and r.json()["device"] == "ared"
    assert client.post("/api/crew/c2/manual", json={"kind": "water", "liters": 0.5}).status_code == 200
    assert client.post("/api/crew/c2/manual", json={"kind": "feeling", "value": 9}).status_code == 400
    assert client.post("/api/crew/c2/manual", json={"kind": "food", "item": "snack"}).status_code == 200


def test_csv_import(client):
    csv = "crew_id,day,metric,value\nc1,5,hr_rest,61\nc1,5,nope,1\n"
    r = client.post("/api/import/csv", content=csv)
    body = r.json()
    assert body["imported"] == 1 and body["errors"]


def test_profile_switch(client):
    r = client.post("/api/demo/profile", json={"profile": "mars", "delay_s": 60})
    assert r.json()["profile"] == "mars" and r.json()["delay_s"] == 60
    client.post("/api/demo/profile", json={"profile": "iss"})
