"""
BaseAgent — wraps an OpenRouter (OpenAI-compatible) chat call.

Every agent subclass sets its own SYSTEM_PROMPT and calls self.evaluate().
The response is forced to JSON via response_format so parsing never fails.
If the API is unavailable the agent falls back to a deterministic mock
so the rest of the pipeline keeps working.
"""

import json
import os
from typing import Optional

from openai import OpenAI, APIError


def _client() -> OpenAI:
    return OpenAI(
        base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        api_key=os.getenv("OPENROUTER_API_KEY", ""),
    )


_MODEL = os.getenv("AGENT_MODEL", "anthropic/claude-3-haiku")

_RESPONSE_SCHEMA = """\
Respond with a single JSON object — no markdown, no explanation outside it:
{
  "vote":             "YES" or "NO" (should we proceed with this procurement?),
  "preferred_vendor": "<exact vendor name you recommend most, from the list given>",
  "confidence":       <integer 0-100>,
  "stance":           "<6-word active phrase, e.g. 'Recommending Asana for strategic fit'>",
  "reasoning":        "<2-3 sentences from your expert perspective>",
  "key_concerns":     ["<concern 1>", "<concern 2>"]
}"""


class BaseAgent:
    agent_id: str = "base"
    name:     str = "Base Agent"
    role:     str = "Generic Evaluator"
    icon:     str = "🤖"

    SYSTEM_PROMPT: str = (
        "You are a procurement evaluation agent. "
        + _RESPONSE_SCHEMA
    )

    def __init__(self) -> None:
        self._client = _client()

    # ── Public API ─────────────────────────────────────────────────────────────

    def evaluate(self, requirements: str, vendor_info: str = "") -> dict:
        """
        Run this agent against the procurement brief and vendor context.
        Returns a dict safe to serialise straight to JSON.
        """
        try:
            return self._call_llm(requirements, vendor_info)
        except (APIError, Exception):
            return self._fallback(requirements)

    # ── Internal ───────────────────────────────────────────────────────────────

    def _build_user_prompt(self, requirements: str, vendor_info: str) -> str:
        vendor_block = (
            f"\n\nVENDOR INFORMATION (extracted from uploaded documents):\n{vendor_info[:6000]}"
            if vendor_info.strip()
            else "\n\nVENDOR INFORMATION: No vendor documents provided — use general market knowledge."
        )
        return (
            f"PROCUREMENT REQUIREMENT:\n{requirements}"
            + vendor_block
            + "\n\nEvaluate and respond with the required JSON."
        )

    def _call_llm(self, requirements: str, vendor_info: str) -> dict:
        resp = self._client.chat.completions.create(
            model=_MODEL,
            messages=[
                {"role": "system", "content": self.SYSTEM_PROMPT},
                {"role": "user",   "content": self._build_user_prompt(requirements, vendor_info)},
            ],
            response_format={"type": "json_object"},
            max_tokens=400,
            temperature=0.3,
        )
        raw = json.loads(resp.choices[0].message.content)
        return self._normalise(raw)

    def _normalise(self, raw: dict) -> dict:
        """Ensure all expected keys exist with correct types."""
        vote = str(raw.get("vote", "YES")).upper()
        if vote not in ("YES", "NO"):
            vote = "YES"
        return {
            "id":               self.agent_id,
            "name":             self.name,
            "icon":             self.icon,
            "role":             self.role,
            "vote":             vote,
            "preferred_vendor": str(raw.get("preferred_vendor", "")).strip(),
            "confidence":       max(0, min(100, int(raw.get("confidence", 75)))),
            "stance":           str(raw.get("stance", self.role))[:80],
            "reasoning":        str(raw.get("reasoning", ""))[:600],
            "key_concerns":     [str(c) for c in raw.get("key_concerns", [])][:4],
            "voted_for":        "",   # filled by orchestrator
        }

    def _fallback(self, requirements: str) -> dict:
        """Used when the API is unreachable — deterministic, never crashes."""
        return {
            "id":               self.agent_id,
            "name":             self.name,
            "icon":             self.icon,
            "role":             self.role,
            "vote":             "YES",
            "preferred_vendor": "",
            "confidence":       70,
            "stance":           f"{self.role} — evaluating",
            "reasoning":        (
                f"[API unavailable] Based on the requirement '{requirements[:80]}...', "
                f"the {self.name} provisionally recommends proceeding."
            ),
            "key_concerns":     ["API unavailable — manual review recommended"],
            "voted_for":        "",
        }
