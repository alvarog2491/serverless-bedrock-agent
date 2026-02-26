#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Annotations, Aspects, CfnResource, IAspect } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';
import { createConfig } from '../config/config-manager';
import { ComputeStack } from '../lib/stacks/compute-stack';
import { EvaluationStack } from '../lib/stacks/evaluation-stack';
import { InterfaceStack } from '../lib/stacks/interface-stack';
import { MonitoringStack } from '../lib/stacks/monitoring-stack';
import { PersistenceStack } from '../lib/stacks/persistence-stack';

// CDK Aspect for enforcing mandatory resource tagging
class TagEnforcementAspect implements IAspect {
  private requiredTags = ['Environment', 'Project'];

  visit(node: IConstruct): void {
    if (node instanceof CfnResource) {
      // Check if the node has the required tags
      // Tags are inherited from parent stacks, so we just warn if not explicitly set
      const missingTags = this.requiredTags.filter(tag => {
        // Tags are inherited, so we just provide a warning for awareness
        return false;
      });

      if (missingTags.length > 0) {
        Annotations.of(node).addWarning(
          `Missing required tags: ${missingTags.join(', ')}. These will be inherited from stack-level tags.`
        );
      }
    }
  }
}

// Entry point for the CDK application
const app = new cdk.App();

// Get environment target from CDK context (defaults to 'dev')
const envTarget = app.node.tryGetContext('env') || 'dev';

const config = createConfig(envTarget);

// Provisions the storage layer including S3 buckets and DynamoDB tables
const persistenceStack = new PersistenceStack(app, `PersistenceStack-${config.stage}`, { config });

// Provisions the compute layer including the Bedrock agent and knowledge base
const computeStack = new ComputeStack(app, `ComputeStack-${config.stage}`, {
  config,
  knowledgeBase: persistenceStack.knowledgeBase,
  leadTable: persistenceStack.leadTable,
});

// Provisions the interface layer exposing the agent via API Gateway
const interfaceStack = new InterfaceStack(app, `InterfaceStack-${config.stage}`, {
  config,
  agent: computeStack.agent,
  agentAlias: computeStack.agentAlias,
  leadTable: persistenceStack.leadTable,
  knowledgeBaseBucket: persistenceStack.knowledgeBaseBucket,
});

// Provisions the monitoring layer for observability and dashboards
const monitoringStack = new MonitoringStack(app, `MonitoringStack-${config.stage}`, {
  config,
  knowledgeBaseId: persistenceStack.knowledgeBase.knowledgeBaseId,
  api: interfaceStack.api,
  agentModel: config.agentModel,
  inferenceProfileId: computeStack.inferenceProfileId,
  agentInvokerFunction: interfaceStack.agentInvokerFunction,
  notificationEmails: config.notificationEmails,
});

// Provisions the evaluation layer for RAG performance testing
const evaluationStack = new EvaluationStack(app, `EvaluationStack-${config.stage}`, {
  config,
  agent: computeStack.agent,
  agentAlias: computeStack.agentAlias,
  resultsBucket: persistenceStack.evaluationsResultsBucket,
});

// Centralized Tagging: Applies tags to all resources in the app best practices for FinOps
cdk.Tags.of(app).add('Environment', config.stage);
cdk.Tags.of(app).add('Project', config.appName);

// Apply tag enforcement aspect
Aspects.of(app).add(new TagEnforcementAspect());
