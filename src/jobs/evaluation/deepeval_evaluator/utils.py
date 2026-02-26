import time
import functools
import logging

logger = logging.getLogger(__name__)

def retry_with_backoff(max_retries=5, base_delay=2, retry_exceptions=(Exception,)):
    """
    Decorator optimized for 100 RPM.
    Uses a shorter base delay and standard exponential backoff.
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            retries = 0
            while retries < max_retries:
                try:
                    return func(*args, **kwargs)
                except retry_exceptions as e:
                    error_msg = str(e).lower()
                    
                    if any(msg in error_msg for msg in ["throttling", "rate limit", "too many requests", "429"]):
                        retries += 1
                        # Wait time grows: 4s, 8s, 16s...
                        wait_time = base_delay * (2 ** retries)
                        
                        logger.warning(f"⚠️ Rate Limit hit. Retrying {retries}/{max_retries} in {wait_time}s...")
                        time.sleep(wait_time)
                    else:
                        logger.error(f"❌ Non-recoverable error: {e}")
                        raise e
            return None
        return wrapper
    return decorator