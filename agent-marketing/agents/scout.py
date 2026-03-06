"""
Scout Agent — Studio-Level Product-Aware Lead Scanner.
Scans subreddits via RSS for pain-keyword matches across ALL studio products.
Each lead is tagged with the product_id and surface_id it matched.
"""
import requests
import json
import time
import xml.etree.ElementTree as ET
from datetime import datetime
import os
import sys
import logging
import fcntl
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("studio.scout")

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.append(PROJECT_ROOT)

from registry import load_surface_targets  # noqa: E402

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "leads.json")


def load_surfaces():
    """Load normalized marketing surfaces from the shared registry."""
    try:
        products, registry_path = load_surface_targets()
        logger.info("Loaded product registry from %s", registry_path)
        return products
    except Exception as e:
        logger.error("Failed to load products.json: %s", e)
        return []


class ScoutAgent:
    def __init__(self):
        self.leads = []
        self.seen_ids = set()
        self.surfaces = load_surfaces()

        # Build a merged keyword → surface mapping
        self.keyword_map = {}  # keyword_string -> [surface_ids]
        self.surface_map = {}
        self.all_subreddits = set()

        for surface in self.surfaces:
            self.surface_map[surface["id"]] = surface

            for kw in surface.get("keywords", []):
                kw_lower = kw.lower()
                if kw_lower not in self.keyword_map:
                    self.keyword_map[kw_lower] = []
                self.keyword_map[kw_lower].append(surface["id"])

            for sub in surface.get("subreddits", []):
                self.all_subreddits.add(sub)

        logger.info(
            "Loaded %d surfaces with %d keywords across %d subreddits",
            len(self.surfaces),
            len(self.keyword_map),
            len(self.all_subreddits),
        )

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

                # Match against ALL surface keywords
                matched_surfaces = set()
                matched_keywords = []

                for kw, surface_ids in self.keyword_map.items():
                    if kw in t_lower:
                        matched_keywords.append(kw)
                        for surface_id in surface_ids:
                            matched_surfaces.add(surface_id)

                if matched_surfaces:
                    # Intent scoring
                    score = len(matched_keywords)  # base: how many keywords matched
                    if any(w in t_lower for w in ["bill", "cost", "$", "expensive", "burned"]):
                        score += 3
                    if any(w in t_lower for w in ["loop", "stuck", "spinning", "infinite"]):
                        score += 2
                    if any(w in t_lower for w in ["same day", "same-day", "pickup", "local inventory"]):
                        score += 2
                    if len(matched_surfaces) > 1:
                        score += 2  # bonus for multi-surface relevance

                    # Pick the best surface to promote (highest keyword overlap).
                    # Exclude surfaces whose negative keywords are present.
                    surface_scores = {}
                    for kw in matched_keywords:
                        for surface_id in self.keyword_map[kw]:
                            surface = self.surface_map[surface_id]
                            if any(exclusion.lower() in t_lower for exclusion in surface.get("negative_keywords", [])):
                                continue
                            surface_scores[surface_id] = surface_scores.get(surface_id, 0) + 1

                    if not surface_scores:
                        continue

                    best_surface_id = max(surface_scores, key=surface_scores.get)
                    best_surface = self.surface_map[best_surface_id]
                    matched_product_ids = sorted({self.surface_map[surface_id]["product_id"] for surface_id in surface_scores})

                    lead = {
                        "id": pid,
                        "source": "Reddit",
                        "subreddit": subreddit,
                        "keywords": matched_keywords,
                        "product_id": best_surface["product_id"],
                        "product_name": best_surface["product_name"],
                        "surface_id": best_surface["id"],
                        "surface_name": best_surface["name"],
                        "all_matching_products": matched_product_ids,
                        "all_matching_surfaces": sorted(surface_scores.keys()),
                        "title": title,
                        "selftext": str(text)[:500],
                        "url": permalink,
                        "timestamp": datetime.now().isoformat(),
                        "status": "new",
                        "intent_score": score,
                    }
                    logger.info(
                        "LEAD: [%s/%s] %s (surfaces: %s, score: %d)",
                        best_surface["product_id"],
                        best_surface["id"],
                        lead["title"][:50],
                        sorted(surface_scores.keys()),
                        score,
                    )
                    self.leads.append(lead)
                    self.seen_ids.add(pid)

        except Exception as e:
            logger.exception("Exception scanning r/%s: %s", subreddit, e)

    def run(self):
        logger.info("Studio Scout Agent starting — scanning for %d surfaces...", len(self.surfaces))
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
