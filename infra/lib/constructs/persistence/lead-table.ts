import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { AppSettings } from '../../../config/config-manager';

export interface LeadTableProps {
    readonly config: AppSettings;
}

// Construct that defines the DynamoDB table for lead storage
export class LeadTable extends Construct {
    public readonly table: Table;

    constructor(scope: Construct, id: string, props: LeadTableProps) {
        super(scope, id);
        const { config } = props;

        // Provisions the DynamoDB table with on-demand billing and recovery enabled
        const leadsTable = new dynamodb.Table(this, 'LeadsTable', {
            partitionKey: { name: 'lead_id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: config.removalPolicy,
            pointInTimeRecovery: true,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
        });

        this.table = leadsTable;
    }
}
