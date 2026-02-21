"""
Phonetic normalization for Polish speech-to-URL conversion.

Converts spoken Polish phrases like "onet kropka pe el" into valid
URL components like "onet.pl".
"""

import re

# Phonetic substitution rules — ordered by priority (longest first)
PHONETIC_RULES: dict[str, str] = {
    # Protocol prefixes
    "ha te te pe es dwa kropki slash slash": "https://",
    "ha te te pe dwa kropki slash slash": "http://",
    "https dwa kropki slash slash": "https://",
    "http dwa kropki slash slash": "http://",
    "ha te te pe es": "https",
    "ha te te pe": "http",
    # Separators
    "kropka": ".",
    "dot": ".",
    "dott": ".",
    "ukośnik": "/",
    "slash": "/",
    "slasz": "/",
    "małpa": "@",
    "at": "@",
    "myślnik": "-",
    "dash": "-",
    "tire": "-",
    "podkreślnik": "_",
    "underscore": "_",
    "dwukropek": ":",
    "colon": ":",
    # www
    "trzy w": "www",
    "wuwuwu": "www",
    "wu wu wu": "www",
    # TLDs (without dot — "kropka" inserts the dot separately)
    "pe el": "pl",
    "pe-el": "pl",
    "peel": "pl",
    "kom": "com",
    "de i": "dev",
    "dei": "dev",
    "o er ge": "org",
    "oerge": "org",
    "net": "net",
    "ju es": "us",
    "ju kej": "uk",
    "de e": "de",
    "i u": "eu",
    "ie u": "eu",
}

# Sorted by length descending (longest match first) to avoid partial replacements
_SORTED_RULES = sorted(PHONETIC_RULES.items(), key=lambda x: -len(x[0]))


def normalize(text: str) -> str:
    """
    Apply phonetic rules to convert spoken Polish text to a URL-like string.

    Examples:
        >>> normalize("onet kropka pe el")
        'onet.pl'
        >>> normalize("github kropka kom")
        'github.com'
        >>> normalize("wikipedia kropka o er ge")
        'wikipedia.org'
    """
    result = text.lower().strip()

    # Apply phonetic substitutions (longest match first)
    for spoken, replacement in _SORTED_RULES:
        result = result.replace(spoken, replacement)

    # Collapse whitespace around punctuation
    result = re.sub(r"\s*\.\s*", ".", result)
    result = re.sub(r"\s*/\s*", "/", result)
    result = re.sub(r"\s*:\s*", ":", result)
    result = re.sub(r"\s*@\s*", "@", result)

    # Remove remaining spaces
    result = result.replace(" ", "")

    # Clean double dots
    while ".." in result:
        result = result.replace("..", ".")

    # Strip trailing dot
    result = result.rstrip(".")

    # Re-add TLD dot if missing (e.g. "onetpl" → "onet.pl" won't happen,
    # but "onet.pl." → "onet.pl" is handled above)
    return result


def looks_like_url(text: str) -> bool:
    """Check if text looks like a URL or domain after normalization."""
    return bool(re.match(r"^(https?://)?[\w.-]+\.\w{2,}", text))
