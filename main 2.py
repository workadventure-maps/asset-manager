
# main.py
import argparse
import os
import sys
import subprocess

def run_clean(src_dir: str, dist_dir: str, unknow_dir: str) -> None:
    """Execute clean-images.py if available.
    Tries to import a callable first; falls back to running the script as a subprocess.
    """
    try:
        import clean_images  # if the file is named clean_images.py
        # try common entrypoints
        if hasattr(clean_images, "main"):
            clean_images.main(src_dir=src_dir, dist_dir=dist_dir, unknow_dir=unknow_dir)
        elif hasattr(clean_images, "run"):
            clean_images.run(src_dir=src_dir, dist_dir=dist_dir, unknow_dir=unknow_dir)
        elif hasattr(clean_images, "clean"):
            clean_images.clean(src_dir=src_dir, dist_dir=dist_dir, unknow_dir=unknow_dir)
        else:
            # fallback: run as script
            raise ImportError("No callable entrypoint found in clean_images.py")
    except Exception:
        # Fallback: execute the script as a subprocess if present
        candidates = ["clean-images.py", "clean_images.py"]
        for script in candidates:
            if os.path.isfile(script):
                cmd = [sys.executable, script, "--src", src_dir, "--dist", dist_dir, "--unknow", unknow_dir]
                try:
                    subprocess.check_call(cmd)
                    return
                except subprocess.CalledProcessError as e:
                    raise SystemExit(f"Cleaning failed: {e}") from e
        # Nothing worked
        raise SystemExit(
            "Could not run cleaning: 'clean-images.py' not found or no callable entrypoint. "
            "Place it next to main.py or expose a function (main/run/clean)."
        )

def run_scan(model_dir: str, src_dir: str, dist_dir: str, unknow_dir: str) -> dict:
    # Late import to avoid loading heavy deps when not needed
    import image_processor
    print("Scan: analysing and organizing assets...")
    data = image_processor.process_images(model_dir, src_dir, dist_dir, unknow_dir)
    if data:
        image_processor.generate_json_file(data)
    return data or {}

def run_server(host: str, port: int) -> None:
    import server  # late import
    server.run_server(host=host, port=port)

def main():
    parser = argparse.ArgumentParser(description="Assets pipeline: clean + scan + serve")
    parser.add_argument("--mode",
                        choices=["serve", "scan", "clean", "clean-scan", "all"],
                        default="serve",
                        help=(
                            "serve: start web server only; "
                            "scan: scan images and update assets_list.json; "
                            "clean: run clean-images.py; "
                            "clean-scan: clean then scan; "
                            "all: clean + scan then serve (legacy full workflow)."
                        ))
    parser.add_argument("--model-dir", default="model")
    parser.add_argument("--src-dir", default="src")
    parser.add_argument("--dist-dir", default="dist")
    parser.add_argument("--unknow-dir", default="unknow")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    if args.mode in ("clean", "clean-scan", "all"):
        print("Cleaning image folders...")
        run_clean(args.src_dir, args.dist_dir, args.unknow_dir)

    if args.mode in ("scan", "clean-scan", "all"):
        run_scan(args.model_dir, args.src_dir, args.dist_dir, args.unknow_dir)

    if args.mode in ("serve", "all"):
        run_server(args.host, args.port)

if __name__ == "__main__":
    main()
