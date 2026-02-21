"""
URL Resolver — converts raw user input (text or speech) into valid URLs.

Pipeline:
  1. Direct URL detection (https://...)
  2. Domain detection (domain.tld)
  3. Phonetic normalization → domain detection
  4. Fuzzy matching against known domains
  5. Fallback to search engine query
"""

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from urllib.parse import quote_plus

from .phonetic import normalize, looks_like_url
from .domains import KNOWN_DOMAINS


@dataclass
class ResolveResult:
    """Result of URL resolution."""
    url: str | None
    suggestions: list[str] = field(default_factory=list)
    resolve_type: str = "exact"  # exact | fuzzy | search | ambiguous
    needs_clarification: bool = False
    normalized_input: str = ""


def fuzzy_match_domain(
    input_str: str,
    threshold: float = 0.55,
    max_results: int = 6,
) -> list[tuple[str, float]]:
    """
    Find closest matching domains using SequenceMatcher.

    Args:
        input_str: Raw or normalized domain string.
        threshold: Minimum similarity score (0.0–1.0).
        max_results: Maximum number of results.

    Returns:
        List of (domain, score) tuples, sorted by score descending.
    """
    cleaned = input_str.lower().strip()
    cleaned = re.sub(r"^(https?://|www\.)", "", cleaned)
    cleaned = cleaned.split("/")[0]

    matches = []
    for domain in KNOWN_DOMAINS:
        ratio = SequenceMatcher(None, cleaned, domain).ratio()
        if ratio >= threshold:
            matches.append((domain, ratio))

    matches.sort(key=lambda x: -x[1])
    return matches[:max_results]


def resolve(raw_input: str, threshold: float = 0.55) -> ResolveResult:
    """
    Resolve user input into a browseable URL.

    Args:
        raw_input: Raw text from keyboard or speech recognition.
        threshold: Fuzzy matching threshold.

    Returns:
        ResolveResult with URL, suggestions, and resolution type.
    """
    text = raw_input.strip()
    if not text:
        return ResolveResult(url=None, resolve_type="ambiguous", needs_clarification=True)

    # 1) Already a valid URL?
    if re.match(r"^https?://", text):
        return ResolveResult(url=text, resolve_type="exact", normalized_input=text)

    # 2) Looks like a domain?
    if re.match(r"^[\w.-]+\.\w{2,}", text):
        return ResolveResult(
            url=f"https://{text}",
            resolve_type="exact",
            normalized_input=text,
        )

    # 3) Apply phonetic normalization
    normalized = normalize(text)
    if looks_like_url(normalized):
        # Check fuzzy matches too, in case normalization was imperfect
        fuzzy = fuzzy_match_domain(normalized, threshold)
        suggestions = [f"https://{d}" for d, _ in fuzzy if d != normalized]
        return ResolveResult(
            url=f"https://{normalized}",
            suggestions=suggestions[:3],
            resolve_type="fuzzy",
            normalized_input=normalized,
        )

    # 4) Fuzzy match against known domains
    fuzzy = fuzzy_match_domain(text, threshold)
    if fuzzy:
        best_domain, best_score = fuzzy[0]
        all_suggestions = [f"https://{d}" for d, _ in fuzzy]

        if best_score > 0.80:
            return ResolveResult(
                url=all_suggestions[0],
                suggestions=all_suggestions[1:4],
                resolve_type="fuzzy",
                normalized_input=text,
            )
        else:
            return ResolveResult(
                url=None,
                suggestions=all_suggestions[:5],
                resolve_type="ambiguous",
                needs_clarification=True,
                normalized_input=text,
            )

    # 5) Fallback — treat as search query
    search_url = f"https://duckduckgo.com/?q={quote_plus(text)}"
    return ResolveResult(
        url=search_url,
        resolve_type="search",
        normalized_input=text,
    )
