import json
import boto3
import os
import logging
from botocore.config import Config

logger = logging.getLogger(__name__)

class S3Service:
    """Handles S3 downloads and uploads."""
    def __init__(self, region):
        self.s3 = boto3.client("s3", region_name=region)

    def download_file(self, bucket, key, local_path):
        self.s3.download_file(bucket, key, local_path)

    def upload_json(self, bucket, key, data):
        self.s3.put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(data, indent=2)
        )

class AgentClient:
    """Manages Bedrock Agent invocation and trace processing."""
    def __init__(self, region):
        config = Config(
           retries = {
              'max_attempts': 10,
              'mode': 'adaptive'  
           }
        )
        self.bedrock_agent_runtime = boto3.client("bedrock-agent-runtime", 
        region_name=region,
        config=config)

    def invoke(self, agent_id, agent_alias_id, input_text, session_id):
        response = self.bedrock_agent_runtime.invoke_agent(
            agentId=agent_id,
            agentAliasId=agent_alias_id,
            sessionId=session_id,
            inputText=input_text,
            enableTrace=True
        )
        
        full_response = ""
        retrieved_contexts = []
        
        for event in response['completion']:
            if 'chunk' in event:
                full_response += event['chunk']['bytes'].decode('utf-8')
            if 'trace' in event:
                trace = event['trace'].get('trace', {})
                observation = trace.get('orchestrationTrace', {}).get('observation', {})
                if 'knowledgeBaseLookupOutput' in observation:
                    references = observation['knowledgeBaseLookupOutput'].get('retrievedReferences', [])
                    for ref in references:
                        retrieved_contexts.append(ref['content']['text'])
                        
        return full_response, retrieved_contexts
