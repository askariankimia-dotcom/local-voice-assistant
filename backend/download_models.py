"""Download the Kokoro speech model (about 120 MB, once) into backend/models/."""
import subprocess
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlretrieve

BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = ["kokoro-v1.0.int8.onnx", "voices-v1.0.bin"]
folder = Path(__file__).parent / "models"
folder.mkdir(exist_ok=True)

for name in FILES:
    target = folder / name
    if target.exists():
        print(f"Already downloaded: {name}")
        continue
    print(f"Downloading {name} ...")
    partial = target.with_suffix(".part")
    try:
        urlretrieve(BASE + name, partial)
    except URLError:
        # e.g. CERTIFICATE_VERIFY_FAILED on python.org builds for macOS: curl uses the system certificates.
        subprocess.run(["curl", "-fL", "-o", str(partial), BASE + name], check=True)
    partial.replace(target)
    print(f"Saved {target}")

print("Speech model ready.")
