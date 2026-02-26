import os
import json
import boto3
import logging
from typing import Dict, Any

# Setup Standard Logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO'))

# Resource Initialization
dynamodb = boto3.client('dynamodb')
s3 = boto3.client('s3')
bedrock = boto3.client('bedrock-agent')

def check_dynamodb() -> bool:
    """
    Verify DynamoDB table is accessible.
    """
    try:
        table_name = os.environ.get('LEADS_TABLE_NAME')
        if not table_name:
            logger.error("LEADS_TABLE_NAME environment variable not set")
            return False
        
        # Use scan with Limit=1 to verify data access (ReadData permission)
        dynamodb.scan(TableName=table_name, Limit=1)
        logger.debug(f"DynamoDB check passed for table: {table_name}")
        return True
    except Exception as e:
        logger.error(f"DynamoDB check failed: {str(e)}", exc_info=True)
        return False

def check_s3() -> bool:
    """
    Verify S3 bucket is accessible.
    """
    try:
        bucket_name = os.environ.get('KB_BUCKET_NAME')
        if not bucket_name:
            logger.error("KB_BUCKET_NAME environment variable not set")
            return False
        
        s3.head_bucket(Bucket=bucket_name)
        logger.debug(f"S3 check passed for bucket: {bucket_name}")
        return True
    except Exception as e:
        logger.error(f"S3 check failed: {str(e)}", exc_info=True)
        return False

def check_bedrock() -> bool:
    """
    Verify Bedrock Agent is accessible.
    """
    try:
        agent_id = os.environ.get('AGENT_ID')
        if not agent_id:
            logger.error("AGENT_ID environment variable not set")
            return False
        
        bedrock.get_agent(agentId=agent_id)
        logger.debug(f"Bedrock check passed for agent: {agent_id}")
        return True
    except Exception as e:
        logger.error(f"Bedrock check failed: {str(e)}", exc_info=True)
        return False

def handler(event: Dict[str, Any], context: Any) -> dict:
    """
    AWS Lambda handler for health check endpoint.
    Uses standard logging instead of Powertools to avoid dependency issues.

    Args:
    event (Dict[str, Any]): The AWS Lambda event.
        Expected structure: API Gateway GET request (standard proxy event).
    context (Any): The AWS Lambda context.
    """
    logger.info("Health check initiated", extra={
        "service": "health-check",
        "environment": os.environ.get('STAGE', 'unknown'),
        "request_id": context.aws_request_id if context else "unknown"
    })
    
    # Run all health checks
    checks = {
        'dynamodb': check_dynamodb(),
        's3': check_s3(),
        'bedrock': check_bedrock(),
    }
    
    # Determine overall health status
    all_healthy = all(checks.values())
    status = 'healthy' if all_healthy else 'unhealthy'
    status_code = 200 if all_healthy else 503
    
    logger.info(f"Health check completed: {status}", extra={"checks": checks})
    
    # Build response
    response_body = {
        'status': status,
        'checks': checks
    }
    
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        },
        'body': json.dumps(response_body)
    }
