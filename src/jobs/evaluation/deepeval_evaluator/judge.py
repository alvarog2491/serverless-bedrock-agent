import litellm
import re
import json
import logging
from deepeval.models.base_model import DeepEvalBaseLLM

logger = logging.getLogger(__name__)

class BedrockJudge(DeepEvalBaseLLM):
    """
    LLM-as-a-judge implementation for DeepEval using Amazon Bedrock via LiteLLM.
    Includes robust JSON cleaning to handle models that output preamble or markdown blocks.
    """
    def __init__(self, model_name, debug=False):
        # Using the 'bedrock/' prefix for LiteLLM compatibility
        self.model_name = f"bedrock/us.{model_name}"
        self.debug = debug
    
    def load_model(self):
        """Returns the judge instance as required by DeepEval."""
        return self

    def _extract_json(self, text: str) -> str:
        # Clean Markdown and find the JSON boundaries
        text = re.sub(r"```json\s*|```", "", text).strip()
        start, end = text.find('{'), text.rfind('}') + 1
        
        if start == -1 or end == 0:
            return json.dumps({"verdicts": [], "score": 0, "reason": "No JSON found"})

        try:
            # Parse the JSON
            data = json.loads(text[start:end])
            
            # Simple patch: DeepEval MUST have the 'verdicts' key
            if "verdicts" not in data:
                data["verdicts"] = [data.get("reason", "Missing verdicts")]
                
            return json.dumps(data)
        except Exception:
            # Fallback to satisfy DeepEval's expected keys
            return json.dumps({"verdicts": [], "score": 0, "reason": "Invalid JSON format"})
        
    def generate(self, prompt: str) -> str:
        """
        Synchronous generation call. 
        Uses temperature=0 for deterministic evaluation results.
        """
        logging.getLogger("LiteLLM").setLevel(logging.WARNING)
        res = litellm.completion(
            model=self.model_name, 
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=1000,
        )
        
        raw_content = res.choices[0].message.content
        if self.debug:
            logger.debug(f"Raw Judge Output: {raw_content}")
        return self._extract_json(raw_content)

    async def a_generate(self, prompt: str) -> str:
        """
        Asynchronous generation call for parallel evaluation.
        """
        return self.generate(prompt)

    def get_model_name(self):
        """Returns the formatted model name."""
        return self.model_name