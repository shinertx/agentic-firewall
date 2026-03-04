import os
import json
import logging
import fcntl
from pathlib import Path
from datetime import datetime
from googleapiclient.discovery import build
from dotenv import load_dotenv

# Load .env with explicit path so it works regardless of cwd
_env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=_env_path, override=True)

logger = logging.getLogger("jenni.youtube_scout")

OUTPUT_FILE = "data/leads_youtube.json"
QUERIES = [
    "openai api bill",
    "anthropic rate limit",
    "agent infinite loop",
    "langchain api cost",
    "autogpt expensive",
    "reduce llm costs",
    "prompt caching tutorial",
    "openclaw tutorial",
    "openclaw loop",
    "openclaw expensive"
]

KEYWORDS = [
    # Very high intent / severe pain
    "unexpected api bill", "huge openai bill", "huge anthropic bill", "api cost runaway",
    "agent burned my money", "agent spent too much", "api limits", "rate limit 429",
    "anthropic 429", "openai 429", "api budget exceeded", "prompt caching",
    "agent stuck in loop", "infinite loop agent", "llm infinite loop",
    "agent repeating itself", "tool call loop", "agent hallucinating loop",
    "agent keeps failing tool", "tool error loop", "agent spinning",
    "openclaw", "openclaw loop", "openclaw cost",
    "openclaw expensive", "claude code expensive", "devin expensive", 
    "auto-gpt loop", "autogpt expensive", "vibe billing",
    
    # Broader intent
    "api costs", "api pricing", "too expensive api", "reduce openai costs",
    "reduce anthropic costs", "agent framework", "build an agent",
    "agent looping", "agent stuck", "agent failed", "agent memory",
    "rate limiting", "token limit", "token costs", "cost optimization",
    "save money openai", "openai billing", "anthropic billing"
]

class YouTubeScout:
    def __init__(self):
        self.api_key = os.getenv("YOUTUBE_API_KEY")
        self.leads = []
        self.seen_ids = set()
        
    def load_existing(self):
        if os.path.exists(OUTPUT_FILE):
            try:
                with open(OUTPUT_FILE, 'r') as f:
                    data = json.load(f)
                    self.leads = data
                    self.seen_ids = {lead['id'] for lead in data}
                logger.info("Loaded %d existing YouTube leads from %s", len(self.leads), OUTPUT_FILE)
            except Exception as e:
                logger.warning("Failed to load existing YouTube leads: %s", e)
                
    def scan_youtube(self):
        if not self.api_key:
            logger.warning("YOUTUBE_API_KEY not found in .env. Skipping YouTube scan. Add your key to .env to enable YouTube.")
            return

        try:
            youtube = build('youtube', 'v3', developerKey=self.api_key)
            
            for query in QUERIES:
                logger.info(f"Scanning YouTube for: {query}")
                request = youtube.search().list(
                    q=query,
                    part='snippet',
                    type='video',
                    maxResults=5,
                    order='date'
                )
                response = request.execute()
                
                for item in response.get('items', []):
                    video_id = item['id']['videoId']
                    if video_id in self.seen_ids:
                        continue
                        
                    snippet = item.get('snippet', {})
                    title = snippet.get('title', '')
                    desc = snippet.get('description', '')
                    
                    text = (title + " " + desc).lower()
                    
                    matched_keyword = None
                    for kw in KEYWORDS:
                        if kw in text:
                            matched_keyword = kw
                            break

                    if not matched_keyword:
                        continue
                        
                    score = 1
                    if "bill" in text or "cost" in text or "$$$" in text or "expensive" in text:
                        score += 3
                    if "loop" in text or "stuck" in text or "spinning" in text:
                        score += 2
                        
                    lead = {
                        "id": video_id,
                        "source": "YouTube",
                        "subreddit": "YouTube", # for engager dashboard compatibility
                        "keyword": matched_keyword,
                        "title": title,
                        "selftext": desc,
                        "url": f"https://youtube.com/watch?v={video_id}",
                        "timestamp": datetime.now().isoformat(),
                        "status": "new",
                        "intent_score": score,
                    }
                    
                    
                    logger.info("FOUND YOUTUBE LEAD (VIDEO): %s", title)
                    self.leads.append(lead)
                    self.seen_ids.add(video_id)
                    
                    # Now fetch top comments for this video
                    try:
                        comment_request = youtube.commentThreads().list(
                            part="snippet",
                            videoId=video_id,
                            maxResults=10,
                            order="relevance"
                        )
                        comment_response = comment_request.execute()
                        
                        for thread in comment_response.get('items', []):
                            top_comment = thread['snippet']['topLevelComment']
                            comment_id = top_comment['id']
                            
                            if comment_id in self.seen_ids:
                                continue
                                
                            comment_snippet = top_comment['snippet']
                            comment_text = comment_snippet.get('textDisplay', '')
                            comment_author = comment_snippet.get('authorDisplayName', 'UnknownUser')
                            
                            c_text = comment_text.lower()
                            c_matched_keyword = None
                            for kw in KEYWORDS:
                                if kw in c_text:
                                    c_matched_keyword = kw
                                    break
                            
                            c_score = 0
                            if c_matched_keyword:
                                c_score = 1
                                if "bill" in c_text or "cost" in c_text or "$$$" in c_text or "expensive" in c_text:
                                    c_score += 3
                                if "loop" in c_text or "stuck" in c_text or "spinning" in c_text:
                                    c_score += 2

                            # Only add comments that have some intent score
                            if c_score > 0:
                                comment_lead = {
                                    "id": comment_id,
                                    "source": "YouTube",
                                    "subreddit": "YouTube",
                                    "keyword": c_matched_keyword,
                                    "title": f"Comment on: {title[:30]}...",
                                    "selftext": comment_text,
                                    "url": f"https://youtube.com/watch?v={video_id}&lc={comment_id}",
                                    "timestamp": datetime.now().isoformat(),
                                    "status": "new",
                                    "intent_score": c_score,
                                    "parent_video_id": video_id
                                }
                                logger.info("FOUND YOUTUBE LEAD (COMMENT): %s", comment_text[:50].replace('\n', ' '))
                                self.leads.append(comment_lead)
                                self.seen_ids.add(comment_id)
                                
                    except Exception as e:
                        logger.warning("Could not fetch comments for video %s: %s", video_id, e)
                    
        except Exception as e:
            logger.error("Error during YouTube scan: %s", e)

    def run(self):
        logger.info("YouTube Scout Agent starting...")
        self.load_existing()
        self.scan_youtube()
        
        os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
        try:
            with open(OUTPUT_FILE, 'w') as f:
                fcntl.flock(f, fcntl.LOCK_EX)
                try:
                    json.dump(self.leads, f, indent=2)
                    logger.info("Successfully saved %d leads to %s", len(self.leads), OUTPUT_FILE)
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)
        except Exception as e:
            logger.exception("Failed to save leads to %s: %s", OUTPUT_FILE, e)

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    scout = YouTubeScout()
    scout.run()
