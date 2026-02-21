"""Tests for phonetic normalization module."""

import pytest

from app.phonetic import normalize, looks_like_url


class TestNormalize:
    """Test speech-to-URL normalization."""

    # ── Polish TLD tests ─────────────────────────────

    @pytest.mark.parametrize("speech,expected", [
        ("onet kropka pe el", "onet.pl"),
        ("allegro kropka pe el", "allegro.pl"),
        ("bankier kropka pe el", "bankier.pl"),
        ("wp kropka pe el", "wp.pl"),
        ("tvn24 kropka pe el", "tvn24.pl"),
        ("gazeta kropka pe el", "gazeta.pl"),
        ("interia kropka pe el", "interia.pl"),
    ])
    def test_polish_domains(self, speech, expected):
        assert normalize(speech) == expected

    # ── International TLD tests ──────────────────────

    @pytest.mark.parametrize("speech,expected", [
        ("github kropka kom", "github.com"),
        ("google dot com", "google.com"),
        ("wikipedia kropka o er ge", "wikipedia.org"),
        ("youtube kropka kom", "youtube.com"),
        ("reddit kropka kom", "reddit.com"),
    ])
    def test_international_domains(self, speech, expected):
        assert normalize(speech) == expected

    # ── Separator tests ──────────────────────────────

    @pytest.mark.parametrize("speech,expected", [
        ("user małpa gmail kropka kom", "user@gmail.com"),
        ("example dash site kropka kom", "example-site.com"),
        ("my underscore page kropka pe el", "my_page.pl"),
    ])
    def test_separators(self, speech, expected):
        assert normalize(speech) == expected

    # ── Protocol prefix tests ────────────────────────

    def test_direct_url_passthrough(self):
        # Already URL-like input gets cleaned up
        assert normalize("google.com") == "google.com"
        assert normalize("onet.pl") == "onet.pl"

    # ── Edge cases ───────────────────────────────────

    def test_double_dot_cleanup(self):
        """Double dots from 'kropka' + TLD-with-dot should be cleaned."""
        result = normalize("test kropka kropka pe el")
        assert ".." not in result

    def test_trailing_dot_removed(self):
        result = normalize("onet kropka pe el kropka")
        assert not result.endswith(".")

    def test_empty_input(self):
        assert normalize("") == ""

    def test_whitespace_only(self):
        assert normalize("   ") == ""

    def test_www_prefix(self):
        assert normalize("trzy w kropka onet kropka pe el") == "www.onet.pl"
        assert normalize("wuwuwu kropka google kropka kom") == "www.google.com"

    # ── Mixed case ───────────────────────────────────

    def test_case_insensitive(self):
        assert normalize("ONET KROPKA PE EL") == "onet.pl"
        assert normalize("GitHub Kropka Kom") == "github.com"


class TestLooksLikeUrl:
    """Test URL detection heuristic."""

    @pytest.mark.parametrize("text", [
        "onet.pl", "google.com", "wikipedia.org",
        "https://github.com", "http://example.com",
        "sub.domain.co.uk", "test-site.dev",
    ])
    def test_valid_urls(self, text):
        assert looks_like_url(text) is True

    @pytest.mark.parametrize("text", [
        "hello world", "najlepsze restauracje",
        "123", "", "a.b", "notatld",
    ])
    def test_not_urls(self, text):
        assert looks_like_url(text) is False
