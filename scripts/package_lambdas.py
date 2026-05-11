from __future__ import annotations

import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAMBDA_ROOT = ROOT / "src" / "lambdas"
SHARED_ROOT = LAMBDA_ROOT / "shared"
BUILD_ROOT = ROOT / "build" / "lambda"
FUNCTIONS = [
    "create_upload",
    "start_processing",
    "validate_input",
    "textract_start",
    "textract_get_results",
    "parse_and_score",
    "review_api",
    "failure_handler",
]


def add_tree(zip_file: zipfile.ZipFile, source: Path, prefix: Path | None = None) -> None:
    for path in sorted(source.rglob("*")):
        if path.is_dir():
            continue
        relative = path.relative_to(source)
        archive_name = relative if prefix is None else prefix / relative
        zip_file.write(path, archive_name.as_posix())


def package_function(function_name: str) -> Path:
    handler_path = LAMBDA_ROOT / function_name / "handler.py"
    if not handler_path.exists():
        raise FileNotFoundError(f"missing Lambda handler: {handler_path}")

    BUILD_ROOT.mkdir(parents=True, exist_ok=True)
    zip_path = BUILD_ROOT / f"{function_name}.zip"
    if zip_path.exists():
        zip_path.unlink()

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        zip_file.write(handler_path, "handler.py")
        add_tree(zip_file, SHARED_ROOT)

    return zip_path


def main() -> None:
    if BUILD_ROOT.exists():
        shutil.rmtree(BUILD_ROOT)
    for function_name in FUNCTIONS:
        zip_path = package_function(function_name)
        print(f"packaged {function_name}: {zip_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
