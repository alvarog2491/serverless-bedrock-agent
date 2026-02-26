import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3_assets from 'aws-cdk-lib/aws-s3-assets';
import { Construct } from 'constructs';
import * as path from 'path';
import { AppSettings } from '../../../config/config-manager';

export interface LeadCollectionConstructProps {
    readonly leadTableArn: string;
    readonly leadTableName: string;
    readonly config: AppSettings;
}

// Construct that defines the lead collection logic via Lambda and Bedrock Action Group
export class LeadCollectionConstruct extends Construct {
    public readonly actionGroup: bedrock.AgentActionGroup;
    public readonly lambdaAlias: lambda.IAlias;

    constructor(scope: Construct, id: string, props: LeadCollectionConstructProps) {
        super(scope, id);

        const { config } = props;

        // References the DynamoDB table where leads will be stored
        const leadsTable = dynamodb.Table.fromTableAttributes(this, 'ImportedLeadTable', {
            tableArn: props.leadTableArn,
        });

        // Define the Lambda using the specialized Python construct
        // This handles Docker bundling and requirements.txt automatically
        const leadFunction = new PythonFunction(this, 'LeadCollectionFunction', {
            entry: path.join(__dirname, '../../../../src/lambda/lead-collector'),
            runtime: config.lambdaRuntime,
            architecture: lambda.Architecture.X86_64,
            index: 'index.py',
            handler: 'handler',
            timeout: cdk.Duration.seconds(60),
            tracing: lambda.Tracing.ACTIVE,
            environment: {
                LEADS_TABLE_NAME: props.leadTableName,
                STAGE: config.stage,
                LOG_LEVEL: config.stage === 'prod' ? 'INFO' : 'DEBUG',
            },
        });

        // Manage Version & Alias (The "Immutability" pattern)
        const currentVersion = leadFunction.currentVersion;

        this.lambdaAlias = new lambda.Alias(this, 'LambdaAlias', {
            aliasName: config.stage === 'prod' ? 'live' : `${config.stage}-current`,
            version: currentVersion,
        });

        // Load Schema as an Asset
        const leadSchemaAsset = new s3_assets.Asset(this, 'LeadSchemaAsset', {
            path: path.join(__dirname, '../../../../assets/api-schema/lead-collection/v1/lead-collection.json'),
        });

        // Create the Action Group
        this.actionGroup = new bedrock.AgentActionGroup({
            name: 'lead-collection',
            description: 'Collects and manages user leads.',
            apiSchema: bedrock.ApiSchema.fromS3File(
                leadSchemaAsset.bucket,
                leadSchemaAsset.s3ObjectKey
            ),
            // Points to the stable alias, not the function
            executor: bedrock.ActionGroupExecutor.fromlambdaFunction(this.lambdaAlias),
        });

        // Grants the Lambda alias permission to write data to the leads table
        leadsTable.grantReadWriteData(leadFunction);
    }

}
