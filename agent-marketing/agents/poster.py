"""
Poster Agent for Agent Firewall Marketing Swarm.
Reads draft replies and posts them to Reddit via PRAW.
"""
import json
import os
import time
import random
import logging
import fcntl
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

try:
    import praw
    from praw.exceptions import RedditAPIException
except ImportError:
    praw = None
    RedditAPIException = Exception

logger = logging.getLogger("firewall.poster")

DRAFTS_FILE = "data/draft_replies.json"
DASHBOARD_FILE = "data/dashboard.md"


class PosterAgent:
    def __init__(self):
        self.drafts = []
        self.reddit = None
        auto_post_value = os.getenv("STUDIO_AUTO_POST", os.getenv("JENNI_AUTO_POST", "false"))
        self.auto_post = auto_post_value.lower() == "true"
        self.max_retries = 2

        if praw:
            try:
                self.reddit = praw.Reddit(
                    client_id=os.getenv("REDDIT_CLIENT_ID"),
                    client_secret=os.getenv("REDDIT_CLIENT_SECRET"),
                    username=os.getenv("REDDIT_USERNAME"),
                    password=os.getenv("REDDIT_PASSWORD"),
                    user_agent=os.getenv("REDDIT_USER_AGENT", "AgenticFirewallSwarm/1.0"),
                )
                logger.info(f"Reddit authenticated as u/{self.reddit.user.me()}")
            except Exception as e:
                logger.error(f"Reddit auth failed: {e}")
                self.reddit = None
                self.auto_post = False

    def load_drafts(self):
        if not os.path.exists(DRAFTS_FILE):
            self.drafts = []
            return
        try:
            with open(DRAFTS_FILE, 'r') as f:
                fcntl.flock(f.fileno(), fcntl.LOCK_SH)
                try:
                    self.drafts = json.load(f)
                finally:
                    fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        except Exception as e:
            logger.error(f"Failed to load drafts: {e}")
            self.drafts = []

    def save_drafts(self):
        os.makedirs(os.path.dirname(DRAFTS_FILE) or ".", exist_ok=True)
        try:
            with open(DRAFTS_FILE, 'w') as f:
                fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                try:
                    json.dump(self.drafts, f, indent=2)
                finally:
                    fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        except Exception as e:
            logger.error(f"Failed to save drafts: {e}")

    def post_reply(self, draft, retry_count=0):
        if not self.reddit:
            return False

        try:
            target_url = draft.get('target_url')
            if not target_url:
                return False

            logger.info(f"Posting reply to {target_url}")
            submission = self.reddit.submission(url=target_url)

            reply_text = draft.get('suggested_reply')
            if not reply_text:
                return False

            posted_comment = submission.reply(reply_text)

            if posted_comment and posted_comment.id:
                logger.info(f"Successfully posted comment ID: {posted_comment.id}")
                draft['status'] = 'posted'
                draft['posted_at'] = datetime.now().isoformat()
                draft['reddit_comment_id'] = posted_comment.id
                return True

        except RedditAPIException as e:
            error_msg = str(e)
            logger.warning(f"Reddit API Error: {error_msg}")
            if "RATELIMIT" in error_msg and retry_count < self.max_retries:
                logger.info(f"Rate limited. Retrying after 120s (attempt {retry_count + 1})")
                time.sleep(120)
                return self.post_reply(draft, retry_count + 1)
            else:
                draft['status'] = 'failed'
                draft['error'] = error_msg

        except Exception as e:
            logger.error(f"Error posting reply: {e}")
            if retry_count < self.max_retries:
                time.sleep(120)
                return self.post_reply(draft, retry_count + 1)
            else:
                draft['status'] = 'failed'
                draft['error'] = str(e)

        return False

    def run(self):
        self.load_drafts()

        if self.auto_post and self.reddit:
            logger.info("Auto-Poster is ENABLED. Processing drafts...")
            pending = [d for d in self.drafts if d.get('status') == 'draft']
            logger.info(f"Found {len(pending)} pending drafts to post")

            for draft in pending:
                success = self.post_reply(draft)
                self.save_drafts()
                if success:
                    sleep_time = random.randint(90, 240)
                    logger.info(f"Sleeping {sleep_time}s between posts to avoid spam filters")
                    time.sleep(sleep_time)
        else:
            if not self.auto_post:
                logger.info("Auto-Poster is DISABLED. Set STUDIO_AUTO_POST=true to enable. JENNI_AUTO_POST is still supported as a legacy fallback.")
            if not self.reddit:
                logger.warning("Reddit client not available.")


if __name__ == "__main__":
    os.makedirs("logs", exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[
            logging.FileHandler("logs/poster.log"),
            logging.StreamHandler(),
        ],
    )
    PosterAgent().run()
