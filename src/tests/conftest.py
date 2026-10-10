from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("AWS_ACCESS_KEY_ID", "test")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "test")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")
os.environ.setdefault("JOBS_TABLE", "jobs")
os.environ.setdefault("AUDIT_TABLE", "audit")
os.environ.setdefault("QUOTAS_TABLE", "quotas")
sys.path.insert(0, str(Path(__file__).parents[1] / "lambdas"))
