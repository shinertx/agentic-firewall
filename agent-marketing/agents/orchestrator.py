import time
import sys
import os
import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

# Ensure we can import from local directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents.scout import ScoutAgent
from agents.engager import EngagerAgent
from agents.poster import PosterAgent
from agents.youtube_poster import YouTubePosterAgent
from agents.tiktok_scout import TikTokScout
from agents.youtube_scout import YouTubeScout
from agents.twitter_sniper import TwitterSniper
from agents.seo_generator import SEOGenerator
from agents.account_healer import AccountHealerAgent
from agents.gmail_monitor import GmailMonitor


# Configure structured logging
def _setup_logging():
    """Initialize logging for the orchestrator and all agents."""
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

    return logging.getLogger("jenni.orchestrator")

# Agent timeout setting (in seconds)
AGENT_TIMEOUT_S = int(os.getenv("JENNI_AGENT_TIMEOUT", "120"))

def _run_agent_with_timeout(logger, name, agent_fn, timeout=AGENT_TIMEOUT_S):
    """
    Run an agent with a timeout to prevent hung agents from blocking the pipeline.

    Args:
        logger: Logger instance
        name: Agent name for logging
        agent_fn: Callable (agent.run) to execute
        timeout: Timeout in seconds

    Returns:
        True if successful, False if timed out or failed
    """
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

def run_swarm():
    """Run the Jenni Marketing Swarm with error handling and timeouts."""
    logger = logging.getLogger("jenni.orchestrator")
    logger.info("Spinning up Jenni Marketing Swarm...")

    scout = ScoutAgent()
    tiktok = TikTokScout()
    youtube = YouTubeScout()
    twitter = TwitterSniper()
    seo = SEOGenerator()

    engager = EngagerAgent()
    poster = PosterAgent()
    yt_poster = YouTubePosterAgent()

    # Account health agents
    healer = AccountHealerAgent(reddit=poster.reddit)
    gmail_monitor = GmailMonitor()

    cycle_count = 1
    poster_failures = 0

    try:
        while True:
            cycle_start = time.time()
            logger.info("=== Cycle %d Starting ===", cycle_count)

            # Phase 1: Hunt (Reddit + TikTok + YouTube + Twitter)
            _run_agent_with_timeout(logger, "Scout", scout.run)
            _run_agent_with_timeout(logger, "TikTok Scout", tiktok.run)
            _run_agent_with_timeout(logger, "YouTube Scout", youtube.run)
            _run_agent_with_timeout(logger, "Twitter Sniper", twitter.run)

            # Phase 2: Build (SEO)
            if cycle_count % 10 == 1:
                _run_agent_with_timeout(logger, "SEO Generator", seo.run)

            # Phase 3: React
            _run_agent_with_timeout(logger, "Engager", engager.run)

            # Phase 4: Action
            post_ok = _run_agent_with_timeout(logger, "Poster", poster.run)
            if not post_ok:
                poster_failures += 1
                logger.warning("Poster failure #%d", poster_failures)
            else:
                poster_failures = 0

            _run_agent_with_timeout(logger, "YouTube Poster", yt_poster.run)

            # Phase 5: Health monitoring
            # Check Gmail for Reddit alerts every cycle
            try:
                gmail_alerts = gmail_monitor.run(healer=healer)
                if gmail_alerts:
                    logger.warning("Gmail: %d Reddit alert(s) detected this cycle", len(gmail_alerts))
            except Exception as e:
                logger.warning("Gmail monitor error: %s", e)

            # Run healer proactively every 5 cycles OR if poster failing repeatedly
            if cycle_count % 5 == 0 or poster_failures >= 3:
                if poster_failures >= 5:
                    logger.critical("Poster failed %d times — REDDIT DOWN. Halting swarm circuit breaker.", poster_failures)
                    break
                
                if poster_failures >= 3:
                    logger.warning("Poster failed %d times — forcing AccountHealer", poster_failures)
                try:
                    _run_agent_with_timeout(logger, "AccountHealer", healer.run, timeout=600)
                except Exception as e:
                    logger.warning("AccountHealer error: %s", e)

            cycle_duration = time.time() - cycle_start
            logger.info("=== Cycle %d Complete (duration: %.2fs) ===", cycle_count, cycle_duration)

            cycle_count += 1

            # Slower pacing to avoid rate limits
            logger.info("Sleeping for 300 seconds before next cycle...")
            time.sleep(300)

    except KeyboardInterrupt:
        logger.info("Swarm stopping manually after %d cycles", cycle_count - 1)


if __name__ == "__main__":
    logger = _setup_logging()
    logger.info("Orchestrator starting")
    run_swarm()
    logger.info("Orchestrator shutdown complete")
