import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AppSettings, Stage } from '../../../config/config-manager';

export interface BucketStoreProps {
    readonly config: AppSettings;
}

// Construct that centralizes the creation of all S3 buckets for the application
export class BucketStore extends Construct {
    public readonly knowledgeBaseBucket: s3.IBucket;
    public readonly logsBucket: s3.IBucket;
    public readonly evaluationsResultsBucket: s3.IBucket;

    constructor(scope: Construct, id: string, props: BucketStoreProps) {
        super(scope, id);
        const { config } = props;
        const account = cdk.Stack.of(this).account;
        const appName = config.appName.toLowerCase();
        const uniqueId = cdk.Names.uniqueId(this).toLowerCase().slice(-4);

        // Provisions a dedicated S3 bucket for server access logs (must be created first)
        this.logsBucket = new s3.Bucket(this, 'LogsBucket', {
            bucketName: `${appName}-logs-${account}-${config.stage}-${uniqueId}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            removalPolicy: config.removalPolicy,
            autoDeleteObjects: config.stage !== Stage.PROD,
            lifecycleRules: [
                {
                    id: 'ArchiveLogs',
                    enabled: true,
                    transitions: [
                        {
                            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                            transitionAfter: cdk.Duration.days(30),
                        }
                    ],
                }
            ],
        });

        // Provisions the encrypted S3 bucket for storing knowledge base documents
        this.knowledgeBaseBucket = new s3.Bucket(this, 'knowledgeBaseBucket', {
            bucketName: `${appName}-kb-${account}-${config.stage}-${uniqueId}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            removalPolicy: config.removalPolicy,
            autoDeleteObjects: config.stage !== Stage.PROD,
            versioned: true,
            serverAccessLogsBucket: this.logsBucket,
            serverAccessLogsPrefix: 'knowledge-base-access-logs/',
            lifecycleRules: [
                {
                    id: 'TransitionToIA',
                    enabled: true,
                    transitions: [
                        {
                            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                            transitionAfter: cdk.Duration.days(90),
                        }
                    ],
                }
            ],
        });

        // Provisions the S3 bucket for storing RAG evaluation results and metrics
        this.evaluationsResultsBucket = new s3.Bucket(this, 'EvaluationsBucket', {
            bucketName: `${appName}-evaluations-${account}-${config.stage}-${uniqueId}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            removalPolicy: config.removalPolicy,
            autoDeleteObjects: config.stage !== Stage.PROD,
            lifecycleRules: [
                {
                    id: 'ArchiveEvaluations',
                    enabled: true,
                    transitions: [
                        {
                            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                            transitionAfter: cdk.Duration.days(90),
                        }
                    ],
                }
            ],
        });
    }
}
