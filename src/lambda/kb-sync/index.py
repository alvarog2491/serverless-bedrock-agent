import os
import boto3
from botocore.config import Config
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.utilities.typing import LambdaContext

# Constants
KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID')
DATA_SOURCE_ID = os.environ.get('DATA_SOURCE_ID')

# Setup & Resource Initialization
logger, tracer = Logger(), Tracer()

# Configure boto3 client with exponential backoff and jitter
bedrock_config = Config(
    retries={
        'max_attempts': 5,
        'mode': 'adaptive'  # Includes exponential backoff with jitter
    },
    connect_timeout=10,
    read_timeout=60
)

bedrock_agent_client = boto3.client('bedrock-agent', config=bedrock_config)

@logger.inject_lambda_context(log_event=True, correlation_id_path='requestContext.requestId')
@tracer.capture_lambda_handler
def handler(event: dict, context: LambdaContext):
    """
    AWS Lambda handler to trigger a Knowledge Base ingestion job.

    Args:
    event (dict): The AWS Lambda event.
        Expected structure: S3 event notification or manual trigger.
    context (LambdaContext): The AWS Lambda context.

    Returns:
    dict: A response containing the ingestion job ID or an error message.
    """
    # Add structured logging fields
    logger.append_keys(
        service="kb-sync",
        environment=os.environ.get('STAGE', 'unknown')
    )
    
    # Verify required environment variables
    if not KNOWLEDGE_BASE_ID or not DATA_SOURCE_ID:
        logger.error("Required environment variables are not set.")
        return {'statusCode': 500, 'body': "Configuration error"}

    try:
        logger.info(f"Syncing KB: {KNOWLEDGE_BASE_ID}, DS: {DATA_SOURCE_ID}")
        
        # Start the ingestion job for the specified data source
        response = bedrock_agent_client.start_ingestion_job(
            knowledgeBaseId=KNOWLEDGE_BASE_ID,
            dataSourceId=DATA_SOURCE_ID,
            description='S3 event sync'
        )
        
        # Extract and return the job ID
        job_id = response['ingestionJob']['ingestionJobId']
        return {'statusCode': 200, 'body': f"Job started: {job_id}"}
        
    except Exception:
        # Log failure and return error response
        logger.exception("Failed to start ingestion job")
        return {'statusCode': 500, 'body': "Internal Server Error"}