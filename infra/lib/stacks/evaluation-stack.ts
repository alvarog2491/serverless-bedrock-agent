import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AppSettings } from '../../config/config-manager';
import { DeepEvalEvaluationEngine } from '../constructs/evaluation/deepeval-evaluation-engine';

export interface EvaluationStackProps extends cdk.StackProps {
    readonly config: AppSettings;
    readonly agent: bedrock.IAgent;
    readonly agentAlias: bedrock.IAgentAlias;
    readonly resultsBucket: s3.IBucket;
}

// Stack for RAG evaluation resources using ECS Fargate in Public Subnets
export class EvaluationStack extends cdk.Stack {
    public readonly evalSecurityGroup: ec2.SecurityGroup;

    constructor(scope: Construct, id: string, props: EvaluationStackProps) {
        super(scope, id, props);
        const { config } = props;

        // Configures a public VPC for evaluation tasks with direct internet access
        const vpc = new ec2.Vpc(this, 'EvalVpc', {
            maxAzs: 2,
            natGateways: 0,
            subnetConfiguration: [{
                name: 'Public',
                subnetType: ec2.SubnetType.PUBLIC,
            }],
            restrictDefaultSecurityGroup: false,
        });

        // Provisions an ECS cluster for hosting the evaluation engine
        const cluster = new ecs.Cluster(this, 'EvalCluster', {
            vpc,
            containerInsights: true // Essential for monitoring Fargate performance
        });

        // Zero-Trust Security Group: No inbound traffic allowed
        // This ensures that even in a public subnet, the Fargate tasks are not reachable from the internet
        this.evalSecurityGroup = new ec2.SecurityGroup(this, 'EvalTaskSecurityGroup', {
            vpc,
            allowAllOutbound: true,
            description: 'Security group for Fargate Eval Task with NO inbound access',
        });

        // Instantiates the core DeepEval evaluation engine logic
        const deepEvalEvaluationEngine = new DeepEvalEvaluationEngine(this, 'DeepEvalEngine', {
            ...props,
            evalDataKey: 'test_sets/',
            vpc,
        });


        // Outputs for GitHub Actions
        new cdk.CfnOutput(this, 'EvalClusterArn', {
            value: cluster.clusterArn,
        });

        new cdk.CfnOutput(this, 'EvalTaskDefArn', {
            value: deepEvalEvaluationEngine.taskDefinition.taskDefinitionArn,
        });

        new cdk.CfnOutput(this, 'EvalSecurityGroupId', {
            value: this.evalSecurityGroup.securityGroupId,
        });

        new cdk.CfnOutput(this, 'EvalSubnets', {
            value: vpc.publicSubnets.map(s => s.subnetId).join(','),
        });

        new cdk.CfnOutput(this, 'EvalVpcId', {
            value: vpc.vpcId,
        });

    }
}