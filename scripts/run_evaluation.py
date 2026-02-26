import boto3
import sys
import argparse
import logging
import time

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def run_fargate_task(cluster, task_definition, subnets, security_groups, vpc_id=None):
    """
    Runs an ECS Fargate task and waits for it to complete.

    Args:
        cluster (str): Cluster ARN or name.
        task_definition (str): Task definition ARN or family.
        subnets (list): List of subnet IDs.
        security_groups (list): List of security group IDs.
        vpc_id (str, optional): VPC ID where the task is running.

    Returns:
        str: The ARN of the started task.
    """
    ecs = boto3.client('ecs')

    try:
        msg = f"Starting Fargate task: {task_definition} in cluster: {cluster}"
        if vpc_id:
            msg += f" (VPC: {vpc_id})"
        logger.info(msg)
        
        response = ecs.run_task(
            cluster=cluster,
            taskDefinition=task_definition,
            launchType='FARGATE',
            networkConfiguration={
                'awsvpcConfiguration': {
                    'subnets': subnets,
                    'securityGroups': security_groups,
                    'assignPublicIp': 'ENABLED'
                }
            }
        )

        if not response.get('tasks'):
            logger.error(f"❌ Failed to start task: {response.get('failures')}")
            sys.exit(1)

        task_arn = response['tasks'][0]['taskArn']
        logger.info(f"✅ Task started. ARN: {task_arn}")
        
        return task_arn

    except Exception as e:
        logger.error(f"❌ Error starting Fargate task: {e}")
        sys.exit(1)

def wait_for_task_completion(cluster, task_arn):
    """
    Waits for the ECS task to stop.

    Args:
        cluster (str): Cluster ARN or name.
        task_arn (str): Task ARN.
    """
    ecs = boto3.client('ecs')
    
    logger.info(f"⌛ Waiting for task to complete: {task_arn}")
    
    try:
        waiter = ecs.get_waiter('tasks_stopped')
        waiter.wait(
            cluster=cluster,
            tasks=[task_arn],
            WaiterConfig={'Delay': 15, 'MaxAttempts': 120}
        )
        
        # After task stops, inspect the exit status
        response = ecs.describe_tasks(
            cluster=cluster,
            tasks=[task_arn]
        )
        
        if not response.get('tasks'):
            logger.error("❌ Could not describe task after completion.")
            sys.exit(1)
            
        task = response['tasks'][0]
        containers = task.get('containers', [])
        
        # Check for task-level errors
        stop_code = task.get('stopCode')
        stopped_reason = task.get('stoppedReason')
        
        if stop_code and stop_code != 'EssentialContainerExited':
            logger.error(f"❌ Task failed with stop code: {stop_code}. Reason: {stopped_reason}")
            sys.exit(1)
            
        # Check container exit codes
        failed = False
        for container in containers:
            exit_code = container.get('exitCode')
            container_name = container.get('name', 'Unknown')
            if exit_code is None:
                logger.error(f"❌ Container {container_name} did not provide an exit code. Stopped reason: {container.get('reason')}")
                failed = True
            elif exit_code != 0:
                logger.error(f"❌ Container {container_name} failed with exit code: {exit_code}")
                failed = True
                
        if failed:
            sys.exit(1)
            
        logger.info("🏁 Task completed successfully.")
    except Exception as e:
        logger.error(f"❌ Error waiting for task completion: {e}")
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="Run ECS Fargate Ragas Evaluation Task")
    parser.add_argument("--cluster", required=True, help="ECS Cluster ARN")
    parser.add_argument("--task-def", required=True, help="ECS Task Definition ARN")
    parser.add_argument("--subnets", required=True, help="Comma-separated list of subnet IDs")
    parser.add_argument("--security-groups", required=True, help="Comma-separated list of security group IDs")
    parser.add_argument("--vpc-id", help="VPC ID (optional)")

    args = parser.parse_args()

    subnets = args.subnets.split(',')
    security_groups = args.security_groups.split(',')

    task_arn = run_fargate_task(args.cluster, args.task_def, subnets, security_groups, args.vpc_id)
    wait_for_task_completion(args.cluster, task_arn)
    
    # Print task ARN at the end so it can be captured by other scripts/tools
    print(task_arn)

if __name__ == "__main__":
    main()
