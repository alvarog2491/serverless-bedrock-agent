import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AppSettings } from '../../config/config-manager';
import { CloudWatchMonitoring } from '../constructs/monitoring/cloudwatch';

import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';

interface MonitoringStackProps extends cdk.StackProps {
  readonly config: AppSettings;
  readonly knowledgeBaseId: string;
  readonly api: apigateway.IRestApi;
  readonly agentModel: string;
  readonly inferenceProfileId: string;
  readonly agentInvokerFunction: lambda.IFunction;
  readonly notificationEmails: string[];
}

// Stack that centralizes monitoring and observability resources
export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const { config } = props;

    // Creates CloudWatch dashboards and metrics for agent performance
    new CloudWatchMonitoring(this, 'MonitoringConstruct', {
      api: props.api,
      agentModel: props.agentModel,
      inferenceProfileId: props.inferenceProfileId,
      modelInputCost: config.agentModelInputCost,
      modelOutputCost: config.agentModelOutputCost,
      agentInvokerFunction: props.agentInvokerFunction,
      notificationEmails: props.notificationEmails,
    });
  }
}

