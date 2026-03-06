"""
Engager Agent — Studio-Level Product-Aware Reply Generator.
Reads leads tagged with product_id and surface_id, looks up the product in
the registry, and generates contextual replies promoting the right surface.
"""
import json
import os
import sys
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

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.append(PROJECT_ROOT)

from registry import find_surface, load_products_map  # noqa: E402


def load_products():
    """Load product registry into a dict keyed by product id."""
    try:
        products, registry_path = load_products_map()
        logger.info("Loaded product registry from %s", registry_path)
        return products
    except Exception as e:
        logger.error("Failed to load products.json: %s", e)
        return {}


# System prompts per reply_style
STYLE_PROMPTS = {
    "empathetic-technical": (
        "You are a software engineer who built {surface_name}, part of the {product_name} product line. {tagline} "
        "Read the user's post. Write a 2-3 sentence empathetic, highly technical reply "
        "that addresses their specific pain point. Explicitly mention that it works for whatever provider they are using. Output ONLY the raw reply text."
    ),
    "helpful-free-tool": (
        "You are a developer who built a free, open-source tool called {surface_name}. {tagline} "
        "Read the user's Reddit post. Write a 2-3 sentence helpful reply offering your free tool. "
        "Mention it's free, runs locally, no signup. Be casual and helpful. Output ONLY the raw reply text."
    ),
    "technical-benchmark": (
        "You are the builder of {surface_name}, a proxy that compresses AI agent context windows. {tagline} "
        "Read the user's Reddit post. Write a 2-3 sentence technical reply with specific numbers "
        "(70% compression, preserves last 4 messages). Be concise. Output ONLY the raw reply text."
    ),
    "business-focused": (
        "You are a founder who built {surface_name}. {tagline} "
        "Read the user's Reddit post. Write a 2-3 sentence business-focused reply about cost governance. "
        "Mention per-agent budget limits and real-time spend tracking. Output ONLY the raw reply text."
    ),
    "pain-aware": (
        "You are a founder who built {surface_name} because AI support agents kept marking tickets 'resolved' "
        "when the customer issue wasn't actually fixed. {tagline} "
        "Read the user's post. Write a 2-3 sentence empathetic reply connecting to their pain. Output ONLY the raw reply text."
    ),
    "consumer-local-availability": (
        "You built {surface_name}, a shopper-facing tool under the {product_name} product line. {tagline} "
        "Read the user's post. Write a 2-3 sentence helpful reply that sounds like a real person, not a marketer. "
        "Mention nearby store availability, same-day pickup or delivery, and keep it concrete. Output ONLY the raw reply text."
    ),
    "commerce-infrastructure": (
        "You are the founder of {surface_name}, infrastructure under the {product_name} brand. {tagline} "
        "Read the user's post. Write a 2-3 sentence crisp reply for merchants, operators, or partners. "
        "Focus on routing online demand to nearby in-stock inventory without a rip-and-replace migration. Output ONLY the raw reply text."
    ),
    "merchant-recovery": (
        "You built {surface_name} for merchants dealing with out-of-stock and slow-ship demand. {tagline} "
        "Read the user's post. Write a 2-3 sentence merchant-focused reply explaining how lost demand can be recovered into a same-day or local sale. "
        "Mention low-lift adoption and no heavy integration. Output ONLY the raw reply text."
    ),
    "openclaw-scanner-hook": (
        "You are a developer replying to another developer about OpenClaw loops or runaway spend. "
        "Write exactly 2 casual sentences. Keep it direct and human. "
        "Validate the pain in the first sentence, then mention that running `{cta}` shows exactly where the wasted spend went from local logs. "
        "Output ONLY the raw reply text. DO NOT use hashtags. DO NOT sound like a marketer."
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
        """Look up the product and surface this lead matched."""
        product_id = lead.get("product_id")

        # Legacy leads without product_id default to Vibe Billing.
        if not product_id:
            product_id = "vibe-billing"

        product = self.products.get(product_id)
        if not product:
            logger.warning("Unknown product_id: %s — falling back to Vibe Billing", product_id)
            product = self.products.get("vibe-billing", {
                "id": "vibe-billing",
                "name": "Vibe Billing",
                "brand_name": "Agentic Firewall",
                "default_surface": "agentic-firewall-runtime",
                "surfaces": [
                    {
                        "id": "agentic-firewall-runtime",
                        "product_id": "vibe-billing",
                        "product_name": "Vibe Billing",
                        "brand_name": "Agentic Firewall",
                        "name": "Agentic Firewall",
                        "tagline": "Kill infinite loops. Cut API waste by 40%.",
                        "url": "https://api.jockeyvc.com",
                        "landing": "https://api.jockeyvc.com",
                        "reply_style": "empathetic-technical",
                        "reply_template": (
                            "I built {surface_name} for exactly this. It sits between your agent and the model provider, "
                            "kills loops, and tracks every dollar. {tagline} Check it out: {landing}"
                        ),
                        "cta": "npx vibe-billing setup",
                        "aliases": [],
                    }
                ],
            })

        surface = find_surface(product, lead.get("surface_id"), lead.get("product_id"))
        return product, surface

    def generate_reply(self, lead):
        product, surface = self.get_product_context(lead)
        product_name = product.get("name", "our product")
        brand_name = product.get("brand_name", product_name)
        surface_name = surface.get("name", brand_name)
        product_url = surface.get("landing", surface.get("url", ""))
        reply_style = surface.get("reply_style", "empathetic-technical")
        cta = surface.get("cta", surface.get("npm", ""))

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
                    name=surface_name,
                    surface_name=surface_name,
                    product_name=product_name,
                    brand_name=brand_name,
                    tagline=surface.get("tagline", ""),
                    cta=cta,
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
                if reply_style == "openclaw-scanner-hook":
                    llm_reply = llm_text
                else:
                    llm_reply = f"{llm_text} Check it out: {product_url} (disclosure: I built it)"
            except Exception as e:
                logger.error("LLM generation failed (falling back to template): %s", e)

        # Fallback to surface reply_template
        if not llm_reply:
            template = surface.get("reply_template", "{surface_name} might help: {landing}")
            llm_reply = template.format(
                name=surface_name,
                surface_name=surface_name,
                product_name=product_name,
                brand_name=brand_name,
                tagline=surface.get("tagline", ""),
                url=product_url,
                landing=product_url,
                npm=surface.get("npm", ""),
                cta=cta,
            )
            if reply_style != "openclaw-scanner-hook":
                llm_reply += f" (disclosure: I built it)"

        return {
            "lead_id": lead.get("id"),
            "target_url": lead.get("url"),
            "lead_text": lead.get("title"),
            "product_id": product.get("id", lead.get("product_id", "vibe-billing")),
            "product_name": product_name,
            "surface_id": surface.get("id"),
            "surface_name": surface_name,
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
                logger.info(
                    "Drafted [%s/%s] reply for: %s",
                    draft.get("product_name", "?"),
                    draft.get("surface_name", "?"),
                    lead.get('title', '')[:30],
                )

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
