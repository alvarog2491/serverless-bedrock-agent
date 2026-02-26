import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';
import { AppSettings } from '../../../config/config-manager';

export interface ApiGatewayConstructProps {
    readonly config: AppSettings;
    readonly agent: bedrock.IAgent;
    readonly agentAlias: bedrock.IAgentAlias;
    readonly stage: string;
    readonly leadTable: dynamodb.ITable;
    readonly knowledgeBaseBucket: s3.IBucket;
}

/**
 * Infrastructure construct for the Bedrock Agent API.
 * Designed specifically for Secure Server-to-Server communication.
 */
export class ApiGatewayConstruct extends Construct {
    public readonly api: apigateway.RestApi;
    public readonly handler: lambda.IAlias;
    public readonly apiKey: apigateway.IApiKey;

    constructor(scope: Construct, id: string, props: ApiGatewayConstructProps) {
        super(scope, id);

        this.handler = this.createAgentInvokerFunction(props);
        this.api = this.createRestApi(props);
        this.addAgentEndpoint(props);
        this.addHealthCheckEndpoint(props);
        this.apiKey = this.configureApiKeyAndUsagePlan(props.config);
    }

    /**
     * Creates the Lambda function that interacts with Bedrock Agent.
     * Uses IAM least privilege for execution.
     */
    private createAgentInvokerFunction(props: ApiGatewayConstructProps): lambda.IAlias {
        const { config } = props;

        const fn = new PythonFunction(this, 'ApiHandler', {
            entry: path.join(__dirname, '../../../../src/lambda/agent-invoker'),
            runtime: config.lambdaRuntime,
            architecture: lambda.Architecture.X86_64,
            index: 'index.py',
            handler: 'handler',
            timeout: cdk.Duration.seconds(60),
            tracing: lambda.Tracing.ACTIVE,
            environment: {
                AGENT_ID: props.agent.agentId,
                AGENT_ALIAS_ID: props.agentAlias.aliasId,
                LANGFUSE_SECRET_NAME: 'langfuse-api-key',
                AGENT_MODEL_ID: config.agentModel,
                PROMPT_MIN_LENGTH: config.promptMinLength.toString(),
                PROMPT_MAX_LENGTH: config.promptMaxLength.toString(),
                STAGE: config.stage,
                LOG_LEVEL: config.stage === 'prod' ? 'INFO' : 'DEBUG',
            },
        });

        const alias = new lambda.Alias(this, 'LambdaAlias', {
            aliasName: config.stage === 'prod' ? 'live' : `${config.stage}-current`,
            version: fn.currentVersion,
        });

        // External observability secret access
        const secret = secretsmanager.Secret.fromSecretNameV2(this, 'LangfuseSecret', 'langfuse-api-key');
        secret.grantRead(fn);

        // LEAST PRIVILEGE: Explicitly allow only InvokeAgent on the specific alias
        alias.addToRolePolicy(new iam.PolicyStatement({
            sid: 'AllowBedrockAgentInvocation',
            actions: ['bedrock:InvokeAgent'],
            resources: [props.agentAlias.aliasArn],
        }));

        return alias;
    }

    /**
     * Provisions a REST API. 
     */
    private createRestApi(props: ApiGatewayConstructProps): apigateway.RestApi {
        const { config } = props;

        const logGroup = new logs.LogGroup(this, 'ApiLogs', {
            logGroupName: `/aws/api-gateway/bedrock-agent-api-${config.stage}`,
            retention: config.logRetention,
            removalPolicy: config.removalPolicy,
        });

        const policyStatements = [
            // Allow invoke from any principal
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                principals: [new iam.AnyPrincipal()],
                actions: ['execute-api:Invoke'],
                resources: [`arn:aws:execute-api:${config.region}:${config.account}:*/*/*`],
            }),
            // Deny all non-HTTPS requests
            new iam.PolicyStatement({
                effect: iam.Effect.DENY,
                principals: [new iam.AnyPrincipal()],
                actions: ['execute-api:Invoke'],
                resources: ['execute-api:/*'],
                conditions: {
                    'Bool': { 'aws:SecureTransport': 'false' },
                },
            }),

