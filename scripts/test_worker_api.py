
import json
import os
from pathlib import Path
from fastapi.testclient import TestClient
from apps.worker.api import app

# Create dummy status file
status_path = Path("apps/worker/status.json")
dummy_data = {
    "jobs_executed": 10,
    "jobs_failed": 1,
    "jobs_missed": 0,
    "last_run": "2023-01-01T12:00:00",
    "last_success": "2023-01-01T12:00:00",
    "last_failure": "2023-01-01T10:00:00",
    "running": True,
    "jobs": [
        {"id": "test_job", "next_run": "2023-01-01T13:00:00"}
    ]
}

def test_api_status():
    print("Creating dummy status file...")
    with open(status_path, "w") as f:
        json.dump(dummy_data, f)
        
    client = TestClient(app)
    
    print("Testing GET /worker/status...")
    response = client.get("/worker/status")
    
    print(f"Status Code: {response.status_code}")
    print(f"Response: {response.json()}")
    
    assert response.status_code == 200
    data = response.json()
    assert data["jobs_executed"] == 10
    assert data["jobs"][0]["id"] == "test_job"
    
    print("SUCCESS: API returned correct status")
    
    # Clean up
    if status_path.exists():
        os.remove(status_path)

if __name__ == "__main__":
    test_api_status()
