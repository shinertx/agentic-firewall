"""
Engager Agent — Studio-Level Product-Aware Reply Generator.
Reads leads tagged with product_id, looks up the product in the registry,
and generates contextual replies promoting the right product.
"""
import json
import os
from datetime import datetime
import logging
import fcntl
from dotenv import load_dotenv

load_dotenv()
try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

logger = logging.getLogger("studio.engager")

LEAD_FILES = ["data/leads.json", "data/leads_youtube.json"]
OUTPUT_FILE = "data/draft_replies.json"
PRODUCTS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "products.json")


def load_products():
    """Load product registry into a dict keyed by product id."""
    try:
        with open(PRODUCTS_FILE, 'r') as f:
            data = json.load(f)
            return {p["id"]: p for p in data.get("products", [])}
    except Exception as e:
        logger.error("Failed to load products.json: %s", e)
        return {}


# System prompts per reply_style
STYLE_PROMPTS = {
    "empathetic-technical": (
        "You are a software engineer who built {name}. {tagline} "
        "Read the user's Reddit post. Write a 2-3 sentence empathetic, highly technical reply "
        "that addresses their specific pain point. Be genuine, not corporate. Output ONLY the raw reply text."
    ),
    "helpful-free-tool": (
        "You are a developer who built a free, open-source CLI called {name}. {tagline} "
        "Read the user's Reddit post. Write a 2-3 sentence helpful reply offering your free tool. "
        "Mention it's free, runs locally, no signup. Be casual and helpful. Output ONLY the raw reply text."
    ),
    "technical-benchmark": (
        "You are the builder of {name}, a proxy that compresses AI agent context windows. {tagline} "
        "Read the user's Reddit post. Write a 2-3 sentence technical reply with specific numbers "
        "(70% compression, preserves last 4 messages). Be concise. Output ONLY the raw reply text."
    ),
    "business-focused": (
        "You are a founder who built {name}. {tagline} "
        "Read the user's Reddit post. Write a 2-3 sentence business-focused reply about cost governance. "
        "Mention per-agent budget limits and real-time spend tracking. Output ONLY the raw reply text."
    ),
    "pain-aware": (
        "You are a founder who built {name} because AI support agents kept marking tickets 'resolved' "
        "when the customer issue wasn't actually fixed. {tagline} "
        "Read the user's post. Write a 2-3 sentence empathetic reply connecting to their pain. Output ONLY the raw reply text."
    ),
    "helpful-fellow-seller": (
        "You are an Amazon seller who built {name} to help with product research. {tagline} "
        "Read the user's post. Write a 2-3 sentence helpful reply from a fellow seller perspective. Output ONLY the raw reply text."
    ),
}


class EngagerAgent:
    def __init__(self):
        self.drafts = []
        self.products = load_products()

    def load_leads(self):
        all_leads = []
        for file_path in LEAD_FILES:
            abs_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), file_path)
            if os.path.exists(abs_path):
                try:
                    with open(abs_path, 'r') as f:
                        all_leads.extend(json.load(f))
                except Exception as e:
                    logger.error("Failed to load leads from %s: %s", abs_path, e)
        return all_leads

    def load_existing_drafts(self):
        abs_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), OUTPUT_FILE)
        if os.path.exists(abs_path):
            try:
                with open(abs_path, "r") as f:
                    return json.load(f)
            except Exception:
                return []
        return []

    def get_product_context(self, lead):
        """Look up the product this lead matched and return its details."""
        product_id = lead.get("product_id")

        # Legacy leads without product_id default to agentic-firewall
        if not product_id:
            product_id = "agentic-firewall"

        product = self.products.get(product_id)
        if not product:
            logger.warning("Unknown product_id: %s — falling back to firewall", product_id)
            product = self.products.get("agentic-firewall", {
                "name": "Agentic Firewall",
                "tagline": "Kill infinite loops. Cut API waste by 40%.",
                "url": "https://api.jockeyvc.com",
                "landing": "https://ai.jockeyvc.com",
                "reply_style": "empathetic-technical"
            })

        return product

    def generate_reply(self, lead):
        product = self.get_product_context(lead)
        product_name = product.get("name", "our tool")
        product_url = product.get("landing", product.get("url", ""))
        reply_style = product.get("reply_style", "empathetic-technical")

        # Try LLM generation first
        openai_key = os.getenv("OPENAI_API_KEY") or os.getenv("NVIDIA_API_KEY")
        llm_reply = None

        if OpenAI and openai_key:
            try:
                if openai_key.startswith("nvapi-"):
                    client = OpenAI(base_url="https://integrate.api.nvidia.com/v1", api_key=openai_key)
                    model_name = "meta/llama-3.1-70b-instruct"
                else:
                    client = OpenAI(api_key=openai_key)
                    model_name = "gpt-4o"

                system_prompt = STYLE_PROMPTS.get(reply_style, STYLE_PROMPTS["empathetic-technical"])
                system_prompt = system_prompt.format(
                    name=product_name,
                    tagline=product.get("tagline", "")
                )

                context = f"Title: {lead.get('title', '')}\nBody: {lead.get('selftext', '')}"

                response = client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": context}
                    ],
                    max_completion_tokens=150,
                    temperature=0.7
                )
                llm_text = response.choices[0].message.content.strip()
                llm_reply = f"{llm_text} Check it out: {product_url} (disclosure: I built it)"
            except Exception as e:
                logger.error("LLM generation failed (falling back to template): %s", e)

        # Fallback to product reply_template
        if not llm_reply:
            template = product.get("reply_template", "{name} might help: {url}")
            llm_reply = template.format(
                name=product_name,
                tagline=product.get("tagline", ""),
                url=product_url,
                landing=product.get("landing", product_url),
                npm=product.get("npm", "")
            )
            llm_reply += f" (disclosure: I built it)"

        return {
            "lead_id": lead.get("id"),
            "target_url": lead.get("url"),
            "lead_text": lead.get("title"),
            "product_id": lead.get("product_id", "agentic-firewall"),
            "product_name": product_name,
            "suggested_reply": llm_reply,
            "status": "draft",
            "generated_at": datetime.now().isoformat()
        }

    def run(self):
        logger.info("Studio Engager starting — %d products loaded...", len(self.products))
        leads = self.load_leads()

        existing = self.load_existing_drafts()
        existing_ids = {d["lead_id"] for d in existing if d.get("lead_id")}

        for lead in leads:
            if lead.get('status') == 'new' and lead.get("id") not in existing_ids:
                draft = self.generate_reply(lead)
                self.drafts.append(draft)
                logger.info("Drafted [%s] reply for: %s",
                            draft.get("product_name", "?"), lead.get('title', '')[:30])

        abs_output = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), OUTPUT_FILE)
        os.makedirs(os.path.dirname(abs_output), exist_ok=True)
        with open(abs_output, 'w') as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            try:
                merged = list(existing) + self.drafts
                json.dump(merged, f, indent=2)
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    EngagerAgent().run()
