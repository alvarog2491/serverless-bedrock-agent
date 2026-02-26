import os
import sys
import boto3
import mimetypes
from pathlib import Path
from botocore.exceptions import ClientError

def sync_to_s3(source_dir, bucket_name, target_prefix=""):
    """
    Syncs a local directory to an S3 bucket using boto3.
    """
    s3 = boto3.client('s3')
    
    # Ensure target_prefix ends with / if not empty
    if target_prefix and not target_prefix.endswith('/'):
        target_prefix += '/'

    # 1. Validation
    source_path = Path(source_dir)
    if not source_path.exists():
        print(f"❌ Error: Source directory '{source_dir}' does not exist.")
        sys.exit(1)

    try:
        # Check if bucket exists/is accessible
        s3.head_bucket(Bucket=bucket_name)
    except ClientError as e:
        print(f"❌ Error: Bucket '{bucket_name}' not found or no access. {e}")
        sys.exit(1)

    print(f"🚀 Starting sync: {source_path} ➔ s3://{bucket_name}/{target_prefix}")

    # 2. Sync logic
    files_uploaded = 0
    for file_path in source_path.rglob('*'):
        if file_path.is_file():
            # Create the S3 key (relative path from the source directory)
            rel_path = str(file_path.relative_to(source_path))
            s3_key = f"{target_prefix}{rel_path}"
            
            # Detect content type (helps Bedrock parse files correctly)
            content_type, _ = mimetypes.guess_type(str(file_path))
            extra_args = {'ContentType': content_type} if content_type else {}

            try:
                print(f"Uploading: {s3_key}")
                s3.upload_file(
                    Filename=str(file_path),
                    Bucket=bucket_name,
                    Key=s3_key,
                    ExtraArgs=extra_args
                )
                files_uploaded += 1
            except Exception as e:
                print(f"  ⚠️  Failed to upload {s3_key}: {e}")

    print(f"✅ Sync complete. {files_uploaded} files uploaded to {bucket_name} under prefix '{target_prefix}'.")

if __name__ == "__main__":
    # Check for arguments passed from GitHub Action
    if len(sys.argv) < 3:
        print("Usage: python sync_data.py <source_dir> <bucket_name> [target_prefix]")
        sys.exit(1)

    target_dir = sys.argv[1]
    target_bucket = sys.argv[2]
    prefix = sys.argv[3] if len(sys.argv) > 3 else ""

    sync_to_s3(target_dir, target_bucket, prefix)