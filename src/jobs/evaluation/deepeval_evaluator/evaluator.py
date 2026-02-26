import sys
import os
import logging
from dotenv import load_dotenv

# Initialize logger
logger = logging.getLogger(__name__)

# Load environment variables from .env file if it exists
load_dotenv()

class EvaluatorConfig:
    """Manages environment variables and configuration."""
    def __init__(self, test_set=None, debug=False):
        self.agent_id = os.getenv("AGENT_ID")
        self.agent_alias_id = os.getenv("AGENT_ALIAS_ID")
        self.eval_data_bucket = os.getenv("EVAL_DATA_BUCKET")
        self.eval_data_key = os.getenv("EVAL_DATA_KEY")
        self.results_bucket = os.getenv("RESULTS_BUCKET")
        self.judge_model_id = os.getenv("JUDGE_MODEL_ID")
        self.region = os.getenv("AWS_REGION", "us-east-1")
        self.task_arn = os.getenv("TASK_ARN")
        
        # Priority: CLI flag > Env Var > Default False
        env_debug = os.getenv("DEBUG", "False").lower() in ("true", "1", "t")
        self.debug = debug or env_debug
        
        # All available test sets and their metric groups
        all_test_sets = {
            "golden_set_happy_path.jsonl": "rag",
            "golden_set_edge_case.jsonl": "rag_edge",
            "golden_set_adversarial.jsonl": "adversarial"
        }

        if test_set:
            if test_set in all_test_sets:
                self.test_sets = {test_set: all_test_sets[test_set]}
                logger.info(f"🎯 Filtered for single test set: {test_set}")
            else:
                available = ", ".join(all_test_sets.keys())
                raise ValueError(f"Invalid test set: {test_set}. Available: {available}")
        else:
            self.test_sets = all_test_sets
            logger.info("🚀 No specific test set provided. Running all datasets.")

    def validate(self):
        required = [self.agent_id, self.agent_alias_id, self.eval_data_bucket, 
                    self.eval_data_key, self.results_bucket, self.judge_model_id]
        if not all(required):
            missing = [k for k, v in self.__dict__.items() if v is None and k != 'test_sets']
            raise ValueError(f"Missing required environment variables: {missing}")

def main():
    """Main entry point for the evaluator."""
    import argparse
    parser = argparse.ArgumentParser(description="DeepEval Evaluator CLI")
    parser.add_argument("--test-set", help="Filename of the specific golden dataset to execute (e.g. golden_set_happy_path.jsonl)")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging for LLM judge")
    args = parser.parse_args()

    # Configure logging
    logging.basicConfig(
        level=logging.DEBUG if args.debug or os.getenv("DEBUG", "False").lower() in ("true", "1", "t") else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    from runner import DeepEvalRunner
    cfg = EvaluatorConfig(test_set=args.test_set, debug=args.debug)
    try:
        cfg.validate()
        DeepEvalRunner(cfg).run()
    except Exception as e:
        logger.error(f"❌ Execution failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
