import boto3
import sys
import json
import argparse
import logging
import os

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def load_thresholds():
    """Attempts to load thresholds from the central metrics_thresholds.json file."""

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    config_path = os.path.join(base_dir, "src/jobs/evaluation/deepeval_evaluator/metrics_thresholds.json")
    
    if os.path.exists(config_path):
        try:
            with open(config_path, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error reading thresholds from {config_path}: {e}")
            sys.exit(1)
    
    logger.error(f"CRITICAL: Metrics config not found at {config_path}. Thresholds are mandatory.")
    sys.exit(1)

def fetch_report(s3_client, bucket, key):
    """
    Fetch and parse the JSON report from S3.
    """
    try:
        logger.info(f"Fetching report from s3://{bucket}/{key}...")
        response = s3_client.get_object(Bucket=bucket, Key=key)
        content = response['Body'].read().decode('utf-8')
        return json.loads(content)
    except Exception as e:
        logger.error(f"Error fetching or parsing report: {e}")
        return None

def main():
    """
    Main entry point for the evaluation results checker script.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--bucket", required=True, help="S3 bucket containing evaluation results")
    parser.add_argument("--report-key", default="results/latest_eval_report.json", help="Specific S3 key (default: results/latest_eval_report.json)")
    args = parser.parse_args()

    s3 = boto3.client('s3')

    # Fetch and parse the report
    report = fetch_report(s3, args.bucket, args.report_key)
    if not report:
        logger.error(f"Could not find or load report {args.report_key} in bucket {args.bucket}")
        sys.exit(1)

    # Check execution status
    status = report.get('status')
    if status != 'completed':
        logger.error(f"Evaluation did not complete successfully. Status: {status}")
        sys.exit(1)

    # Extract metrics
    metrics = report.get('summary_metrics', {})
    if not metrics:
        logger.warning("No 'summary_metrics' found in the report JSON. This might happen if no test cases were run.")
        # If no metrics are found, we fail if we expect a successful evaluation with results
        sys.exit(1)

    logger.info(f"Report Timestamp: {report.get('timestamp')}")
    
    # Load central thresholds
    central_thresholds = load_thresholds()
    
    # Check specific metrics against threshold
    fail = False
    for metric_name, value in metrics.items():
        # Get threshold from central config
        threshold = central_thresholds.get(metric_name)
        pass_status = "✅ PASS" if value >= threshold else "❌ FAIL"
        logger.info(f"{pass_status} - {metric_name}: {value:.4f} (Threshold: {threshold})")
        if value < threshold:
            fail = True
    
    if fail:
        logger.error("❌ CI/CD Pipeline FAILED: One or more metrics are below the threshold.")
        sys.exit(1)
        
    logger.info("CI/CD Pipeline SUCCESS: All metrics are above threshold.")
    sys.exit(0)

if __name__ == "__main__":
    main()
