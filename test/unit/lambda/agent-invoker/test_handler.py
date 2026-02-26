"""
Core tests for the agent-invoker Lambda function.
Covers request validation, agent invocation, error handling, and CORS.
"""
import pytest
import json
import os
import sys
import uuid
from unittest.mock import patch, MagicMock
from pathlib import Path
from botocore.exceptions import ClientError
from pydantic import ValidationError

LAMBDA_PATH = Path(__file__).parent.parent.parent.parent.parent / "src" / "lambda" / "agent-invoker"
sys.path.insert(0, str(LAMBDA_PATH))

# Set environment variables before importing the handler
os.environ["AGENT_ID"] = "TESTAGENT1"
os.environ["AGENT_ALIAS_ID"] = "TESTALIAS1"
os.environ["ALLOWED_ORIGINS"] = "http://localhost:3000,https://example.com"
os.environ["AWS_DEFAULT_REGION"] = "us-east-1"
os.environ["STAGE"] = "test"

@pytest.fixture(autouse=True)
def setup_env():
    """Ensure environment variables are consistently set for each test."""
    os.environ["AGENT_ID"] = "TESTAGENT1"
    os.environ["AGENT_ALIAS_ID"] = "TESTALIAS1"
    os.environ["ALLOWED_ORIGINS"] = "http://localhost:3000"
    os.environ["AWS_DEFAULT_REGION"] = "us-east-1"
    os.environ["STAGE"] = "test"

@pytest.fixture(autouse=True)
def mock_langfuse():
    """Mock Langfuse to prevent telemetry export during tests."""
    with patch("index.langfuse_client", MagicMock()), \
         patch("index.init_langfuse", MagicMock()):
        yield

@pytest.mark.unit
class TestAgentInvokerLambda:

    def test_bedrock_request_validation_valid(self):
        """Test BedrockAgentRequest generates a sessionId when missing."""
        from index import BedrockAgentRequest
        
        req = BedrockAgentRequest(prompt="Hello there")
        assert req.prompt == "Hello there"
        assert len(req.sessionId) == 36

        req2 = BedrockAgentRequest(prompt="Hello", sessionId="custom-123")
        assert req2.sessionId == "custom-123"

    def test_bedrock_request_validation_empty_prompt(self):
        """Test prompt validation fails if empty."""
        from index import BedrockAgentRequest
        with pytest.raises(ValidationError):
            BedrockAgentRequest(prompt="")

    @patch("index.bedrock")
    def test_handler_success(self, mock_bedrock):
        """Test the handler correctly processes a valid request and returns the concatenated chunks."""
        from index import handler
        
        mock_bedrock.invoke_agent.return_value = {
            "completion": [
                {"chunk": {"bytes": b"Hello from "}},
                {"chunk": {"bytes": b"Bedrock!"}}
            ]
        }
        
        event = {
            "body": json.dumps({"prompt": "Say hello", "sessionId": "test-session-123"}),
            "headers": {"origin": "http://localhost:3000"}
        }
        
        response = handler(event, MagicMock())
        
        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["response"] == "Hello from Bedrock!"
        assert body["sessionId"] == "test-session-123"
        assert response["headers"]["Access-Control-Allow-Origin"] == "http://localhost:3000"

    @patch("index.bedrock")
    def test_handler_empty_completion(self, mock_bedrock):
        """Test the handler correctly returns an empty string when the completion stream has no chunks."""
        from index import handler
        
        mock_bedrock.invoke_agent.return_value = {"completion": []}
        event = {"body": json.dumps({"prompt": "Test"}), "headers": {}}
        response = handler(event, MagicMock())
        
        assert response["statusCode"] == 200
        assert json.loads(response["body"])["response"] == ""

    @patch("index.invoke_agent")
    def test_handler_invalid_json(self, mock_invoke):
        """Test the handler returns a 500 when it fails to parse the body or validate."""
        from index import handler
        event = {"body": "invalid-json"}
        response = handler(event, MagicMock())
        
        assert response["statusCode"] == 500
        mock_invoke.assert_not_called()

    @patch("index.bedrock")
    def test_handler_bedrock_error(self, mock_bedrock):
        """Test the handler catches Bedrock errors and returns a 500 response."""
        from index import handler
        
        mock_bedrock.invoke_agent.side_effect = ClientError(
            {"Error": {"Code": "ThrottlingException", "Message": "Rate exceeded"}},
            "InvokeAgent"
        )
        
        with patch("index.metrics", MagicMock()), patch("index.tracer", MagicMock()):
            event = {"body": json.dumps({"prompt": "Test"}), "headers": {}}
            response = handler(event, MagicMock())
        
        assert response["statusCode"] == 500
        body = json.loads(response["body"])
        assert body["error"] == "Internal Server Error"

