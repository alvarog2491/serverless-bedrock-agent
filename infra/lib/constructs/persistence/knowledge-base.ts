import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { bedrock, pinecone } from '@cdklabs/generative-ai-cdk-constructs';
import * as cdk from 'aws-cdk-lib';
import { FoundationModelIdentifier } from 'aws-cdk-lib/aws-bedrock';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';
import { AppSettings } from '../../../config/config-manager';

export interface KnowledgeBaseConstructProps {
    readonly bucket: s3.IBucket;
    readonly config: AppSettings;
}

// Construct for managing the Bedrock Knowledge Base and its data source
export class KnowledgeBaseConstruct extends Construct {
    public readonly knowledgeBase: bedrock.VectorKnowledgeBase;

    constructor(scope: Construct, id: string, props: KnowledgeBaseConstructProps) {
        super(scope, id);
        const { config } = props;

        // Retrieve the parameters individually
        const pineconeUrl = ssm.StringParameter.valueForStringParameter(
            this, `/${config.stage}/pinecone/connection-string`
        );
        const pineconeSecretArn = ssm.StringParameter.valueForStringParameter(
            this, `/${config.stage}/pinecone/secret-arn`
        );

        // Configures Pinecone as the vector storage for document embeddings
        const pineconeVectorStore = new pinecone.PineconeVectorStore({
            connectionString: pineconeUrl,
            credentialsSecretArn: pineconeSecretArn,
            textField: 'text',
            metadataField: 'metadata',
        });

        // The Bedrock foundation model used for generating embeddings
        const modelIdentifier = new FoundationModelIdentifier(config.embeddingModel);
        const embeddingModel = bedrock.BedrockFoundationModel.fromCdkFoundationModelId(modelIdentifier, {
            supportsKnowledgeBase: true,
        });

        // Provisions the vector knowledge base combining Pinecone and Bedrock embeddings
        this.knowledgeBase = new bedrock.VectorKnowledgeBase(this, 'KnowledgeBase', {
            vectorStore: pineconeVectorStore,
            embeddingsModel: embeddingModel,
            instruction: 'Use this knowledge base to answer questions about the documents.',
        });

        // Connects the S3 bucket as a data source with semantic chunking enabled
        const dataSource = this.knowledgeBase.addS3DataSource({
            bucket: props.bucket,
            chunkingStrategy: bedrock.ChunkingStrategy.SEMANTIC,
        });

        this.setupAutoSync(props.bucket, dataSource.dataSourceId, config);
        this.grantKBAccessToSecrets(pineconeSecretArn);
    }

    private grantKBAccessToSecrets(pineconeSecretArn: string) {
        const secretPolicy = new iam.Policy(this, 'SecretAccessPolicy', {
            statements: [
                new iam.PolicyStatement({
                    actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
                    resources: [pineconeSecretArn],
                }),
            ],
        });

        this.knowledgeBase.role.attachInlinePolicy(secretPolicy);
    }

    /**
     * Sets up the automatic synchronization mechanism by creating a Lambda function 
     * triggered by S3 events (upload/delete) to start Knowledge Base ingestion jobs.
     * 
     * @param bucket The S3 bucket acting as the data source
     * @param dataSourceId The ID of the Bedrock Knowledge Base data source
     */
    private setupAutoSync(bucket: s3.IBucket, dataSourceId: string, config: AppSettings) {

        // Define the Lambda using the specialized Python construct
        // This handles Docker bundling and requirements.txt automatically
        const syncFunction = new PythonFunction(this, 'SyncLambda', {
            entry: path.join(__dirname, '../../../../src/lambda/kb-sync'),
            runtime: config.lambdaRuntime,
            architecture: lambda.Architecture.X86_64,
            index: 'index.py',
            handler: 'handler',
            timeout: cdk.Duration.minutes(10),
            tracing: lambda.Tracing.ACTIVE,
            environment: {
                KNOWLEDGE_BASE_ID: this.knowledgeBase.knowledgeBaseId,
                DATA_SOURCE_ID: dataSourceId,
                STAGE: config.stage,
                LOG_LEVEL: config.stage === 'prod' ? 'INFO' : 'DEBUG',
            },
        });

        // Manage Version & Alias (The "Immutability" pattern)
        const currentVersion = syncFunction.currentVersion;

        const syncAlias = new lambda.Alias(this, 'SyncLambdaAlias', {
            aliasName: config.stage === 'prod' ? 'live' : `${config.stage}-current`,
            version: currentVersion,
        });

        // Grants permission to start ingestion jobs on the Knowledge Base
        this.knowledgeBase.grant(syncFunction, 'bedrock:StartIngestionJob', 'bedrock:AssociateThirdPartyKnowledgeBase');

        // Configures S3 event notifications to trigger the Sync Lambda alias
        bucket.addEventNotification(
            s3.EventType.OBJECT_CREATED,
            new s3n.LambdaDestination(syncAlias)
        );
        bucket.addEventNotification(
            s3.EventType.OBJECT_REMOVED,
            new s3n.LambdaDestination(syncAlias)
        );
    }
}

