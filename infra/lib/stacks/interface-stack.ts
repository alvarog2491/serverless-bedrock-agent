import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AppSettings } from '../../config/config-manager';
import { ApiGatewayConstruct } from '../constructs/interface/api-gateway';

export interface InterfaceStackProps extends cdk.StackProps {
    readonly config: AppSettings;
    readonly agent: bedrock.IAgent;
    readonly agentAlias: bedrock.IAgentAlias;
    readonly leadTable: dynamodb.ITable;
    readonly knowledgeBaseBucket: s3.IBucket;
}

// Stack that exposes the Bedrock agent via API Gateway
export class InterfaceStack extends cdk.Stack {
    public readonly api: apigateway.RestApi;
    public readonly agentInvokerFunction: lambda.IFunction;

    constructor(scope: Construct, id: string, props: InterfaceStackProps) {
        super(scope, id, props);
        const { config } = props;

        // Provisions API Gateway to handle agent interaction requests
        const apiGateway = new ApiGatewayConstruct(this, 'ApiGateway', {
            config,
            agent: props.agent,
            agentAlias: props.agentAlias,
            stage: config.stage,
            leadTable: props.leadTable,
            knowledgeBaseBucket: props.knowledgeBaseBucket,
        });

        this.api = apiGateway.api;
        this.agentInvokerFunction = apiGateway.handler;

        new cdk.CfnOutput(this, 'ApiGatewayUrl', {
            value: this.api.url,
            description: 'The URL of the API Gateway endpoint',
            exportName: `ApiUrl-${config.stage}`,
        });

        new cdk.CfnOutput(this, 'ApiKeyId', {
            value: apiGateway.apiKey.keyId,
            description: 'API Key ID — retrieve the value with: aws apigateway get-api-key --api-key <id> --include-value',
            exportName: `ApiKeyId-${config.stage}`,
        });
    }
}
