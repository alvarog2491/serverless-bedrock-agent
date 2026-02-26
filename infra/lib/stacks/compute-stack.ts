import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { AppSettings } from '../../config/config-manager';
import { BedrockAgentConstruct } from '../constructs/compute/bedrock-agent';

export interface ComputeStackProps extends cdk.StackProps {
    readonly config: AppSettings;
    readonly knowledgeBase: bedrock.IVectorKnowledgeBase;
    readonly leadTable: dynamodb.ITable;
}

// Main stack for compute resources including the Bedrock agent
export class ComputeStack extends cdk.Stack {
    public readonly agent: bedrock.IAgent;
    public readonly agentAlias: bedrock.IAgentAlias;
    public readonly inferenceProfileId: string;

    constructor(scope: Construct, id: string, props: ComputeStackProps) {
        super(scope, id, props);
        const { config } = props;

        // Creates the Bedrock agent with required bucket and table permissions
        const bedrockAgent = new BedrockAgentConstruct(this, 'BedrockAgent', {
            config,
            knowledgeBase: props.knowledgeBase,
            leadTableArn: props.leadTable.tableArn,
            leadTableName: props.leadTable.tableName,
        });
        this.agent = bedrockAgent.agent;
        this.agentAlias = bedrockAgent.agentAlias;
        this.inferenceProfileId = bedrockAgent.inferenceProfileId;
    }
}
