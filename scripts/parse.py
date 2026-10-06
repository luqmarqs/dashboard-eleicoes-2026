"""Atalho para `run_pipeline.py --parse` (aceita as mesmas opções de escopo)."""

import sys

from tse2026.cli import main

if __name__ == "__main__":
    sys.exit(main(default_steps=("parse",)))
