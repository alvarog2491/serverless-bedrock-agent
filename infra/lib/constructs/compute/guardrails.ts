import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';
import { AppSettings } from '../../../config/config-manager';

export interface GuardrailsConstructProps {
    readonly config: AppSettings;
}

// Construct that configures content safety guardrails for the Bedrock agent
export class GuardrailsConstruct extends Construct {
    public readonly guardrail: bedrock.Guardrail;
    public readonly guardrailVersion: string;

    constructor(scope: Construct, id: string, props: GuardrailsConstructProps) {
        super(scope, id);

        const guardrailPath = path.join(__dirname, '../../../../assets/guardrails/default-guardrail.json');

        // Validates guardrail configuration file exists before proceeding
        if (!fs.existsSync(guardrailPath)) {
            throw new Error(
                `Guardrail must exist, please create them at assets/guardrails/default-guardrail.json`
            );
        }
        const guardrailConfig = JSON.parse(fs.readFileSync(guardrailPath, 'utf8'));

        this.guardrail = new bedrock.Guardrail(this, 'AgentGuardrail', {
            name: guardrailConfig.name,
            description: guardrailConfig.description,
            blockedInputMessaging: guardrailConfig.blockedInputMessaging,
            blockedOutputsMessaging: guardrailConfig.blockedOutputsMessaging,
            // Keep existing Content Filters
            contentFilters: guardrailConfig.contentPolicyConfig.filtersConfig.map((filter: any) => ({
                type: filter.type,
                inputStrength: filter.inputStrength,
                outputStrength: filter.outputStrength,
            })),

            contextualGroundingFilters: [
                {
                    type: bedrock.ContextualGroundingFilterType.GROUNDING,
                    threshold: props.config.groundingThreshold,
                },
                {
                    type: bedrock.ContextualGroundingFilterType.RELEVANCE,
                    threshold: props.config.relevanceThreshold,
                },
            ],
        });

    }
}
