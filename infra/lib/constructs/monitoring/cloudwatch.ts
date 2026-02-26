import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

export interface CloudWatchMonitoringProps {
    readonly api: apigateway.IRestApi;
    readonly agentModel: string;
    readonly inferenceProfileId: string;
    readonly modelInputCost: number;
    readonly modelOutputCost: number;
    readonly agentInvokerFunction: lambda.IFunction;
    readonly notificationEmails: string[];
}

// Construct that creates CloudWatch dashboards and alarms for monitoring
export class CloudWatchMonitoring extends Construct {
    private readonly dashboard: cloudwatch.Dashboard;
    public readonly securityAlertTopic: sns.Topic;

    constructor(scope: Construct, id: string, props: CloudWatchMonitoringProps) {
        super(scope, id);

        // Provisions SNS topic for security alert notifications
        this.securityAlertTopic = new sns.Topic(this, 'SecurityAlertTopic', {
            displayName: 'Security Alert',
            topicName: 'SecurityAlert',
        });

        props.notificationEmails.forEach(email => {
            this.securityAlertTopic.addSubscription(new sns_subscriptions.EmailSubscription(email));
        });

        this.dashboard = new cloudwatch.Dashboard(this, 'AgentDashboard', {
            dashboardName: 'BedrockAgentPerformance',
        });

        const { sessionMetric, leadMetric, failureMetric, agentInvokerFailureMetric, conversionRatio } = this.createSessionMetrics(props.agentInvokerFunction);
        const apiLatencyP95 = this.createLatencyMetrics(props.api);

        // Configures security alarms for monitoring unauthorized access and anomalies
        this.createSecurityAlarms(props.inferenceProfileId);

        // Add Lambda error rate and latency alarms
        this.createLambdaPerformanceAlarms(props.agentInvokerFunction);

        // Row 1: High-level KPIs (Sessions, Leads, Conversion)
        this.dashboard.addWidgets(
            new cloudwatch.SingleValueWidget({
                title: 'Total Sessions (Last 1 Hour)',
                metrics: [sessionMetric],
                width: 8,
            }),
            new cloudwatch.SingleValueWidget({
                title: 'Total Leads (Last 1 Hour)',
                metrics: [leadMetric],
                width: 8,
            }),
            new cloudwatch.SingleValueWidget({
                title: 'Lead Conversion Rate (Last 1 Hour)',
                metrics: [conversionRatio],
                width: 8,
            })
        );

        // Row 2: Operational Health (Failures)
        this.dashboard.addWidgets(
            new cloudwatch.SingleValueWidget({
                title: 'Lead Collection Failures (Last 1 Hour)',
                metrics: [failureMetric],
                width: 12,
            }),
            new cloudwatch.SingleValueWidget({
                title: 'Agent Invocation Failures (Last 1 Hour)',
                metrics: [agentInvokerFailureMetric],
                width: 12,
            })
        );

        // Row 3: Performance Deep Dive (Latency & Resource Usage)
        const inputTokensMetric = new cloudwatch.Metric({
            namespace: 'AWS/Bedrock',
            metricName: 'InputTokenCount',
            dimensionsMap: { ModelId: props.inferenceProfileId },
            statistic: 'Sum',
            label: 'Input Tokens',
        });

        const outputTokensMetric = new cloudwatch.Metric({
            namespace: 'AWS/Bedrock',
            metricName: 'OutputTokenCount',
            dimensionsMap: { ModelId: props.inferenceProfileId },
            statistic: 'Sum',
            label: 'Output Tokens',
        });

        // Multiply Input Tokens by (cost / 1M)
        const inputTokenCost = new cloudwatch.MathExpression({
            expression: `(inputTokens / 1000000) * ${props.modelInputCost}`,
            usingMetrics: { inputTokens: inputTokensMetric },
            label: 'Input Token Cost ($)',
            period: cdk.Duration.minutes(1),
        });

        const outputTokenCost = new cloudwatch.MathExpression({
            expression: `(outputTokens / 1000000) * ${props.modelOutputCost}`,
            usingMetrics: { outputTokens: outputTokensMetric },
            label: 'Output Token Cost ($)',
            period: cdk.Duration.minutes(1),
        });

        const totalCost = new cloudwatch.MathExpression({
            expression: 'inputCost + outputCost',
            usingMetrics: {
                inputCost: inputTokenCost,
                outputCost: outputTokenCost,
            },
            label: 'Total Model Cost ($)',
            period: cdk.Duration.hours(1),
        });

        this.dashboard.addWidgets(
            new cloudwatch.GraphWidget({
                title: 'API Gateway Latency (P95)',
                left: [apiLatencyP95],
                width: 8,
            }),

            new cloudwatch.GraphWidget({
                title: 'Bedrock Token Usage (Last 1 Hour)',
                left: [
                    inputTokensMetric,
                    outputTokensMetric,
                ],
                width: 8,
            }),

            new cloudwatch.SingleValueWidget({
                title: 'Total Model Cost (Last 1 Hour)',
                metrics: [totalCost],
                width: 8,
                fullPrecision: true
            })
        );
    }

