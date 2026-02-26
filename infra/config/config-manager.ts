import { RemovalPolicy } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

export enum Stage {
    DEV = 'dev',
    STAGING = 'staging',
    PROD = 'prod',
}

const envSchema = z.object({
    PROJECT: z.object({
        STAGE: z.enum(['dev', 'staging', 'prod']),
        APP_NAME: z.string().min(1),
    }),
    AWS: z.object({
        ACCOUNT: z.string().regex(/^\d{12}$/, "Must be a 12-digit AWS Account ID"),
        REGION: z.string().min(4),
    }),
    SECURITY: z.object({
        ALLOWED_IPS: z.array(z.string()).min(0),
    }),
    AGENT: z.object({
        NAME: z.string().min(1),
        COMPANY_NAME: z.string().min(1),
        DOMAIN: z.string().min(1),
        PROMPT_VALIDATION: z.object({
            MIN_LENGTH: z.number().int().positive(),
            MAX_LENGTH: z.number().int().positive(),
        }),
        GUARDRAILS: z.object({
            GROUNDING_THRESHOLD: z.number().min(0).max(1),
            RELEVANCE_THRESHOLD: z.number().min(0).max(1),
        }),
        PROMPT_VERSION: z.string().min(1),
    }),
    MODELS: z.object({
        AGENT: z.object({
            ID: z.string().min(1),
            INPUT_COST: z.number().positive(),
            OUTPUT_COST: z.number().positive(),
        }),
        EMBEDDING: z.object({
            ID: z.string().min(1),
        }),
        EVALUATION: z.object({
            JUDGE_ID: z.string().min(1),
        }),
    }),
    NOTIFICATIONS: z.object({
        EMAILS: z.array(z.string().email()),
    }),
});

export type EnvConfig = z.infer<typeof envSchema>;

export interface VectorStoreConfig {
    readonly embeddingModelArn: string;
}


export interface AppSettings {
    readonly account: string;
    readonly region: string;
    readonly agentModel: string;
    readonly agentModelInputCost: number;
    readonly agentModelOutputCost: number;
    readonly embeddingModel: string;
    readonly evaluationJudgeModel: string;
    readonly agentName: string;
    readonly vectorStore: VectorStoreConfig;
    readonly stage: Stage;
    readonly removalPolicy: RemovalPolicy;
    readonly appName: string;
    readonly companyName: string;
    readonly domain: string;
    readonly notificationEmails: string[];
    readonly logRetention: logs.RetentionDays;
    readonly lambdaRuntime: lambda.Runtime;
    readonly promptMinLength: number;
    readonly promptMaxLength: number;
    readonly promptVersion: string;
    readonly groundingThreshold: number;
    readonly relevanceThreshold: number;
    readonly allowedIps: string[];
}

/**
 * Maps Python version string to CDK Lambda Runtime
 */
function getLambdaRuntime(pythonVersion: string): lambda.Runtime {
    const runtimeMap: Record<string, lambda.Runtime> = {
        '3.9': lambda.Runtime.PYTHON_3_9,
        '3.10': lambda.Runtime.PYTHON_3_10,
        '3.11': lambda.Runtime.PYTHON_3_11,
        '3.12': lambda.Runtime.PYTHON_3_12,
    };
    const runtime = runtimeMap[pythonVersion];
    if (!runtime) {
        throw new Error(`Unsupported Python version: ${pythonVersion}. Supported versions: ${Object.keys(runtimeMap).join(', ')}`);
    }
    return runtime;
}

export function createConfig(contextEnv?: string): AppSettings {
    // Load configuration from JSON file based on environment context
    const envTarget = contextEnv || 'dev';

    // Staging environment inherits configuration from prod but runs as 'staging' stage
    const configFileTarget = envTarget === 'staging' ? 'prod' : envTarget;

    console.log(`Loading configuration for environment: ${envTarget} (using config file: ${configFileTarget}.json)`);

    const configPath = path.join(__dirname, '..', 'config', `${configFileTarget}.json`);

    console.log("Internal Path Attempt: ", configPath);
    if (!fs.existsSync(configPath)) {
        throw new Error(`Configuration file not found: ${configPath}`);
    }

    const configFileContents = fs.readFileSync(configPath, 'utf-8');
    const configData = JSON.parse(configFileContents);

    const result = envSchema.safeParse(configData);

    if (!result.success) {
        console.error("❌ Invalid environment configuration:");
        console.error(JSON.stringify(result.error.format(), null, 2));
        throw new Error("Config validation failed");
    }

    const env = result.data;

    // Override stage if we are in staging (since we loaded prod.json which has STAGE='prod')
    const currentStage = (envTarget === 'staging' ? Stage.STAGING : env.PROJECT.STAGE) as Stage;

    const settings: AppSettings = {
        stage: currentStage,
        account: env.AWS.ACCOUNT,
        region: env.AWS.REGION,
        agentModel: env.MODELS.AGENT.ID,
        agentModelInputCost: env.MODELS.AGENT.INPUT_COST,
        agentModelOutputCost: env.MODELS.AGENT.OUTPUT_COST,
        embeddingModel: env.MODELS.EMBEDDING.ID,
        evaluationJudgeModel: env.MODELS.EVALUATION.JUDGE_ID,
        agentName: `${env.AGENT.NAME}-${currentStage}`,
        removalPolicy: currentStage === Stage.PROD ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
        appName: env.PROJECT.APP_NAME,
        companyName: env.AGENT.COMPANY_NAME,
        domain: env.AGENT.DOMAIN,
        notificationEmails: env.NOTIFICATIONS.EMAILS,
        logRetention: currentStage === Stage.PROD ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
        vectorStore: {
            embeddingModelArn: `arn:aws:bedrock:${env.AWS.REGION}::foundation-model/${env.MODELS.EMBEDDING.ID}`,
        },
        lambdaRuntime: getLambdaRuntime(readPythonVersionFromCdkJson()),
        promptMinLength: env.AGENT.PROMPT_VALIDATION.MIN_LENGTH,
        promptMaxLength: env.AGENT.PROMPT_VALIDATION.MAX_LENGTH,
        promptVersion: env.AGENT.PROMPT_VERSION,
        groundingThreshold: env.AGENT.GUARDRAILS.GROUNDING_THRESHOLD,
        relevanceThreshold: env.AGENT.GUARDRAILS.RELEVANCE_THRESHOLD,
        allowedIps: env.SECURITY.ALLOWED_IPS,
    };

    Object.freeze(settings);
    Object.freeze(settings.vectorStore);

    return settings;
}

/**
 * Reads the Python version from cdk.json
 */
function readPythonVersionFromCdkJson(): string {
    const cdkJsonPath = path.resolve(__dirname, '../cdk.json');
    if (!fs.existsSync(cdkJsonPath)) {
        return '3.12'; // Default fallback
    }
    const cdkJson = JSON.parse(fs.readFileSync(cdkJsonPath, 'utf-8'));
    return cdkJson.runtimeVersions?.python || '3.12';
}