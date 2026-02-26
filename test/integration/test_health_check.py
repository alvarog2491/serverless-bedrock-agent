import os
import requests
import pytest
import argparse
import sys
import boto3
from requests_aws4auth import AWS4Auth

def test_health_check(api_url):
    """
    Integration test for the /health endpoint.
    Verifies that the system returns a 200 OK and 'healthy' status.
    """
    health_url = f"{api_url.rstrip('/')}/health"
    print(f"Checking health at: {health_url}")
    
    # Setup AWS4Auth
    session = boto3.Session()
    credentials = session.get_credentials()
    auth = AWS4Auth(
        credentials.access_key, 
        credentials.secret_key, 
        session.region_name, 
        'execute-api', 
        session_token=credentials.token
    )
    
    response = requests.get(health_url, auth=auth)
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}. Body: {response.text}"
    
    data = response.json()
    assert data.get('status') == 'healthy', f"Expected status 'healthy', got '{data.get('status')}'"
    assert 'checks' in data, "Response body should contain 'checks' details"
    
    print("Health check passed!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run health check integration test")
    parser.add_argument("--api-url", required=True, help="The API Gateway base URL")
    args = parser.parse_args()
    
    try:
        test_health_check(args.api_url)
    except Exception as e:
        print(f"Test failed: {e}")
        sys.exit(1)
