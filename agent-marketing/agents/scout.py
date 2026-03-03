"""
Scout Agent — Studio-Level Product-Aware Lead Scanner.
Scans subreddits via RSS for pain-keyword matches across ALL studio products.
Each lead is tagged with the product_id it matched.
"""
import requests
import json
import time
import xml.etree.ElementTree as ET
from datetime import datetime
import os
import logging
import fcntl
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("studio.scout")

PRODUCTS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "products.json")
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "leads.json")


def load_products():
    """Load product registry. Every agent reads from the same file."""
    try:
        with open(PRODUCTS_FILE, 'r') as f:
            data = json.load(f)
            return data.get("products", [])
    except Exception as e:
        logger.error("Failed to load products.json: %s", e)
        return []


class ScoutAgent:
    def __init__(self):
        self.leads = []
        self.seen_ids = set()
        self.products = load_products()

        # Build a merged keyword → product mapping
        self.keyword_map = {}  # keyword_string -> [product_ids]
        self.all_subreddits = set()

        for product in self.products:
            for kw in product.get("keywords", []):
                kw_lower = kw.lower()
                if kw_lower not in self.keyword_map:
                    self.keyword_map[kw_lower] = []
                self.keyword_map[kw_lower].append(product["id"])

            for sub in product.get("subreddits", []):
                self.all_subreddits.add(sub)

        logger.info("Loaded %d products with %d keywords across %d subreddits",
                     len(self.products), len(self.keyword_map), len(self.all_subreddits))

    def load_existing(self):
        if os.path.exists(OUTPUT_FILE):
            try:
                with open(OUTPUT_FILE, 'r') as f:
                    data = json.load(f)
                    self.leads = data
                    self.seen_ids = {lead['id'] for lead in data}
                logger.info("Loaded %d existing leads from %s", len(self.leads), OUTPUT_FILE)
            except Exception as e:
                logger.warning("Failed to load existing leads: %s", e)

    def scan_reddit_rss(self, subreddit):
        logger.info("Scout scanning r/%s via RSS...", subreddit)
        url = f"https://www.reddit.com/r/{subreddit}/new.rss?limit=25"
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 JockeyVC-Studio/2.0"
        }

        try:
            response = requests.get(url, headers=headers, timeout=10)
            if response.status_code != 200:
                logger.error("Reddit RSS returned %d for r/%s", response.status_code, subreddit)
                return

            namespaces = {'atom': 'http://www.w3.org/2005/Atom'}
            root = ET.fromstring(response.content)

            for entry in root.findall('atom:entry', namespaces):
                title_elem = entry.find('atom:title', namespaces)
                title = title_elem.text if title_elem is not None else ''

                content_elem = entry.find('atom:content', namespaces)
                text = content_elem.text if content_elem is not None else ''

                id_elem = entry.find('atom:id', namespaces)
                pid = id_elem.text.split('_')[-1] if id_elem is not None else None

                link_elem = entry.find('atom:link', namespaces)
                permalink = link_elem.attrib['href'] if link_elem is not None else ''

                if not pid or not permalink or pid in self.seen_ids:
                    continue

                t_lower = (str(title) + " " + str(text)).lower()

                # Match against ALL product keywords
                matched_products = set()
                matched_keywords = []

                for kw, product_ids in self.keyword_map.items():
                    if kw in t_lower:
                        matched_keywords.append(kw)
                        for pid_match in product_ids:
                            matched_products.add(pid_match)

                if matched_products:
                    # Intent scoring
                    score = len(matched_keywords)  # base: how many keywords matched
                    if any(w in t_lower for w in ["bill", "cost", "$", "expensive", "burned"]):
                        score += 3
                    if any(w in t_lower for w in ["loop", "stuck", "spinning", "infinite"]):
                        score += 2
                    if len(matched_products) > 1:
                        score += 2  # bonus for multi-product relevance

                    # Pick the best product to promote (highest keyword overlap)
                    product_scores = {}
                    for kw in matched_keywords:
                        for p_id in self.keyword_map[kw]:
                            product_scores[p_id] = product_scores.get(p_id, 0) + 1
                    best_product = max(product_scores, key=product_scores.get)

                    lead = {
                        "id": pid,
                        "source": "Reddit",
                        "subreddit": subreddit,
                        "keywords": matched_keywords,
                        "product_id": best_product,
                        "all_matching_products": list(matched_products),
                        "title": title,
                        "selftext": str(text)[:500],
                        "url": permalink,
                        "timestamp": datetime.now().isoformat(),
                        "status": "new",
                        "intent_score": score,
                    }
                    logger.info("LEAD: [%s] %s (products: %s, score: %d)",
                                best_product, lead['title'][:50], list(matched_products), score)
                    self.leads.append(lead)
                    self.seen_ids.add(pid)

        except Exception as e:
            logger.exception("Exception scanning r/%s: %s", subreddit, e)

    def run(self):
        logger.info("Studio Scout Agent starting — scanning for %d products...", len(self.products))
        self.load_existing()

        for sub in sorted(self.all_subreddits):
            self.scan_reddit_rss(sub)
            time.sleep(2)

        os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
        try:
            with open(OUTPUT_FILE, 'w') as f:
                fcntl.flock(f, fcntl.LOCK_EX)
                try:
                    json.dump(self.leads, f, indent=2)
                    logger.info("Saved %d leads to %s", len(self.leads), OUTPUT_FILE)
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)
        except Exception as e:
            logger.exception("Failed to save leads: %s", e)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    ScoutAgent().run()