            // Deny all POST requests from IPs not in the allowed list
            new iam.PolicyStatement({
                effect: iam.Effect.DENY,
                principals: [new iam.AnyPrincipal()],
                actions: ['execute-api:Invoke'],
                resources: [
                    `arn:aws:execute-api:${config.region}:${config.account}:*/${config.stage}/POST/`
                ],
                conditions: {
                    'NotIpAddress': {
                        'aws:SourceIp': config.allowedIps,
                    },
                },
            })

        ];

        return new apigateway.RestApi(this, 'Endpoint', {
            restApiName: `BedrockAgentApi-${config.stage}`,
            endpointConfiguration: {
                types: [apigateway.EndpointType.REGIONAL],
            },
            deployOptions: {
                stageName: props.stage,
                accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),
                accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                tracingEnabled: true,
            },
            cloudWatchRole: true,
            policy: new iam.PolicyDocument({
                statements: policyStatements,
            }),
        });
    }

    /**
     * Main entry point for the Agent.
     */
    private addAgentEndpoint(props: ApiGatewayConstructProps): void {
        const { config } = props;

        const jsonSchema = {
            prompt: {
                type: apigateway.JsonSchemaType.STRING,
                minLength: config.promptMinLength,
                maxLength: config.promptMaxLength,
            },
            sessionId: {
                type: apigateway.JsonSchemaType.STRING,
            },
        };

        const requestModel = this.api.addModel('RequestModel', {
            contentType: 'application/json',
            schema: {
                schema: apigateway.JsonSchemaVersion.DRAFT4,
                title: 'BedrockAgentRequest',
                type: apigateway.JsonSchemaType.OBJECT,
                properties: jsonSchema,
                required: ['prompt'],
            },
        });

        const validator = this.api.addRequestValidator('RequestValidator', {
            validateRequestBody: true,
            validateRequestParameters: false,
        });

        // POST / - Secured by API Key
        this.api.root.addMethod('POST', new apigateway.LambdaIntegration(this.handler), {
            requestModels: { 'application/json': requestModel },
            requestValidator: validator,
            apiKeyRequired: true,
        });
    }

    /**
     * Diagnostic endpoint. 
     * Uses IAM Authorization for intra-AWS service verification.
     */
    private addHealthCheckEndpoint(props: ApiGatewayConstructProps): void {
        const { config } = props;

        const healthFn = new PythonFunction(this, 'HealthCheckHandler', {
            entry: path.join(__dirname, '../../../../src/lambda/health-check'),
            runtime: config.lambdaRuntime,
            architecture: lambda.Architecture.X86_64,
            index: 'index.py',
            handler: 'handler',
            timeout: cdk.Duration.seconds(10),
            environment: {
                LEADS_TABLE_NAME: props.leadTable.tableName,
                KB_BUCKET_NAME: props.knowledgeBaseBucket.bucketName,
                AGENT_ID: props.agent.agentId,
                STAGE: config.stage,
            },
        });

        // Grant permissions to the health check Lambda
        props.leadTable.grantReadData(healthFn);
        props.knowledgeBaseBucket.grantRead(healthFn);

        healthFn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['bedrock:GetAgent'],
            resources: [props.agent.agentArn],
        }));

        const healthResource = this.api.root.addResource('health');

        healthResource.addMethod('GET', new apigateway.LambdaIntegration(healthFn), {
            // IAM Auth is safer than API Key for purely administrative health checks
            authorizationType: apigateway.AuthorizationType.IAM,
        });
    }

    /**
     * Configures API Keys and Usage Plans to control and monitor consumer traffic.
     */
    private configureApiKeyAndUsagePlan(config: AppSettings): apigateway.IApiKey {
        const apiKey = this.api.addApiKey('ApiKey', {
            apiKeyName: `agent-server-key-${config.stage}`,
            description: `API Key for external server integration (${config.stage})`,
        });

        const usagePlan = this.api.addUsagePlan('UsagePlan', {
            name: `agent-usage-plan-${config.stage}`,
            throttle: {
                rateLimit: 100,  // Requests per second
                burstLimit: 200, // Peak request capacity
            },
            quota: {
                limit: 50000,
                period: apigateway.Period.MONTH,
            },
            apiStages: [
                {
                    api: this.api,
                    stage: this.api.deploymentStage,
                },
            ],
        });

        usagePlan.addApiKey(apiKey);
        return apiKey;
    }
}