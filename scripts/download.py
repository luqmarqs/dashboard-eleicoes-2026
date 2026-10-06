"""Atalho para `run_pipeline.py --download` (aceita as mesmas opções de escopo)."""

import sys

from tse2026.cli import main

if __name__ == "__main__":
    sys.exit(main(default_steps=("download",)))
