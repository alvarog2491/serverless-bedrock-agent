import os, uuid, json, time
import boto3
import backoff
from typing import Optional
from pydantic import BaseModel, Field, field_validator

# AWS Lambda Powertools
from aws_lambda_powertools import Logger, Tracer, Metrics
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities import parameters
from aws_lambda_powertools.utilities.typing import LambdaContext

# Langfuse Observability
from langfuse import Langfuse, observe, propagate_attributes

# Setup & Resource Initialization
logger, tracer, metrics = Logger(), Tracer(), Metrics(namespace="LeadGenBot", service="AgentPerformance")
bedrock = boto3.client("bedrock-agent-runtime")
langfuse_client: Optional[Langfuse] = None

def generate_session_id() -> str:
    """
    Generate a new session ID and record metrics/logs for a new session.
    """
    logger.info("New session started (no client-side ID provided)")
    metrics.add_metric(name="SessionInvocation", unit=MetricUnit.Count, value=1)
    return str(uuid.uuid4())

class BedrockAgentRequest(BaseModel):
    """
    Data model for a Bedrock Agent invocation request.
    """
    prompt: str = Field(
        ..., 
        min_length=int(os.environ.get("PROMPT_MIN_LENGTH", 1)), 
        max_length=int(os.environ.get("PROMPT_MAX_LENGTH", 500))
    )
    sessionId: str = Field(default_factory=generate_session_id)

    @field_validator("sessionId", mode="before")
    @classmethod
    def validate_sid(cls, v):
        """
        Validate and normalize the session ID; generates one if missing or empty.
        """
        if v is None or not str(v).strip():
            return generate_session_id()
        return str(v).strip()

# Observability Setup
@tracer.capture_method
def init_langfuse():
    """
    Initialize the Langfuse client if not already initialized.
    """
    global langfuse_client
    if langfuse_client: return
    try:
        # Fetch Langfuse credentials from AWS Secrets Manager
        secret_name = os.environ.get("LANGFUSE_SECRET_NAME") or os.environ.get("LANGFUSE_SECRET_ARN")
        creds = parameters.get_secret(secret_name, transform="json")
        
        # Update environment with Langfuse configuration
        os.environ.update({
            "LANGFUSE_SECRET_KEY": creds["LANGFUSE_SECRET_KEY"],
            "LANGFUSE_PUBLIC_KEY": creds["LANGFUSE_PUBLIC_KEY"],
            "LANGFUSE_BASE_URL": creds["LANGFUSE_BASE_URL"]
        })
        langfuse_client = Langfuse()
    except Exception as e:
        logger.error(f"Langfuse init failed: {e}")

# Initialize Langfuse at module level
init_langfuse()

@tracer.capture_method
@backoff.on_exception(backoff.expo, Exception, max_tries=3)
@observe(as_type="generation", name="Bedrock Agent Invocation")
def invoke_agent(session_id: str, prompt: str) -> str:
    """
    Invoke the Bedrock Agent with a prompt.

    Args:
    session_id (str): The session ID for the interaction.
    prompt (str): The user prompt.

    Returns:
    str: The concatenated response from the agent.
    """
    # Propagate attributes to Langfuse and invoke the agent
    with propagate_attributes(session_id=session_id):   
        response = bedrock.invoke_agent(
            agentId=os.environ["AGENT_ID"],
            agentAliasId=os.environ["AGENT_ALIAS_ID"],
            sessionId=session_id,
            inputText=prompt,
            enableTrace=True
        )

    # Extract text chunks from the event stream
    chunks = []
    for event in response.get("completion", []):
        if "chunk" in event:
            chunks.append(event["chunk"]["bytes"].decode("utf-8"))
    
    # Return the assembled response text
    response_text = "".join(chunks)
    return response_text

@logger.inject_lambda_context(log_event=True, correlation_id_path='requestContext.requestId')
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start=True)
def handler(event: dict, context: LambdaContext):
    """
    AWS Lambda handler for invoking a Bedrock Agent with retry logic.

    Args:
    event (dict): The AWS Lambda event.
        Expected structure (JSON body via API Gateway):
        {
            "body": {
                "prompt": str, (Required)
                "sessionId": str (Optional)
            }
        }
    context (LambdaContext): The AWS Lambda context.

    Returns:
    dict: An API Gateway-compatible response dictionary.
    """
    # Add structured logging fields
    logger.append_keys(
        service="agent-invoker",
        environment=os.environ.get('STAGE', 'unknown')
    )
    
    try:
        # Parse body regardless of API Gateway or direct invocation
        body = event.get("body", {})
        if isinstance(body, str):
            body_dict = json.loads(body)
        else:
            body_dict = body

        # Validate the request data (automatically handles session ID generation and metrics)
        data = BedrockAgentRequest.model_validate(body_dict)
    
        # Trigger agent invocation with standard retry mechanism
        result = invoke_agent(data.sessionId, data.prompt)
        return build_resp(200, {"response": result, "sessionId": data.sessionId}, event)

    except Exception as e:
        # Log final failure after all retries
        logger.exception("Handler failed", extra={"error": str(e)}) 
        return build_resp(500, {"error": "Internal Server Error"}, event)
    finally:
        # Ensure Langfuse traces are flushed
        if langfuse_client: langfuse_client.flush()

def build_resp(code: int, body: dict, event: dict):
    """
    Build a standard API Gateway response with CORS headers.

    Args:
    code (int): HTTP status code.
    body (dict): Response body dictionary.
    event (dict): Original Lambda event.

    Returns:
    dict: Formatted response dictionary.
    """
    # Normalize headers to lowercase for lookups
    request_headers = {k.lower(): v for k, v in (event.get('headers') or {}).items()}
    origin = request_headers.get('origin')
    
    # Check if origin is allowed for CORS
    allowed = os.environ.get('ALLOWED_ORIGINS', '').split(',')
    headers = {"Content-Type": "application/json"}
    
    # Add CORS headers if origin is authorized
    if origin in allowed:
        headers.update({"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true"})
        
    return {"statusCode": code, "headers": headers, "body": json.dumps(body)}