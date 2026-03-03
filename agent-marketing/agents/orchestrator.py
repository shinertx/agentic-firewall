"""
Studio Marketing Orchestrator — Product-Aware.
Runs the core pipeline: Scout → Engager → Poster.
Only imports agents that actually exist. Supports --single-cycle for cron/CI.
"""
import time
import sys
import os
import logging
import argparse
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

# Ensure we can import from local directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents.scout import ScoutAgent
from agents.engager import EngagerAgent
from agents.poster import PosterAgent

# Optional agents — import only if they exist
try:
    from agents.youtube_scout import YouTubeScout
    HAS_YOUTUBE = True
except ImportError:
    HAS_YOUTUBE = False

# Configure structured logging
def _setup_logging():
    log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs")
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, "orchestrator.log")

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler(sys.stdout)
        ]
    )
    return logging.getLogger("studio.orchestrator")


AGENT_TIMEOUT_S = int(os.getenv("AGENT_TIMEOUT", "120"))


def _run_agent_with_timeout(logger, name, agent_fn, timeout=AGENT_TIMEOUT_S):
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(agent_fn)
            future.result(timeout=timeout)
            logger.info("%s completed successfully", name)
            return True
    except FuturesTimeoutError:
        logger.error("%s timed out after %ds", name, timeout)
        return False
    except Exception as e:
        logger.error("%s failed: %s", name, e, exc_info=True)
        return False


def run_cycle(logger, cycle_count=1):
    """Run one marketing cycle: Scout → Engager → Poster."""
    cycle_start = time.time()
    logger.info("=== Cycle %d Starting ===", cycle_count)

    # Core pipeline
    scout = ScoutAgent()
    engager = EngagerAgent()
    poster = PosterAgent()

    # Phase 1: Hunt — find leads across all products
    _run_agent_with_timeout(logger, "Scout", scout.run)

    if HAS_YOUTUBE:
        youtube = YouTubeScout()
        _run_agent_with_timeout(logger, "YouTube Scout", youtube.run)

    # Phase 2: Draft — generate product-specific replies
    _run_agent_with_timeout(logger, "Engager", engager.run)

    # Phase 3: Post — auto-post to Reddit
    post_ok = _run_agent_with_timeout(logger, "Poster", poster.run)

    cycle_duration = time.time() - cycle_start
    logger.info("=== Cycle %d Complete (%.2fs) ===", cycle_count, cycle_duration)

    return post_ok


def run_swarm(single_cycle=False):
    """Run the Studio Marketing Swarm."""
    logger = logging.getLogger("studio.orchestrator")
    logger.info("Studio Marketing Swarm starting...")

    if single_cycle:
        logger.info("Running single cycle (cron mode)")
        run_cycle(logger, 1)
        logger.info("Single cycle complete. Exiting.")
        return

    # Continuous mode
    cycle_count = 1
    poster_failures = 0

    try:
        while True:
            post_ok = run_cycle(logger, cycle_count)

            if not post_ok:
                poster_failures += 1
                logger.warning("Poster failure #%d", poster_failures)
                if poster_failures >= 5:
                    logger.critical("Poster failed %d times — circuit breaker triggered.", poster_failures)
                    break
            else:
                poster_failures = 0

            cycle_count += 1
            logger.info("Sleeping 300s before next cycle...")
            time.sleep(300)

    except KeyboardInterrupt:
        logger.info("Swarm stopped after %d cycles", cycle_count - 1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Studio Marketing Swarm")
    parser.add_argument("--single-cycle", action="store_true",
                        help="Run one cycle and exit (for cron/CI)")
    args = parser.parse_args()

    logger = _setup_logging()
    logger.info("Orchestrator starting")
    run_swarm(single_cycle=args.single_cycle)
    logger.info("Orchestrator shutdown complete")
