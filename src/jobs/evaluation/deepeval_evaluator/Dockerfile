FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY *.py .
COPY metrics_thresholds.json .

# Run the evaluator
CMD ["python", "evaluator.py"]
