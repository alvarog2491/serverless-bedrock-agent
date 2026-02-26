import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import { FoundationModelIdentifier } from 'aws-cdk-lib/aws-bedrock';
import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';
import { AppSettings } from '../../../config/config-manager';
import { GuardrailsConstruct } from './guardrails';
import { LeadCollectionConstruct } from './lead-collection';

export interface BedrockAgentConstructProps {
    readonly knowledgeBase: bedrock.IVectorKnowledgeBase;
    readonly leadTableArn: string;
    readonly leadTableName: string;
    readonly config: AppSettings;
}

// Construct that assembles the Bedrock agent with guardrails, KB, and action groups
export class BedrockAgentConstruct extends Construct {
    public readonly agent: bedrock.Agent;
    public readonly agentAlias: bedrock.IAgentAlias;
    public readonly inferenceProfileId: string;

    constructor(scope: Construct, id: string, props: BedrockAgentConstructProps) {
        super(scope, id);
        const { config } = props;

        const baseModel = bedrock.BedrockFoundationModel.fromCdkFoundationModelId(
            new FoundationModelIdentifier(config.agentModel)
        );
        // Creates the Application Inference Profile for cost tracking per application
        const appInferenceProfile = new bedrock.ApplicationInferenceProfile(this, 'AppInferenceProfile', {
            inferenceProfileName: `${config.appName}-cost-tracking`,
            modelSource: baseModel,
            description: `Tracking costs for ${config.appName}`,
        });
        this.inferenceProfileId = appInferenceProfile.inferenceProfileId;

        const promptText = this.getAgentInstructions(config);
        const guardrailConstruct = new GuardrailsConstruct(this, 'Guardrails', {
            config
        });
        const leadCollectionConstruct = new LeadCollectionConstruct(this, 'LeadCollection', {
            config,
            leadTableArn: props.leadTableArn,
            leadTableName: props.leadTableName,
        });

        // Provisions the Bedrock agent with guardrails and knowledge base
        this.agent = new bedrock.Agent(this, 'Agent', {
            name: config.agentName,
            instruction: promptText,
            foundationModel: appInferenceProfile,
            shouldPrepareAgent: true,
            userInputEnabled: false,
            guardrail: guardrailConstruct.guardrail,
            knowledgeBases: [props.knowledgeBase],
        });

        // Integrates action groups into the agent
        this.agent.addActionGroup(leadCollectionConstruct.actionGroup);

        // Creates a versioned alias for the agent deployment
        this.agentAlias = new bedrock.AgentAlias(this, 'alias', {
            aliasName: config.stage,
            agent: this.agent,
            description: `Alias for ${config.stage} stage`
        });
    }

    /**
     * Orchestrates loading and processing the agent instructions.
     * @returns Processed prompt text with all template variables replaced
     */
    private getAgentInstructions(config: AppSettings): string {
        const rawPrompt = this.loadPromptFromFile(config.promptVersion);
        return this.replaceTemplateVariables(rawPrompt, config);
    }

    /**
     * Loads the raw prompt text from a versioned file.
     * @param version Prompt version (e.g., 'v0')
     * @returns Raw prompt text
     */
    private loadPromptFromFile(version: string): string {
        const promptPath = path.join(__dirname, `../../../../assets/prompts/${version}/instructions_prompt.txt`);

        // Validates prompt file exists before proceeding
        if (!fs.existsSync(promptPath)) {
            throw new Error(
                `Agent instruction must exist, please create them at assets/prompts/${version}/instructions_prompt.txt`
            );
        }

        return fs.readFileSync(promptPath, 'utf8');
    }

    /**
     * Replaces template variables in the prompt text with actual config values.
     * @param promptText Raw prompt text with template variables
     * @returns Prompt text with variables replaced
     */
    private replaceTemplateVariables(promptText: string, config: AppSettings): string {
        return promptText
            .replace(/{appName}/g, config.appName)
            .replace(/{agentName}/g, config.agentName)
            .replace(/{companyName}/g, config.companyName)
            .replace(/{domain}/g, config.domain);
    }
}