    private createSessionMetrics(agentInvokerFunction: lambda.IFunction) {
        const sessionMetric = new cloudwatch.Metric({
            namespace: 'LeadGenBot',
            metricName: 'SessionInvocation',
            dimensionsMap: {
                service: 'AgentPerformance',
            },
            statistic: 'Sum',
            period: cdk.Duration.hours(1),
            label: 'Sessions',
        });

        const leadMetric = new cloudwatch.Metric({
            namespace: 'LeadGenBot',
            metricName: 'LeadCaptured',
            dimensionsMap: {
                service: 'AgentPerformance',
            },
            statistic: 'Sum',
            period: cdk.Duration.hours(1),
            label: 'Leads',
        });

        const conversionRatio = new cloudwatch.MathExpression({
            expression: "(m1 / IF(m2 > 0, m2, 1)) * 100",
            usingMetrics: {
                m1: leadMetric,
                m2: sessionMetric,
            },
            label: 'Lead Conversion Rate %',
        });

        const failureMetric = new cloudwatch.Metric({
            namespace: 'LeadGenBot',
            metricName: 'ActionGroupFailure',
            dimensionsMap: {
                service: 'AgentPerformance',
            },
            statistic: 'Sum',
            period: cdk.Duration.hours(1),
            label: 'Failures',
        });

        const agentInvokerFailureMetric = new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Errors',
            dimensionsMap: {
                FunctionName: agentInvokerFunction.functionName,
            },
            statistic: 'Sum',
            period: cdk.Duration.hours(1),
            label: 'Invoker Failures',
        });

        return { sessionMetric, leadMetric, failureMetric, agentInvokerFailureMetric, conversionRatio };
    }

    private createLatencyMetrics(api: apigateway.IRestApi): cloudwatch.Metric {
        return new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Latency',
            dimensionsMap: {
                ApiName: api.restApiName,
                Stage: api.deploymentStage.stageName,
            },
            statistic: 'p95',
            label: 'Total Latency (P95)',
            period: cdk.Duration.minutes(5),
        });
    }

    private createSecurityAlarms(modelId: string): void {
        // Create alarm for unauthorized Bedrock API access attempts
        const unauthorizedAccessAlarm = new cloudwatch.Alarm(this, 'UnauthorizedBedrockAPIAccess', {
            alarmName: 'UnauthorizedBedrockAPIAccess',
            alarmDescription: 'Alarm for unauthorized access attempts to Bedrock API',
            metric: new cloudwatch.Metric({
                namespace: 'AWS/Bedrock',
                metricName: 'AccessDenied',
                dimensionsMap: {
                    Service: 'Bedrock',
                },
                statistic: 'Sum',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 0,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            actionsEnabled: true,
        });

        // Attaches SNS topic as alarm action for notifications
        unauthorizedAccessAlarm.addAlarmAction(
            new cloudwatch_actions.SnsAction(this.securityAlertTopic)
        );

        // Alarm for high Input Token Count (Anomaly detection or Malicious use)
        // Adjust threshold based on expected baseline (e.g., 50k tokens per 5 min)
        const highInputTokensAlarm = new cloudwatch.Alarm(this, 'HighInputTokenCount', {
            alarmName: 'HighInputTokenCount',
            alarmDescription: 'Detects unusual spike in input tokens, potentially indicating bot attacks or misuse',
            metric: new cloudwatch.Metric({
                namespace: 'AWS/Bedrock',
                metricName: 'InputTokenCount',
                dimensionsMap: {
                    ModelId: modelId,
                },
                statistic: 'Sum',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 50000,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            actionsEnabled: true,
        });
        highInputTokensAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.securityAlertTopic));

        // Alarm for high Invocation Count (Protection against DoS/Bot spam)
        const highInvocationCountAlarm = new cloudwatch.Alarm(this, 'HighInvocationCount', {
            alarmName: 'HighInvocationCount',
            alarmDescription: 'Detects unusual spike in agent invocations',
            metric: new cloudwatch.Metric({
                namespace: 'AWS/Bedrock',
                metricName: 'Invocations',
                dimensionsMap: {
                    ModelId: modelId,
                },
                statistic: 'Sum',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 200,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            actionsEnabled: true,
        });
        highInvocationCountAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.securityAlertTopic));
    }

    private createLambdaPerformanceAlarms(agentInvokerFunction: lambda.IFunction): void {
        // Lambda Error Rate Alarm (>1%)
        const errorRateAlarm = new cloudwatch.Alarm(this, 'LambdaErrorRate', {
            alarmName: 'AgentInvoker-ErrorRate',
            alarmDescription: 'Lambda error rate exceeds 1%',
            metric: new cloudwatch.MathExpression({
                expression: '(errors / invocations) * 100',
                usingMetrics: {
                    errors: agentInvokerFunction.metricErrors({
                        statistic: 'Sum',
                        period: cdk.Duration.minutes(5),
                    }),
                    invocations: agentInvokerFunction.metricInvocations({
                        statistic: 'Sum',
                        period: cdk.Duration.minutes(5),
                    }),
                },
            }),
            threshold: 1,
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            actionsEnabled: true,
        });

        // Lambda P95 Latency Alarm (>2 seconds)
        const latencyAlarm = new cloudwatch.Alarm(this, 'LambdaLatency', {
            alarmName: 'AgentInvoker-P95Latency',
            alarmDescription: 'Lambda P95 latency exceeds 2 seconds',
            metric: agentInvokerFunction.metricDuration({
                statistic: 'p95',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 2000,  // milliseconds
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            actionsEnabled: true,
        });

        // Add SNS actions for notifications
        errorRateAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.securityAlertTopic));
        latencyAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.securityAlertTopic));
    }
}
