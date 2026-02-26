import os, uuid, json
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field, EmailStr
from aws_lambda_powertools import Logger, Tracer, Metrics
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.typing import LambdaContext
import boto3

# Setup & Resource Initialization
logger, tracer, metrics = Logger(), Tracer(), Metrics(namespace="LeadGenBot", service="AgentPerformance")
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ.get('LEADS_TABLE_NAME', ''))


class LeadRequest(BaseModel):
    """
    Data model for a lead collection request.
    """
    # EmailStr provides better validation than a manual regex
    email: EmailStr
    reason: str = "User inquiry"

# Bedrock Agent Helpers
def parse_properties(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Flattens Bedrock properties list into a standard dictionary.

    Args:
    event (Dict[str, Any]): The Bedrock agent event dictionary.

    Returns:
    Dict[str, Any]: A dictionary of flattened properties.
    """
    try:
        # Navigate to the properties list in the Bedrock event structure
        properties = event.get('requestBody', {}).get('content', {}).get('application/json', {}).get('properties', [])
        
        # Flatten the list of {'name': ..., 'value': ...} into a dict
        return {p['name']: p['value'] for p in properties if 'name' in p}
    except (AttributeError, TypeError):
        # Fallback to the raw request body if properties extraction fails
        return event.get('requestBody', {})

def build_agent_resp(event: Dict[str, Any], status: int, body: dict) -> dict:
    """
    Formats the response specifically for Bedrock Agent Action Groups.

    Args:
    event (Dict[str, Any]): The original Bedrock agent event.
    status (int): The HTTP status code to return.
    body (dict): The response body dictionary.

    Returns:
    dict: A formatted Bedrock Agent response.
    """
    return {
        'messageVersion': '1.0',
        'response': {
            'actionGroup': event.get('actionGroup', 'Unknown'),
            'apiPath': event.get('apiPath', '/'),
            'httpMethod': event.get('httpMethod', 'POST'),
            'httpStatusCode': status,
            'responseBody': {'application/json': {'body': json.dumps(body)}}
        }
    }

# Main Handler
@logger.inject_lambda_context(log_event=True, correlation_id_path='requestContext.requestId')
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event: Dict[str, Any], context: LambdaContext):
    """
    AWS Lambda handler for collecting lead information via Bedrock Agent.

    Args:
    event (Dict[str, Any]): The AWS Lambda event.
        Expected structure from Bedrock Agent Action Group:
        {
            "actionGroup": str,
            "apiPath": str,
            "httpMethod": str,
            "requestBody": {
                "content": {
                    "application/json": {
                        "properties": [
                            {"name": "email", "value": str},
                            {"name": "reason", "value": str}
                        ]
                    }
                }
            }
        }
    context (LambdaContext): The AWS Lambda context.

    Returns:
    dict: A Bedrock Agent action group response.
    """
    # Add structured logging fields
    logger.append_keys(
        service="lead-collector",
        environment=os.environ.get('STAGE', 'unknown')
    )
    
    try:
        # Validate input parameters from the agent event
        data = LeadRequest(**parse_properties(event))

        # Generate unique ID for the new lead
        lead_id = str(uuid.uuid4())
        
        # Save lead information to DynamoDB
        table.put_item(Item={
            'lead_id': lead_id,
            'email': data.email,
            'reason': data.reason,
            'created_at': datetime.now(timezone.utc).isoformat(),
            'status': 'new',
            'session_id': event.get('sessionId')
        })

        # Log success and update metrics
        logger.info(f"Lead collected", extra={"lead_id": lead_id, "email": data.email})
        metrics.add_metric(name="LeadCaptured", unit=MetricUnit.Count, value=1)

        # Build user-friendly response message
        resp_msg = f"Got it! I've saved your request. We'll contact you at {data.email} soon."
        return build_agent_resp(event, 200, {"success": True, "message": resp_msg})

    except Exception as e:
        # Handle failures and log errors
        logger.exception("Lead collection failed")
        metrics.add_metric(name="ActionGroupFailure", unit=MetricUnit.Count, value=1)
        return build_agent_resp(event, 500, {"success": False, "message": "I couldn't save your info."})