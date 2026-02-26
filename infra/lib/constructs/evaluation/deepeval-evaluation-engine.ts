import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';
import { AppSettings } from '../../../config/config-manager';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';

export interface DeepEvalEvaluationEngineProps {
    readonly config: AppSettings;
    readonly agent: bedrock.IAgent;
    readonly agentAlias: bedrock.IAgentAlias;
    readonly resultsBucket: s3.IBucket;
    readonly evalDataKey: string;
    readonly vpc: ec2.IVpc;
}

// Construct that defines the ECS Fargate task for running DeepEval evaluations
export class DeepEvalEvaluationEngine extends Construct {
    public readonly taskDefinition: ecs.FargateTaskDefinition;

    constructor(scope: Construct, id: string, props: DeepEvalEvaluationEngineProps) {
        super(scope, id);

        const { config } = props;

        // Provisions the Fargate task definition with ARM64 architecture for performance
        this.taskDefinition = new ecs.FargateTaskDefinition(this, 'DeepEvalTaskDef', {
            memoryLimitMiB: 4096,
            cpu: 2048,
            runtimePlatform: {
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                cpuArchitecture: ecs.CpuArchitecture.X86_64,
            },
        });

        const logGroup = new logs.LogGroup(this, 'DeepEvalLogGroup', {
            logGroupName: `/aws/ecs/${props.config.stage}-deepeval-evaluation-engine`,
            retention: config.logRetention,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Adds the evaluation container using logic from the deepeval_evaluator directory
        this.taskDefinition.addContainer('DeepEvalContainer', {
            image: ecs.ContainerImage.fromAsset(path.join(__dirname, '../../../../src/jobs/evaluation/deepeval_evaluator'), {
                platform: ecr_assets.Platform.LINUX_AMD64,
            }),
            logging: ecs.LogDrivers.awsLogs({
                logGroup: logGroup,
                streamPrefix: 'DeepEvalEval'
            }),
            environment: {
                AGENT_ID: props.agent.agentId,
                AGENT_ALIAS_ID: props.agentAlias.aliasId,
                EVAL_DATA_BUCKET: props.resultsBucket.bucketName,
                RESULTS_BUCKET: props.resultsBucket.bucketName,
                EVAL_DATA_KEY: props.evalDataKey,
                JUDGE_MODEL_ID: config.evaluationJudgeModel,
                EMBEDDING_MODEL_ID: config.embeddingModel,
                METRICS_ADAPTER_MODEL_ID: config.evaluationJudgeModel,
                VPC_ID: props.vpc.vpcId,
                DEEPEVAL_PER_ATTEMPT_TIMEOUT_SECONDS_OVERRIDE: '600',
            },
        });

        // Configures necessary IAM roles and permissions for the evaluation task
        this.configurePermissions(props, config.evaluationJudgeModel, config.embeddingModel, config.agentModel);
    }

    /**
     * Configures IAM permissions for the evaluation task
     */
    private configurePermissions(props: DeepEvalEvaluationEngineProps, judgeModelId: string, embeddingModelId: string, agentModelId: string): void {
        const role = this.taskDefinition.taskRole;
        const stack = cdk.Stack.of(this);
        const { config } = props;

        // Build ARNs for Foundation Models
        const modelArns = [
            `arn:aws:bedrock:*::foundation-model/${judgeModelId}`,
            `arn:aws:bedrock:*::foundation-model/${embeddingModelId}`,
            `arn:aws:bedrock:*::foundation-model/${agentModelId}`
        ];

        // Inference Profile Permission (region-specific based on config)
        const regionPrefix = config.region.split('-')[0]; // Extract first part (us, eu, ap, etc.)
        const inferenceProfileArns = [
            `arn:aws:bedrock:*:${stack.account}:inference-profile/${regionPrefix}.${judgeModelId}`,
            `arn:aws:bedrock:*:${stack.account}:inference-profile/${regionPrefix}.${embeddingModelId}`,
            `arn:aws:bedrock:*:${stack.account}:inference-profile/${regionPrefix}.${agentModelId}`
        ];

        role.addToPrincipalPolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel'],
            resources: [...modelArns, ...inferenceProfileArns],
        }));
        props.agentAlias.grantInvoke(role);
        props.resultsBucket.grantReadWrite(role);

    }
}