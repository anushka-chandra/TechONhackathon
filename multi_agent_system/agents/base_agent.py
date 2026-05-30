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


_MODEL = os.getenv("AGENT_MODEL", "google/gemini-2.5-flash")

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


# ── Debate-mode prompts ─────────────────────────────────────────────────────────

_DEBATE_SYSTEM_SUFFIX = (
    "\n\nYou are now taking part in a LIVE BOARDROOM DEBATE about this purchasing "
    "decision with other executives. Stay fully in character. Be concise, pointed, "
    "and conversational — speak in the first person as if seated around a table. "
    "When you disagree with another member, address them by name and say exactly why."
)

_DEBATE_SCHEMA_ARG = """Respond with a single JSON object — no markdown:
{
  "message": "<your spoken argument: 2-4 sentences, first person, debate tone>",
  "preferred_vendor": "<the vendor you currently favor, exact name from the list>"
}"""

_DEBATE_SCHEMA_CLOSE = """Respond with a single JSON object — no markdown:
{
  "message": "<your final closing statement: 2-3 sentences>",
  "preferred_vendor": "<your final pick, exact name from the list>",
  "vote": "YES" or "NO",
  "confidence": <integer 0-100>
}"""


def _format_transcript(transcript: list) -> str:
    """Render the debate-so-far for the next speaker's context (cap recent turns)."""
    if not transcript:
        return "(no statements yet — you may be the first to speak)"
    recent = transcript[-24:]
    return "\n".join(f"- {t['name']}: {t['message']}" for t in recent)


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

    # ── Debate mode ─────────────────────────────────────────────────────────────

    def speak(
        self,
        requirements: str,
        vendor_info: str,
        transcript: list,
        phase: str,
        vendors: list,
    ) -> dict:
        """
        Produce one debate turn for the given phase ('opening' | 'rebuttal' | 'closing').
        The agent sees the transcript so far and argues in character.
        """
        try:
            return self._debate_call(requirements, vendor_info, transcript, phase, vendors)
        except (APIError, Exception):
            return self._debate_fallback(phase, vendors)

    def _persona(self) -> str:
        """The agent's character prompt without the evaluation JSON schema."""
        return self.SYSTEM_PROMPT.replace(_RESPONSE_SCHEMA, "").rstrip()

    def _debate_call(
        self, requirements: str, vendor_info: str, transcript: list, phase: str, vendors: list
    ) -> dict:
        is_close = phase == "closing"
        schema = _DEBATE_SCHEMA_CLOSE if is_close else _DEBATE_SCHEMA_ARG
        system = self._persona() + _DEBATE_SYSTEM_SUFFIX + "\n\n" + schema

        vendor_block = (
            f"\n\nVENDOR INFORMATION (from uploaded documents):\n{vendor_info[:4000]}"
            if vendor_info.strip()
            else ""
        )
        instructions = {
            "opening":  "Give your OPENING statement. State which vendor you favor and the single "
                        "strongest reason from your professional lens.",
            "rebuttal": "It is the REBUTTAL round. Read the statements above. Directly challenge at "
                        "least one other board member by name where you disagree, then defend your "
                        "own position.",
            "closing":  "Give your CLOSING statement and your final vote.",
        }[phase]

        user = (
            f"PROCUREMENT BRIEF:\n{requirements}"
            + vendor_block
            + f"\n\nVENDORS ON THE TABLE: {', '.join(vendors)}"
            + f"\n\nDEBATE SO FAR:\n{_format_transcript(transcript)}"
            + f"\n\nYOUR TASK: {instructions}"
        )

        resp = self._client.chat.completions.create(
            model=_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
            response_format={"type": "json_object"},
            max_tokens=320,
            temperature=0.6,
        )
        raw = json.loads(resp.choices[0].message.content)
        return self._normalise_turn(raw, phase)

    def _normalise_turn(self, raw: dict, phase: str) -> dict:
        turn = {
            "id":               self.agent_id,
            "name":             self.name,
            "icon":             self.icon,
            "role":             self.role,
            "phase":            phase,
            "message":          str(raw.get("message", "")).strip()[:700],
            "preferred_vendor": str(raw.get("preferred_vendor", "")).strip(),
        }
        if phase == "closing":
            vote = str(raw.get("vote", "YES")).upper()
            turn["vote"] = vote if vote in ("YES", "NO") else "YES"
            try:
                turn["confidence"] = max(0, min(100, int(raw.get("confidence", 75))))
            except (ValueError, TypeError):
                turn["confidence"] = 75
        else:
            turn["vote"] = ""
            turn["confidence"] = None
        return turn

    def _debate_fallback(self, phase: str, vendors: list) -> dict:
        pick = vendors[0] if vendors else ""
        turn = {
            "id":               self.agent_id,
            "name":             self.name,
            "icon":             self.icon,
            "role":             self.role,
            "phase":            phase,
            "message":          (
                f"[offline] From a {self.role} standpoint, {pick} appears to be the "
                f"stronger fit given the brief."
            ),
            "preferred_vendor": pick,
        }
        if phase == "closing":
            turn["vote"] = "YES"
            turn["confidence"] = 70
        else:
            turn["vote"] = ""
            turn["confidence"] = None
        return turn
